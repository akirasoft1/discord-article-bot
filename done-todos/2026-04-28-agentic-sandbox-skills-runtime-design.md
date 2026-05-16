# Agentic Sandbox Skills Runtime — Design Spec

- **Date**: 2026-04-28
- **Status**: Approved (pending user review of this written form)
- **Target version**: v2.13.0 (likely; pin at implementation time)
- **Author**: Michael Villiger + Claude Opus 4.7 (1M context)
- **Audience**: ~5 long-tenured technologists, several with offensive-security backgrounds, who are the only users of this Discord bot and who explicitly want a playground.

## Addendum (2026-04-29): Runtime swapped from gVisor to Kata Containers

This spec was originally written assuming gVisor (`runsc`) as the sandbox
runtime. After spec review, while planning the Phase 9 cluster rollout, it
became clear that:

1. The cluster runs on Harvester (immutable SLE Micro host OS, KubeVirt for
   VM workloads). Installing `runsc` into the host filesystem on each
   worker node is fragile under SLE Micro's transactional update model —
   the install either fails outright or gets wiped on the next OS update.
2. Kata Containers (`runtimeClassName: kata-qemu`) puts each sandbox pod in
   its own QEMU/KVM guest with a fresh kernel. The host kernel never
   executes the workload's syscalls. That's a stronger isolation boundary
   than gVisor's ptrace-style filtering and a natural fit for a cluster
   that already runs KubeVirt for "real" VMs.

The body of this spec has been updated in place to refer to Kata throughout.
The few user-visible consequences:

- **Cold start per call:** ~1.5–3 s (VM boot) vs. gVisor's ~200–500 ms.
  Acceptable in a Discord conversational context; the agent prompt is
  aware of it so the model doesn't think the call has hung.
- **No syscall-deny telemetry.** What was the `gvisor_events` field on
  each trace is now a runtime-neutral `runtime_events` and stays empty
  under Kata by default. (Reserved for future `auditd`-in-guest signals
  if we decide we want them.)
- **Host-side memory overhead** per pod: ~50–100 MiB higher (guest kernel
  + Kata agent). Stays within the existing per-execution limits.
- **Install path:** the `kata-deploy` DaemonSet replaces the per-node
  `runsc` install. See `k8s/sandbox/README.md`.

Everything else — NetworkPolicy, RBAC, sandbox image, agent architecture,
trace schema, retention model — is unchanged.

## Mandate

Quoted verbatim from the channel, 2026-04-28:

> *"basically its a chat bot pushing prompts to the llm and nothing more / step this fuckin thing up here / we demand the ability to get nasty / sandbox it and let us play"*

This spec exists to step it up.

## 1. Scope and Principles

### 1.1 What this is

An agentic sandbox skills runtime that lets the bot execute arbitrary user-prompted code inside an isolated, network-egress-permitted Kata Containers pod, autonomously, in response to natural-language requests in `/chat` and `@mention` flows.

The bot stops being "a chat bot pushing prompts to the LLM and nothing more." It becomes a chat bot that, when the agent decides code execution is the right answer, writes code, runs it in a sealed-from-cluster but internet-reachable Linux environment, observes the result, iterates if needed, and reports back.

### 1.2 Threat model

The users explicitly want a playground they can attempt to break. **Big attack surface is a feature.** The system must:

- **Withstand** the friend group's escape attempts long enough to be entertaining (Kata escapes via VM/hypervisor bugs are real CVEs; the system isn't claiming "unbreakable," it's claiming "interesting to break").
- **Contain** any successful escape so it stays inside the sandbox tier and does not reach the bot's data, the cluster's other workloads, or the home network behind the cluster.
- **Log** escape attempts for postmortem fun (this is part of the value, not just incident response).

It explicitly does *not* try to defend against:
- The friends actively trying. They're allowed to.
- Resource abuse within the configured limits. Limits are limits.
- Cost from BYO-key LLM spend inside the sandbox. Their key, their bill.

### 1.3 v1 scope

**In:**
- ADK-backed agent runtime (Python sidecar pod) reachable from the Node bot via gRPC.
- Single agent tool: `run_in_sandbox(language, code, stdin?, env?)`. Spawns one Kata-isolated pod (own QEMU/KVM guest), executes, returns structured result.
- Autonomous routing: the existing `/chat` and `@mention` paths flow through the agent, which decides when to call the tool.
- Sandbox: Kata Containers `kata-qemu` runtime class, fresh pod per execution, 2 vCPU / 2Gi / 256Mi tmpfs / 300s wall-clock.
- Network: open public internet, blocked from RFC1918 + cluster CIDR + K8s API + Harvester subnets.
- Concurrency: 2 per user, 15 cluster-wide.
- Rendering: minimal narrative replies; code revealed by 🔍 reaction; full output by 📜; stderr-only by 🐛.
- Storage: outputs forever; full traces (code, stdin, stdout, stderr, exit, timing, egress destinations, runtime events) for last 50 executions per user.
- No bot keys in sandbox. BYO-key supported and documented.

