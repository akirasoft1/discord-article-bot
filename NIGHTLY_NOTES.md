# Overnight Run — Resume Status

**Last update:** 2026-04-30 — Phases 4–8 done, Kata install validated against the Harvester cluster, agent + bot images built and pushed, manifests applied, both rollouts green. Bot is now at v2.13.0 with AgentClient code talking to a healthy sidecar at `0a52e17`. Real Discord smoke test was about to be conducted by the user when this note was written.

**Branch:** `feat/agentic-sandbox-skills-runtime` (41 commits ahead of main). Not yet pushed.

## Currently deployed

| Image | Tag | Source commit |
|---|---|---|
| `mvilliger/discord-article-bot` | `2.13.0` | `0a52e17` |
| `mvilliger/discord-article-bot-agent` | `0a52e17` | `0a52e17` |
| `mvilliger/sandbox-base` | `0a52e17` | `0a52e17` (retag of `c391d52`; content unchanged since c391d52) |

Bot tag stream is semver (`npm version`); agent + sandbox-base stream is git short-SHA, **always in lockstep with each other** in `agent-deployment.yaml` per `feedback_no_latest_image_tags.md` memory. See that memory for the rule + how to bump correctly.

Verification confirmed end-to-end:
- Agent log: `agent sidecar listening on 0.0.0.0:50051`, no retention loop crash.
- Bot log: `AgentClient initialized -> discord-article-bot-agent.discord-article-bot.svc.cluster.local:50051`.

## Kata install on Harvester — what we learned the hard way

All five issues are documented at length in `k8s/sandbox/README.md`. Brief log here so future-you doesn't redo any of it:

1. **Helm chart needs `--set k8sDistribution=rke2`.** Default `k8s` value points the installer at `/etc/containerd/config.toml` which doesn't exist as a single file on RKE2.
2. **RKE2 containerd template needs an `imports = […]` line.** Default RKE2 config doesn't pick up kata-deploy's drop-in dir until the template is patched and `rke2-server`/`rke2-agent` is restarted. **Filename must be `config.toml.tmpl`** (not `.tpl`). Use `systemctl start` not `restart` after a stuck stop, or the unit ends up `failed`.
3. **Pin to `kata-qemu-runtime-rs`, not `kata-qemu`.** The Go runtime's shim binary is dynamically linked against glibc 2.34+; SLE Micro 5.x has glibc 2.31. The Rust runtime is fully static (no GLIBC versions in `objdump -T`) — no version-walking needed.
4. **`kvm_amd sev=0` on AMD hosts.** runtime-rs probes for SEV unconditionally and fail-closes when the kernel module advertises SEV but BIOS hasn't enabled it. One file (`/etc/modprobe.d/kata-disable-sev.conf`) per node + module reload, persistent across reboots.
5. **`dynatrace.com/inject: "false"` on sandbox pods.** OneAgent's webhook injects an `LD_PRELOAD` agent that prevents PID 1 from exiting cleanly inside the Kata guest, ballooning each execution from ~5s to ~120s. The master-switch annotation (confirmed in operator source at `pkg/webhook/mutation/pod/mutator/config.go`) bypasses all injection.
6. **Agent's `MONGO_URI` needed runtime `${MONGO_PASSWORD}` substitution** (caught after first deploy when the retention loop crashed with PyMongo `Authentication failed`). The deployed Secret stores the URI with a literal `${MONGO_PASSWORD}` placeholder for password rotation; the bot's `config.js` substitutes at runtime, the agent's `config.py` initially didn't. Fix at `agent-sidecar/src/config.py:_resolve_mongo_uri()`, three regression tests in `test_config.py`.

Smoke test passes on the cluster. `kubectl get pod kata-smoke` reports `Completed`, `kubectl logs` shows the guest kernel (`Linux kata-smoke 6.18.15 …`) which is different from the Harvester host kernel — visual confirmation the workload ran inside a Kata-managed VM.

## Why Kata, not gVisor

The cluster runs on Harvester (immutable SLE Micro host OS, KubeVirt for VM workloads). Installing `runsc` per-node is fragile under SLE Micro's transactional updates, and Kata's pod-as-tiny-VM model is both a stronger isolation boundary AND a natural fit for KubeVirt-on-bare-metal. Trade-offs: ~1.5–3 s extra cold start per call (VM boot — agent prompt is aware of it), no syscall-deny telemetry (the trace field is now `runtime_events`, empty by default under Kata). See the spec/plan addendums and `k8s/sandbox/README.md` for the full rationale.

### Is the cold start a UX problem? (data point)

LLM call durations on `discord-article-bot` over the last 14 days, from
Dynatrace OpenLLMetry spans (query: `fetch spans | filter
isNotNull(gen_ai.request.model)`):

| Model | Calls | p50 | p95 | avg |
|---|---|---|---|---|
| `gpt-4o-mini` (foreground) | 318 | **1.89 s** | 16.47 s | 4.62 s |
| `gpt-5-mini` (foreground) | 31 | 16.47 s | 35.91 s | 18.25 s |
| `gpt-4o-mini` (background) | 20 | 2.26 s | 15.15 s | 5.18 s |
| Other (image gens) | a few | 19–101 s | — | — |

So the chat hot path is `gpt-4o-mini` at p50 ≈ 1.9 s. Kata's ~2 s cold
start ~doubles user-visible latency on the *fastest* calls (1.9 s → ~4 s)
and is rounding error on everything slower. Conclusion: acceptable for a
Discord conversational UX; users are already accustomed to multi-second
LLM replies. Recheck if we ever care about sub-second responses.

To re-run the baseline:
```bash
dtctl query -f - -o json <<'EOF'
fetch spans, from:now() - 14d
| filter isNotNull(gen_ai.request.model)
| summarize {
    calls = count(),
    p50_ms = percentile(duration, 50) / 1000000,
    p95_ms = percentile(duration, 95) / 1000000,
    avg_ms = avg(duration) / 1000000
  }, by: { dt.service.name, gen_ai.request.model }
| sort calls desc
EOF
```

## Where we are

**Completed:** Phases 0–8 (sandbox now Kata-native) + docs.

| Task | Status | Commit |
|---|---|---|
| 1.1 executor.py | done | a0bb42b |
| 1.2 Sandbox Dockerfile + README | done | b4e45db, e5865d0 |
| 2.1 gRPC proto contract | done | 22cf9de |
| 2.2 Python project skeleton | done | b854f6c |
| 2.3 Generate Python gRPC stubs | done | 0e25762 |
| 2.4 gRPC server (Health-only) | done | ab36dd8 |
| 2.5 Sidecar Dockerfile | done | 828e281 |
| 3.1 Concurrency gate | done | dcde491 |
| 3.2 K8s Job template generator | done | 33912b8 |
| 3.3 Log partitioning | done | 810d92e |
| 3.4 Trace store | done | bb22bcc |
| 3.5 Egress scraper | done | 245a77a |
| 3.6 Sandbox orchestrator | done | 01b11ad |
| 4.1 run_in_sandbox tool | done | 08c1495 |
| 4.2 ADK Agent + Chat handler | done | 926e8bf |
| 4.3 Live K8s client adapter | done | b524630 |
| 4.4 Phase 4 sanity check | done | (no commit needed) |
| 5.1 Node gRPC client deps | done | ce928f7 |
| 5.2 AgentClient w/ fallback | done | 69011bc |
| 5.3 ChatService routes channel-voice | done | 9ab3af1 |
| 5.4 Wire AgentClient into bot.js | done | 45cdd4b |
| 6.1 SandboxTraceService | done | 946aa77 |
| 6.2 Reaction reveal | done | 2ae2434 |
| 7.1 Retention demotion job | done | eaf8d6f |
| 8.1–8.8 K8s manifests | done | 31e364d |
| Docs v1 (CLAUDE.md + features.md) | done | 9a80ed6 |
| **Kata migration: code (gvisor → kata, gvisor_events → runtime_events)** | done | d42d589 |
| **Kata migration: manifests + sandbox-base README** | done | c77220b |
| **Kata migration: top-level docs** | done | a48a30e |
| **Kata migration: spec + plan addendums** | done | ab522db |
| 9.1–9.6 Cluster-side acceptance | **pending** (user task) | — |