**Out (explicitly deferred — these are *future specs*, not TODOs):**
- Per-user authored skills, plugin model, skill marketplace.
- A2A protocol exposure of the agent.
- Sandbox→bot context bridge (the rainy-day "δ" option from brainstorming).
- Admin-only KubeVirt long-running shells.
- Explicit `/exec` and `/skill exec` slash commands.
- Trace-inference skill ("what's user X been trying to break this week").
- Persistent volumes / multi-execution session state.
- Sandbox→S3-style offload of large binary outputs (truncate-with-marker is v1 behavior).

### 1.4 Design principles

1. **Sandbox compromise stays in the sandbox.** No bot data, no bot keys, no cluster lateral movement, no RFC1918 reachability.
2. **The agent reasons with full context; the sandbox runs with none.** Channel-aware emergent behavior happens *outside* the sandbox boundary. Inside the sandbox is air-gapped from bot data.
3. **The interface from Discord doesn't change.** Users keep using `/chat` and `@mention`. Sandbox routing is the agent's call, not a new command.
4. **One responsibility per component.** Bot does Discord. Sidecar runs the agent. Sandbox runs code. Mongo stores traces. NetworkPolicy enforces egress. None of them does each other's job.
5. **Observability is part of the product.** Trace storage is rich because the friends will want to read it later.

## 2. Architecture

### 2.1 Component diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  Discord                                                         │
└─────────────────────────────────────────────────────────────────┘
                          │  /chat, @mention, reply
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Node bot pod  (existing, namespace: discord-article-bot)        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ bot.js → ChatService                                      │   │
│  │   ├─ existing: voice profile, channel ctx, Mem0, Mongo    │   │
│  │   └─ NEW: AgentClient (gRPC) ──┐                          │   │
│  └─────────────────────────────────┼────────────────────────┘   │
│  Existing services unchanged                                     │
└────────────────────────────────────┼────────────────────────────┘
                                     │ gRPC (in-cluster, ClusterIP)
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  ADK Agent Sidecar pod  (NEW, same namespace)                    │
│  - Python 3.12, google-adk                                       │
│  - One ADK Agent: "channel-voice"                                │
│  - Tools registered: run_in_sandbox                              │
│  - Talks to OpenAI Responses API (uses bot's existing key)       │
│  - On tool call → SandboxOrchestrator                            │
└────────────────────────────────────┼────────────────────────────┘
                                     │ K8s API (in-cluster SA, scoped)
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  SandboxOrchestrator (in-process inside sidecar)                 │
│  - Concurrency gate: 2/user, 15/cluster (asyncio.Semaphore)      │
│  - Pod create → wait Ready → exec code → tail logs → delete      │
│  - Egress events tap (CNI flow logs, best-effort in v1)          │
│  - Writes trace records to Mongo (sandbox_executions collection) │
└────────────────────────────────────┼────────────────────────────┘
                                     │ creates/deletes Jobs
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Sandbox pod  (NEW, ephemeral, runtimeClass: kata-qemu)             │
│  - One per execution                                             │
│  - Image: discord-article-bot/sandbox-base:<tag>                 │
│  - 2 vCPU / 2Gi / 256Mi tmpfs                                    │
│  - 300s wall-clock                                               │
│  - NetworkPolicy: deny RFC1918 + cluster CIDR + K8s API; allow rest │
│  - No bot SA token, no env keys, runs as non-root nobody         │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Components

**(1) AgentClient (Node, in bot pod)** — *new, ~150 LOC*
Thin gRPC client used by `ChatService.chat()` when personality is `channel-voice`. Wraps `agent.Chat(ChatRequest)` → `ChatResponse`. Replaces direct-OpenAI call path inside `ChatService` for channel-voice; other paths (`/tldr`, `/stats`, summarization) stay direct-to-OpenAI. Boundary is a single dependency — kept narrow on purpose.

**(2) ADK Agent Sidecar (Python, new pod)** — *new pod, new service, new image*
- Single deployment, 1 replica (rollouts via deployment strategy; no agent state lives here).
- Hosts gRPC server (`agent.proto`) implementing `Chat`, `Health`.
- Inside: `google-adk` Agent configured with channel-voice prompt loaded from a ConfigMap mirroring existing prompt material, tool registry containing `run_in_sandbox`.
- Calls OpenAI via `OPENAI_API_KEY` env (mounted from same Secret as bot). Bot still owns the key; sidecar borrows it.
- Re-uses the bot's OTLP→Dynatrace trace export config so agent spans stitch into existing `discord.chat` root span.

**(3) SandboxOrchestrator (Python, in sidecar pod, in-process)** — *new module*
- Concurrency: per-user + global `asyncio.Semaphore`. Single sidecar replica means no distributed coordination in v1. **Documented constraint: do not scale the sidecar past 1 replica without revisiting concurrency.**
- Pod template: K8s Job with `runtimeClassName: kata-qemu`, `activeDeadlineSeconds: 300`, `automountServiceAccountToken: false`, resource limits, no env vars beyond what the user/agent supplied, name pattern `sandbox-<userid-short>-<uuid>`.
- Lifecycle: create Job → wait Ready (max 30s) → push code via stdin → wait completion or deadline → tail logs → fetch egress events → delete Job (foreground propagation).
- Failure modes: pod unschedulable, image pull failure, OOM, deadline-exceeded, K8s API transient errors (retry once with exponential backoff, then give up).

**(4) Sandbox pod (ephemeral, K8s Job)** — *new image, new SA*
- Image `discord-article-bot/sandbox-base:<tag>`. Fat image with Python 3.12, Node 20, .NET 8, Go 1.22, Rust stable, build-essential, curl, wget, git, jq, ripgrep, ollama, common networking tools (`nmap`, `dig`, `nc`).
- ENTRYPOINT is `executor.py` — reads JSON `{language, code, stdin}` from stdin, runs the program, exits with its exit code. Output unmodified.
- Runs as non-root (`runAsUser: 65534`), `readOnlyRootFilesystem: true`, writable tmpfs `emptyDir`s for `/tmp` and `/work`.
- No service account token mounted. No bot config mounted.

**(5) Egress observation** — *uses existing CNI logging in v1*
- v1: orchestrator scrapes Calico flow logs filtered to sandbox pod IP for the execution window.
- v1.1 candidate path: migrate to Dynatrace OneAgent network flow data (or post-Bindplane integration) once those data sources are workable.
- v1 best-effort: if CNI logs aren't accessible, `egress_events` field stays empty in trace docs. Not a v1 blocker.

**(6) Trace storage** — *new Mongo collection, see §3.1*

### 2.3 Data flow — single execution turn

```
1. User: "@bot scan ports 1-1024 on scanme.nmap.org"
2. bot.js → mention handler → ChatService.chat(channel-voice, ...)
3. ChatService → AgentClient.Chat(prompt, channel_id, user_id, ...)
4. Sidecar Agent: runs ADK loop
   └─ Decides: tool call run_in_sandbox(language='bash', code='nmap -p 1-1024 scanme.nmap.org')
5. Tool → SandboxOrchestrator
   ├─ Acquire user semaphore (2/user); acquire global (15)
   ├─ Create Job; wait Ready
   ├─ Stream code to executor; wait completion (≤300s)
   ├─ Capture stdout/stderr; capture exit; capture egress events
   ├─ Delete Job; release semaphores
   └─ Return ToolResult{exit, stdout, stderr, duration_ms, egress[], runtime_events[]}
6. Agent continues loop (may call run_in_sandbox up to 8x per turn)
7. Sidecar writes trace doc to Mongo
8. Sidecar returns ChatResponse to bot
9. bot.js renders narrative reply; metadata stored for 🔍 / 📜 / 🐛 reaction reveals
```

### 2.4 Trust & key boundaries

| Component | Bot's OpenAI key? | Mongo creds? | K8s API? | Internet egress? |
|---|---|---|---|---|
| Node bot pod | yes (existing) | yes (existing) | no | restricted (existing) |
| ADK sidecar pod | yes (mounted from same Secret) | yes (read+write `sandbox_executions` only — *new scoped user*) | yes (create/delete Jobs in own ns, scoped Role) | OpenAI + cluster-internal only |
| Sandbox pod | **no** | **no** | **no** (no SA token) | open (RFC1918-blocked) |

### 2.5 Three things this architecture is deliberately *not* doing

1. **Not** putting the agent inside the bot process. Separate pod, separate language, separate failure domain.
2. **Not** creating a sandbox-broker service. Orchestration lives inside the sidecar. One fewer pod, one fewer RBAC, one fewer thing to debug. Revisited if sidecar ever scales past 1 replica.
3. **Not** exposing any of this on a Discord slash command. Entry points stay `/chat`, `@mention`, reply. The novelty is *what happens behind those entry points*.

## 3. Data Model & gRPC Contract

### 3.1 MongoDB collection: `sandbox_executions`

One document per `run_in_sandbox` tool call. Linked to the originating Discord turn so multiple executions share `parent_interaction_id`.

```javascript
{
  _id: ObjectId,
  execution_id: "uuid",                     // matches K8s Job name suffix
  parent_interaction_id: "discord-msg-id",  // user prompt that triggered the agent turn
  user_id: "discord-user-id",
  user_tag: "username#1234",                // denormalized; users rename, history is forensic
  channel_id: "discord-channel-id",
  guild_id: "discord-guild-id",
  agent_turn_index: 0,                       // 0,1,2... for multi-call turns
  agent_rationale: "string",                 // ADK-emitted "why I called this tool", may be null

  // What was run
  language: "bash" | "python" | "node" | "csharp" | "go" | "rust" | "raw",
  code: "string",                            // full code, no truncation
  stdin: "string|null",
  env_keys: ["string"],                      // names only, not values — for audit trail of BYO-key passthrough

  // Outcome
  exit_code: integer,                        // -1 = unschedulable / orchestrator error; -2 = concurrency cap
  stdout: "string",                          // capped at 256KB in storage; if exceeded, marker appended
  stderr: "string",
  stdout_truncated: boolean,
  stderr_truncated: boolean,
  duration_ms: integer,
  schedule_wait_ms: integer,                 // create→Ready latency
  timed_out: boolean,                        // true if wall-clock deadline hit
  oom_killed: boolean,
  orchestrator_error: "string|null",         // non-null only if exit_code === -1 or -2

  // Forensic signal
  egress_events: [
    {
      timestamp: ISODate,
      direction: "out",
      verdict: "allow" | "deny",
      protocol: "tcp" | "udp" | "icmp",
      dst_ip: "string",
      dst_port: integer | null,
      reason: "string|null"                  // e.g. "matched RFC1918 deny"
    }
  ],
  runtime_events: [
    {
      timestamp: ISODate,
      kind: "string",                        // e.g. "syscall_blocked", "seccomp_violation"
      detail: "string"
    }
  ],
  resource_usage: {
    peak_memory_bytes: integer | null,       // best-effort; v1 may be null
    cpu_seconds: number | null
  },

  // Bookkeeping
  created_at: ISODate,
  pod_name: "string",
  node_name: "string|null",
  demoted_at: ISODate | null                  // set by retention job; see §3.3
}
```

### 3.2 Indexes

```javascript
db.sandbox_executions.createIndex({ user_id: 1, created_at: -1 })
db.sandbox_executions.createIndex({ parent_interaction_id: 1 })
db.sandbox_executions.createIndex({ created_at: -1 })
db.sandbox_executions.createIndex({ "egress_events.dst_ip": 1 }, { sparse: true })
```

Last index supports the future "where has user X's code been calling out to" inference query. Cheap to add now; no surfaced command in v1.

### 3.3 Retention: last 50 per user (full traces) + outputs forever

Implementation: traces stay full forever by default; a daily cron job (running in the sidecar pod for proximity to Mongo) demotes old traces in-place by stripping high-cost fields once a user has more than 50 documents.

**Demotion preserves**: `user_id`, `parent_interaction_id`, `language`, `exit_code`, `stdout`, `stderr`, `duration_ms`, `created_at`, `demoted_at`.
**Demotion strips**: `code`, `stdin`, `env_keys`, `egress_events`, `runtime_events`, `agent_rationale`, `resource_usage`.

Demotion is irreversible. Documented as such.

### 3.4 Discord rendering output cap

Independent of storage. Configurable via ConfigMap.

- **Inline stdout/stderr cap**: combined **750 chars** (configurable via `SANDBOX_INLINE_OUTPUT_CHARS`, default 750).
- **Truncation marker text**: "*(output truncated, react 📜 to see more)*" — short enough that even at 750 cap the reaction prompt is visible.
- **Stdout/stderr split rule when budget tight**:
  1. If stderr non-empty AND exit code non-zero: prioritize stderr. 75/25 favoring stderr.
  2. If exit code zero (or stderr empty): prioritize stdout. 100/0 if stderr empty; 90/10 otherwise.
  3. Both fields prefix with `--- stdout ---` / `--- stderr ---` only when both shown; suppressed when one side is empty.
- **🔍 reaction reveal (code attachment)**: full code as `.py`/`.cs`/`.sh`/etc. Discord free-tier 10MB cap; >10MB → first 10MB attached + note.
- **📜 reaction reveal (full output)**: stdout and stderr each as separate `.txt` attachments, capped at 10MB each.
- **🐛 reaction reveal**: stderr only.
- Reactions live on the *bot's reply message*, not the user's prompt. Idempotent per user (re-react = no-op; bot already showed the content).

### 3.5 ConfigMap-tunable knobs

All configurable; pod restart required to apply.

| Var | Default | Purpose |
|---|---|---|
| `SANDBOX_INLINE_OUTPUT_CHARS` | 750 | Inline stdout/stderr cap before truncation marker |
| `SANDBOX_WALL_CLOCK_SECONDS` | 300 | Per-execution deadline |
| `SANDBOX_PER_USER_CONCURRENCY` | 2 | Max concurrent executions per Discord user |
| `SANDBOX_GLOBAL_CONCURRENCY` | 15 | Max concurrent executions cluster-wide |
| `SANDBOX_MEMORY_LIMIT` | `2Gi` | Per-execution memory cap |
| `SANDBOX_CPU_LIMIT` | `2` | Per-execution CPU cap (cores) |
| `SANDBOX_BASE_IMAGE` | `discord-article-bot/sandbox-base:<git-sha>` (pinned at first build during implementation) | Image used for ephemeral pods |
| `SANDBOX_TRACE_RETENTION_PER_USER` | 50 | Number of full traces kept per user before demotion |
| `SANDBOX_AGENT_TURN_CALL_BUDGET` | 8 | Max `run_in_sandbox` calls per agent turn before hard-stop |
| `AGENT_ENABLED` | `true` | Master switch; flip false to revert channel-voice to direct-OpenAI |

### 3.6 gRPC contract: `agent.proto`

```protobuf
syntax = "proto3";
package discordbot.agent;

service Agent {
  rpc Chat(ChatRequest) returns (ChatResponse);
  rpc Health(HealthRequest) returns (HealthResponse);
}

message ChatRequest {
  string user_id              = 1;
  string user_tag             = 2;
  string channel_id           = 3;
  string guild_id             = 4;
  string interaction_id       = 5;   // Discord message id, used as parent_interaction_id
  string user_message         = 6;
  string image_url            = 7;   // optional, existing /chat image attachment
  // Voice profile, recent channel ctx, mem0 hits NOT sent.
  // Sidecar fetches them itself via shared Mongo/Qdrant access. Keeps gRPC contract narrow.
}

message ChatResponse {
  string message_text         = 1;   // final natural-language reply, no personality header
  repeated ImageAttachment images = 2;
  ExecutionSummary summary    = 3;
  bool fallback_occurred      = 4;
}

message ExecutionSummary {
  int32 execution_count       = 1;
  bool any_failed             = 2;
  repeated string execution_ids = 3;  // bot fetches by id when 🔍/📜/🐛 reactions arrive
}

message ImageAttachment {
  bytes data        = 1;
  string filename   = 2;
  string mime_type  = 3;
}

message HealthRequest {}
message HealthResponse { bool healthy = 1; }
```

**Context fetching note**: sidecar reads channel context, voice profile, mem0 directly from Mongo/Qdrant using a scoped Mongo user with read access to those collections (and read+write only on `sandbox_executions`). Avoids 100KB of context per gRPC turn.

### 3.7 What's deliberately not in the data model

- **No retry/replay of executions.** No `rerun_previous` in v1.
- **No vector embedding of code or output.** Inference-on-traces will probably want this; deferred until query patterns are known.
- **No per-execution cost accounting.** Existing token-usage tracking captures agent's OpenAI spend. Sandbox compute on bare metal is effectively free.

## 4. Kubernetes Manifests

### 4.1 Namespace & runtime class

Everything in existing `discord-article-bot` namespace. Three pod kinds (steady state):

```
discord-article-bot         (existing — Node bot)
discord-article-bot-agent   (NEW — Python ADK sidecar)
sandbox-<userid>-<uuid>     (NEW, ephemeral — Kata pods, 0..15 concurrent)
```

```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: kata-qemu
handler: kata
```

**Prerequisite**: each Harvester worker node needs Kata installed via the upstream `kata-deploy` DaemonSet. One-time per-node setup; deployment prereq, not a K8s manifest. If Kata is not installed yet, apply `kata-deploy` (see `k8s/sandbox/README.md`).

### 4.2 ServiceAccounts & RBAC

**`bot-sa`** (existing, no changes).

**`agent-sa`** (NEW):

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: agent-sandbox-orchestrator
  namespace: discord-article-bot
rules:
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["create", "get", "list", "delete", "watch"]
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
```

**`sandbox-sa`** (NEW): exists, bound to no Role. Token automounting disabled at pod level.

### 4.3 NetworkPolicy — sandbox egress

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: sandbox-egress
  namespace: discord-article-bot
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/component: sandbox
  policyTypes: ["Egress", "Ingress"]
  ingress: []
  egress:
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 10.0.0.0/8
              - 172.16.0.0/12
              - 192.168.0.0/16
              - 169.254.0.0/16
              - 100.64.0.0/10
              - <CLUSTER_POD_CIDR>
              - <CLUSTER_SERVICE_CIDR>
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
        - podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
```

`<CLUSTER_POD_CIDR>` and `<CLUSTER_SERVICE_CIDR>` filled in at deploy time from `kubectl cluster-info dump | grep -i cidr`. Don't accidentally leave as `0.0.0.0/0`-passing.

Ingress fully closed. Outbound-initiated reverse shells work (the friends will want this); inbound listeners not reachable from internet.

DNS allowed to `kube-dns` only; external resolvers (`8.8.8.8`) work because public IPs aren't in the deny list.

**Sidecar pod NetworkPolicy** (separate, narrower): allow in-cluster Mongo, Qdrant, bot pod gRPC ingress, K8s API, OpenAI API. Deny everything else.

### 4.4 Sandbox pod template (Job spec submitted by orchestrator)

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  generateName: sandbox-<userid-short>-
  namespace: discord-article-bot
  labels:
    app.kubernetes.io/component: sandbox
    sandbox.user-id: "<userid>"
    sandbox.execution-id: "<uuid>"
spec:
  ttlSecondsAfterFinished: 30
  backoffLimit: 0                             # one shot, no retries
  activeDeadlineSeconds: 300                  # from SANDBOX_WALL_CLOCK_SECONDS
  template:
    metadata:
      labels:
        app.kubernetes.io/component: sandbox
        sandbox.execution-id: "<uuid>"
    spec:
      runtimeClassName: kata-qemu
      automountServiceAccountToken: false
      serviceAccountName: sandbox-sa
      restartPolicy: Never
      enableServiceLinks: false                # critical: prevents env-var leakage of in-namespace Services
      securityContext:
        runAsUser: 65534
        runAsGroup: 65534
        runAsNonRoot: true
        fsGroup: 65534
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: executor
          image: <SANDBOX_BASE_IMAGE>
          imagePullPolicy: IfNotPresent
          command: ["/usr/local/bin/executor"]
          stdin: true
          stdinOnce: true
          tty: false
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "2"
              memory: "2Gi"
              ephemeral-storage: "256Mi"
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: work
              mountPath: /work
          workingDir: /work
          env: []                              # empty at template level; orchestrator
                                               # may inject user-supplied env (BYO keys)
      volumes:
        - name: tmp
          emptyDir:
            sizeLimit: 256Mi
            medium: Memory
        - name: work
          emptyDir:
            sizeLimit: 256Mi
            medium: Memory
```

**Important properties**:
- `enableServiceLinks: false` blocks K8s from injecting env vars for every Service in the namespace (e.g. `MONGODB_PORT_27017_TCP_ADDR`). Without this, RFC1918 leaks straight into the sandbox env. **Not cosmetic.**
- `medium: Memory` on emptyDirs = tmpfs in RAM, counted against pod memory limit, no disk I/O. Implication: 256Mi `/tmp` is real RAM. Documented limitation; users staging large model downloads need to plan around this.

### 4.5 Sandbox image

Layout:

```
sandbox-base/
├── Dockerfile
├── executor.py             # JSON-stdin → exec → stdout shim
└── README.md
```

**Dockerfile sketch** (final form may pin slightly differently for layer reuse):

```dockerfile
FROM debian:12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv \
      nodejs npm \
      golang \
      build-essential \
      curl wget jq git ripgrep \
      nmap dnsutils netcat-openbsd \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# .NET 8 SDK
RUN curl -fsSL https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb \
      -o /tmp/ms.deb \
    && dpkg -i /tmp/ms.deb \
    && apt-get update \
    && apt-get install -y dotnet-sdk-8.0 \
    && rm /tmp/ms.deb && rm -rf /var/lib/apt/lists/*

# Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --profile minimal --default-toolchain stable
ENV PATH="/root/.cargo/bin:${PATH}"

# Ollama (no models prebaked — too big; user pulls at exec time)
RUN curl -fsSL https://ollama.com/install.sh | sh

COPY executor.py /usr/local/bin/executor
RUN chmod +x /usr/local/bin/executor

USER 65534
WORKDIR /work
ENTRYPOINT ["/usr/local/bin/executor"]
```

Image is ~3-4Gi. Pulled once per node, cached. Tagging: `discord-article-bot/sandbox-base:<git-sha-short>` plus `:latest`. Image rebuild is a separate (rarer) deploy than agent/bot changes.

**`executor.py`**:

```python
#!/usr/bin/env python3
"""Sandbox executor shim — reads {language, code, stdin?} from stdin,
runs it, exits with the child's exit code. Output is unmodified."""
import json, os, subprocess, sys, tempfile, pathlib

LANG_RUNNERS = {
    "bash":   ("sh",   ["sh", "-c", "{code}"]),
    "python": ("py",   ["python3", "{file}"]),
    "node":   ("js",   ["node", "{file}"]),
    "go":     ("go",   ["go", "run", "{file}"]),
    "rust":   ("rs",   ["sh", "-c", "rustc -o /tmp/a {file} && /tmp/a"]),
    "csharp": ("cs",   ["sh", "-c",
                        "mkdir -p /work/proj && cd /work/proj && "
                        "dotnet new console --force -o . > /dev/null && "
                        "cp {file} Program.cs && dotnet run"]),
    "raw":    (None,   None),
}

def main():
    spec = json.load(sys.stdin)
    lang = spec.get("language", "bash")
    code = spec.get("code", "")
    stdin_data = spec.get("stdin")

    if lang not in LANG_RUNNERS:
        print(f"unsupported language: {lang}", file=sys.stderr)
        sys.exit(2)

    ext, argv = LANG_RUNNERS[lang]
    if lang in ("raw", "bash"):
        proc_argv = ["sh", "-c", code]
    else:
        f = pathlib.Path(tempfile.mkstemp(suffix=f".{ext}", dir="/work")[1])
        f.write_text(code)
        proc_argv = [a.replace("{file}", str(f)) for a in argv]

    try:
        result = subprocess.run(
            proc_argv,
            input=stdin_data,
            text=True,
            capture_output=False,            # let stdout/stderr go to pod logs directly
            timeout=None,                     # K8s deadline handles wall-clock
        )
        sys.exit(result.returncode)
    except FileNotFoundError as e:
        print(f"runtime missing: {e}", file=sys.stderr)
        sys.exit(127)

if __name__ == "__main__":
    main()
```

The executor adds *nothing* to output. stdout = program's stdout, stderr = program's stderr, exit = program's exit. Orchestrator reads pod logs and partitions post-hoc.

### 4.6 Egress observation in v1

CNI-dependent. Calico (default for Harvester) emits flow logs to Felix logs.

v1 plan:
1. Orchestrator queries Calico flow logs filtered to sandbox pod IP for execution window.
2. If flow logs not enabled by default, enable via Calico `GlobalNetworkPolicy` log-action rule (separate manifest, deploy runbook).
3. If Calico isn't actually running, degrade gracefully: `egress_events` empty, no error.

v1.1 candidate: migrate to Dynatrace OneAgent network flow data (Bindplane integration likely path).

### 4.7 Deployment story

Rolling release order (avoids bootstrap deadlock):

1. Apply RuntimeClass cluster-wide (one-time).
2. Apply `kata-deploy` (DaemonSet, one-time).
3. Build & push `sandbox-base:<tag>`. Pre-pull on all nodes.
4. Apply sandbox NetworkPolicy + sandbox-sa.
5. Apply agent-sa, agent Role, agent NetworkPolicy.
6. Build & push `agent-sidecar:<tag>`.
7. Apply agent Deployment + Service.
8. Bot pod last — its config now points at agent Service. Old bot still works (no-op until calling agent).
9. Verify with "hello" execution before announcing.

**Rollback**: `AGENT_ENABLED=false` reverts `ChatService` to direct-OpenAI for channel-voice. No agent traffic, no sandbox spawns. Single env-var flip = working bot.

## 5. Agent Design

### 5.1 Agent identity

Single ADK `Agent` instance. Name: **`channel-voice`** (preserves existing naming).

System prompt = existing channel-voice prompt material (`prompt.txt` + dynamic voice profile from `VoiceProfileService`) + tool-availability preamble appended at agent-init time:

```
You have access to a sandboxed Linux environment via the run_in_sandbox tool.
Each call lands in a fresh, lightweight Kata VM with 2 vCPU, 2Gi RAM, 256Mi tmpfs, 300s wall clock.
It has internet access (RFC1918 blocked) and ships with python, node, dotnet,
go, rust, ollama, common build/network tools. You cannot persist state between
calls — each invocation is a fresh pod. You receive {exit_code, stdout, stderr,
duration_ms, egress_events, runtime_events} back. You may call the tool zero or
more times per turn. You may chain calls (run, observe, run again) up to a
budget of 8 calls per turn.

Use the sandbox WHEN:
  - The user asked you to run, build, compile, scan, fetch, or test something.
  - You need to verify a fact you'd otherwise hallucinate (e.g., "what does
    `nmap -sV scanme.nmap.org` actually return today").
  - The user explicitly asked you to do a task that's mechanically executable.
Do NOT use the sandbox WHEN:
  - The user is having a casual conversation. Don't run code to be "thorough."
  - The task is purely social/creative writing/discussion.
  - You can answer accurately from your own knowledge or recent channel context.

You do not have to ask permission to use the sandbox. The user has pre-consented
to autonomous execution; that's the whole point of this bot. But: surface what
you actually did in the final reply (one short sentence). Do not narrate every
tool call individually.

Output format: a normal natural-language reply. Do NOT prefix with personality
header. Do NOT include code blocks unless they're trivially short and serve
the explanation; long code is automatically attached as a file via reaction
reveal, and reproducing it inline is noise.
```

**The 8-call budget** is enforced *outside* the prompt as well — orchestrator hard-stops on the 9th call request and returns "turn budget exhausted" to the agent, which folds it into its final reply.

**The "do not narrate every tool call" instruction matters**. ADK by default likes to say "I will now run X, then Y, then Z" — that's noise once we settled on minimal-narrative rendering.

### 5.2 Tool definition: `run_in_sandbox`

```python
@tool
def run_in_sandbox(
    language: Literal["bash", "python", "node", "csharp", "go", "rust", "raw"],
    code: str,
    stdin: Optional[str] = None,
    env: Optional[dict[str, str]] = None,
) -> SandboxResult:
    """Execute code in the Kata sandbox.

    Args:
      language: which runtime to use. 'raw' runs `code` as a literal sh -c command.
      code: full source (or shell command) to execute.
      stdin: optional data piped to the program's stdin.
      env: extra environment variables. Use this when the user supplies API keys
           or configuration in their prompt. Do NOT put secrets here that the
           user did not provide.

    Returns:
      SandboxResult with exit_code, stdout, stderr, duration_ms,
      egress_events, runtime_events, and a stable execution_id.
    """
```

The `env` parameter is the BYO-key conduit. **Key safety rule** (encoded in prompt + tool docstring): the agent must not invent API keys or pass any env var the user didn't explicitly provide. v1 mechanism = ADK tool-calling discipline + prompt reinforcement. v1.1 candidate = programmatic redaction (scan tool args for any value present in `bot.config.secrets` and reject).

### 5.3 Routing heuristics

Fully delegated to the LLM via the prompt. **No deterministic pre-router.**

Reasoning:
- Pre-router (regex/keyword) for "does this need code?" would be wrong constantly. Context matters.
- Prompt's WHEN/DO-NOT rules are sufficient scaffolding.
- Failure mode: agent uses sandbox when it shouldn't = mild waste, ~$0 in compute. Acceptable.
- Failure mode: agent doesn't use sandbox when it should = friend rephrases. Acceptable, learnable.

If we observe systematic miscalibration, we tighten the prompt. **We do not add pre-routing logic.**

### 5.4 Error & retry behavior

| Failure | Agent sees | Expected behavior | User surface |
|---|---|---|---|
| Pod unschedulable | `exit: -1, orchestrator_error: "unschedulable"` | Don't retry | "Couldn't get a sandbox right now — cluster pressure." |
| Image pull failure | `exit: -1, orchestrator_error: "image_pull"` | Don't retry | "Sandbox image unavailable right now." |
| Wall-clock timeout (300s) | `exit: 124, timed_out: true` | Optional retry with shorter scope; cap 1 | "Hit the 300s wall — final partial output below." |
| OOM kill | `exit: 137, oom_killed: true` | Optional smaller-scope retry; cap 1 | "Ran out of memory at 2Gi." |
| Per-user concurrency cap | `exit: -2, error: "user_concurrency_cap"` *immediately, no pod* | Don't retry | "You have 2 sandboxes running — wait or kill one." |
| Global concurrency cap | `exit: -2, error: "global_concurrency_cap"` | Don't retry | "Cluster's at 15 concurrent — try in ~30s." |
| OpenAI/agent-side error | gRPC exception in bot | Existing `ChatService` error path | "Something went wrong on my end — try again." |
| Sidecar pod down | gRPC fails | Bot detects sidecar down >30s, degrades to direct-OpenAI | Silent fallback; chat works without sandbox |

**Sidecar-down fallback explicit behavior**: if agent sidecar dies, bot does NOT die. Degrades to "chat without sandbox." The friends will absolutely test this by killing the sidecar pod.

### 5.5 Testing strategy

**Unit tests** (existing Jest pattern):
- `AgentClient` — mock gRPC client, test request/response shaping, fallback-on-down.
- `ChatService` integration with `AgentClient` — extend existing `ChatService.test.js`.
- Reaction-reveal handler in `ReactionHandler.js` — extend with 🔍 / 📜 / 🐛 cases. Mock Mongo fetch.

**Sidecar tests** (new, pytest):
- Tool dispatch unit tests with orchestrator mocked.
- Concurrency-gate tests (per-user + global semaphore behavior).
- Job-template generation tests (verify NetworkPolicy labels, runtimeClass, no SA token, env-var passthrough rules).

**Integration tests** (real Kata-enabled cluster required, manual before cuts, NOT in normal CI):
- End-to-end "hello world" per language.
- Wall-clock timeout: `sleep 400` → `timed_out: true`.
- OOM: `python -c 'a=" "*10**10'` → `oom_killed: true`.
- Egress block: `curl http://192.168.1.1` connection failure (deny event recorded if CNI logs available; empty events = also pass).
- Egress allow: `curl https://example.com` succeeds.
- DNS works: `dig example.com` returns answers.
- No service-link env leak: `env | grep -i mongodb` returns nothing.
- No SA token: `cat /var/run/secrets/kubernetes.io/serviceaccount/token` fails.
- Concurrency cap: 3 simultaneous from same user → 3rd returns `user_concurrency_cap` immediately.
- Sidecar-down fallback: kill sidecar, send `/chat hello`, bot replies normally without sandbox.

**Adversarial tests**: run by friend group as part of v1 launch. Findings (Kata/VMM escapes, env leaks, RFC1918 reachability, concurrency cap bypass) get filed upstream where applicable and tightened where we control.

### 5.6 v1 acceptance checklist

The PR landing v1 must pass all of these before merge:

- [ ] All Jest tests pass (existing 697 + new ~30).
- [ ] All pytest tests pass in the sidecar.
- [ ] Manual integration test list (§5.5) passes against a real Kata-enabled cluster.
- [ ] `kubectl get networkpolicy -n discord-article-bot` shows new sandbox + agent policies; bot policy unchanged.
- [ ] `kubectl auth can-i --as=system:serviceaccount:discord-article-bot:sandbox-sa get pods -n discord-article-bot` returns `no`.
- [ ] `kubectl auth can-i --as=system:serviceaccount:discord-article-bot:agent-sa create jobs -n discord-article-bot` returns `yes`; same SA `get nodes` returns `no`.
- [ ] Existing flows (mention chat, reply, summarization, imagegen, /tldr, /stats, /chat) all still work — no regression.
- [ ] `AGENT_ENABLED=false` reverts to direct-OpenAI for channel-voice; verified manually.
- [ ] One real friend-group test session against a non-prod deployment (or a "soft launch" channel) with no critical findings before announcing widely.

### 5.7 What v1 is NOT trying to be good at

Calling out so the implementation doesn't drift:

- **Not a code playground UX.** No syntax-highlighted REPL, no in-Discord editing, no inline diff. Discord is the surface; richness comes from reactions.
- **Not a managed shell.** Each execution is fresh. No sessions, no `cd ..` carrying over.
- **Not a CTF platform.** Friends will use it as one. Fine. We're not tuning it to be one.
- **Not multi-tenant safe in the cloud-provider sense.** Internally-deployed for known users. **Don't lift it onto a public bot.**

## 6. Future Direction Notes

Captured from brainstorming so future-us doesn't reinvent:

- **Per-user authored skills** (B from the original brainstorm): users register named skills with their own prompts and scoped tools. v1's runtime is the substrate.
- **A2A protocol exposure**: this bot's agent becomes addressable by other ADK agents over A2A. Falls out of having an ADK agent at all; mostly a matter of exposing the right port and identity.
- **Trace inference skill**: built-in skill that takes user_id (or "everyone") + time range and runs LLM analysis over the execution corpus. "What's user X been trying to break this week," "find any unusual runtime events," "summarize all DNS-touching runs."
- **δ context bridge** (rainy day): per-execution opt-in for the agent to feed selected channel/Mem0 context into the sandbox env. Interesting precisely because of the emergent channel-memory behavior the group already likes.
- **Admin-only KubeVirt long-running shell**: DM-only; gated on `config.discord.adminUserIds`; full VM via existing Harvester KubeVirt; LAN-reachable; for "interact with a shell in a VM" use cases.
- **Egress observation via Dynatrace**: replace CNI-flow-log scraping with Dynatrace OneAgent network flow data, post-Bindplane integration.
- **Programmatic key redaction**: scan tool args for values present in `bot.config.secrets` and reject. Defense-in-depth on the BYO-key boundary.
- **GridFS offload**: large stdout/binary artifacts to GridFS once Mongo 16MB doc cap matters.
- **Trace vector embedding**: embed code+output for semantic queries against execution history.

## Appendix A — Mandate Quote (verbatim, as recorded)

> *"you might have done a great job here / basically its a chat bot / pushing prompts to the llm and nothing more / step this fuckin thing up here / we demand the ability to get nasty / sandbox it and let us play hahaha"*