## Test status

- Node: **720/720 passing** (`npx jest`).
- Python sidecar: **49/49 passing** (`cd agent-sidecar && . .venv/bin/activate && make test`). +3 over last note: `test_dynatrace_injection_disabled` + 3× `test_config.py` for the mongo URI substitution.
- Kata smoke test on the live cluster: ✅ Pod reaches `Completed` with guest kernel reported in logs.
- End-to-end deploy: ✅ Agent + bot rollouts complete; `AgentClient initialized` logged from the bot.
- Real Discord smoke test (in-Discord `@bot please run python: print(2+2)`): pending — being run by the user.

## Notable adaptations made during this run

1. **`google-adk` 1.31.1 vs the plan's 0.5.0**: probed the API first, then adapted `agent.py` accordingly — uses `LiteLlm("openai/<model>")` for OpenAI (requires `google-adk[extensions]`, which is now in `requirements.txt`), explicit `runner.session_service.create_session(...)` per turn, and wraps the user message in `google.genai.types.Content/Part`. Public `process_chat()` shape kept exactly as the plan calls for so the gRPC server didn't change shape.

2. **`grpc.aio.server()` everywhere in the sidecar**: the Chat handler is async (must `await self._agent.process_chat`), so the test fixture and `serve()` both moved to aio. Health stays simple.

3. **`k8s/overlays/deployed/` is gitignored** — the plan assumed manifests committed there would be tracked. Source-of-truth manifests now live in **`k8s/sandbox/`** (tracked) with a README. Working copies remain in `deployed/` for the user's local apply workflow. The two small edits to existing bot manifests (`deployment.yaml` envFrom, `networkpolicy.yaml` egress) were applied in `deployed/` for the user but are documented as patches in `k8s/sandbox/README.md` since the originals are untracked.

4. **`zstd` in sandbox Dockerfile** — kept (Ollama installer requires it on Debian 12 slim; spec was wrong).

5. **Sandbox image is ~8Gi** (not the spec's 3–4Gi) — README was corrected earlier.

6. **`enableServiceLinks: false`** on the sandbox Job template — confirmed in tests; without it K8s would inject `MONGODB_PORT_27017_TCP_*` env vars into the sandbox env.

## What the user has to do (Phase 9, all cluster-side)

These steps cannot run from this session; they need cluster + registry access.

> Runtime note: the sandbox uses **Kata Containers**, not gVisor. The original
> spec called for gVisor + `runsc` per node, but Harvester's immutable SLE
> Micro hosts make that fragile. Kata's pod-as-tiny-VM model is a stronger
> isolation boundary AND a natural fit for KubeVirt-on-bare-metal — see the
> rationale in `k8s/sandbox/README.md`.

1. **Prereq — install Kata Containers via the upstream Helm chart.** This is the upstream-recommended path; the chart deploys both the kata-deploy DaemonSet and the standard `kata-qemu` / `kata-clh` / `kata-fc` RuntimeClasses for us:
   ```bash
   export KATA_VERSION=$(curl -sSL https://api.github.com/repos/kata-containers/kata-containers/releases/latest | jq -r .tag_name)
   export KATA_CHART="oci://ghcr.io/kata-containers/kata-deploy-charts/kata-deploy"
   helm install kata-deploy "$KATA_CHART" --version "$KATA_VERSION" -n kube-system
   kubectl rollout status -n kube-system ds/kata-deploy --timeout=600s
   # Smoke test:
   kubectl run kata-smoke --rm -it --image=busybox \
     --overrides='{"spec":{"runtimeClassName":"kata-qemu"}}' \
     --restart=Never -- sh -c 'uname -a'
   ```
   See `k8s/sandbox/README.md` for the full play-by-play including how to inspect the Helm values before install and what the smoke-test output should look like.

2. **Prereq — verify pod and service CIDRs in `k8s/sandbox/sandbox-networkpolicy.yaml`.** Currently pinned to this Harvester cluster's RKE2 defaults (10.52.0.0/16 pod, 10.53.0.0/16 service). Confirm with:
   ```bash
   kubectl get pods -n kube-system -l component=kube-controller-manager -o yaml | grep -E "cluster-cidr|service-cluster-ip-range"
   ```

3. **Build + push images (Task 9.1):**
   ```bash
   TAG=$(git rev-parse --short HEAD)
   docker build -t mvilliger/sandbox-base:$TAG sandbox-base/
   docker tag  mvilliger/sandbox-base:$TAG mvilliger/sandbox-base:latest
   docker push mvilliger/sandbox-base:$TAG
   docker push mvilliger/sandbox-base:latest
   docker build -t mvilliger/discord-article-bot-agent:$TAG agent-sidecar/
   docker tag  mvilliger/discord-article-bot-agent:$TAG mvilliger/discord-article-bot-agent:latest
   docker push mvilliger/discord-article-bot-agent:$TAG
   docker push mvilliger/discord-article-bot-agent:latest
   ```
   The sandbox image is large (~8Gi); first push will take a while.

4. **Apply manifests (Task 9.2).** RuntimeClass already exists thanks to the Helm chart, so we don't apply `runtimeclass-kata.yaml` (it's kept in the repo as documentation only):
   ```bash
   kubectl apply -n discord-article-bot \
                  -f k8s/sandbox/sandbox-serviceaccount.yaml \
                  -f k8s/sandbox/agent-serviceaccount.yaml \
                  -f k8s/sandbox/agent-role.yaml \
                  -f k8s/sandbox/agent-rolebinding.yaml \
                  -f k8s/sandbox/configmap-sandbox.yaml \
                  -f k8s/sandbox/agent-networkpolicy.yaml \
                  -f k8s/sandbox/sandbox-networkpolicy.yaml \
                  -f k8s/overlays/deployed/networkpolicy.yaml \
                  -f k8s/overlays/deployed/deployment.yaml \
                  -f k8s/sandbox/agent-service.yaml \
                  -f k8s/overlays/deployed/agent-deployment.yaml
   kubectl rollout status deployment/discord-article-bot-agent -n discord-article-bot --timeout=120s
   ```

5. **RBAC verification (Task 9.3):**
   ```bash
   kubectl auth can-i --as=system:serviceaccount:discord-article-bot:sandbox-sa get pods -n discord-article-bot   # expect "no"
   kubectl auth can-i --as=system:serviceaccount:discord-article-bot:agent-sa create jobs -n discord-article-bot  # expect "yes"
   kubectl auth can-i --as=system:serviceaccount:discord-article-bot:agent-sa get nodes                            # expect "no"
   ```

6. **Manual integration tests (Task 9.4):** see the bullet list in the plan — each is an `@bot <prompt>` in Discord (or a `grpcurl` against the agent service from a debug pod). Cover: hello-world per language, wall-clock timeout, OOM, RFC1918 deny, public allow, DNS, no service-link env leak, no SA token, per-user cap, sidecar-down fallback, reaction reveal.

7. **Acceptance gate (Task 9.6):** bump version (`npm version minor --no-git-tag-version`), build/push the bot image, `kubectl set image`, then `git push -u origin feat/agentic-sandbox-skills-runtime` and open the PR.

## Verification on resume

```bash
cd /home/ubuntu/workspace/discord-article-bot
git log --oneline main..HEAD | head
npx jest
cd agent-sidecar && . .venv/bin/activate && make test
```

Expected: 28 commits ahead of main, 720 Node tests green, 45 Python tests green.
