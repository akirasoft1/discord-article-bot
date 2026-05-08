# Architecture

Three views of the Discord Article Bot:

1. [Software architecture](#software-architecture) — modules and their wiring
2. [Deployment architecture](#deployment-architecture) — how it runs on Kubernetes
3. [Channel-voice + sandbox sequence](#channel-voice--sandbox-sequence) — request lifecycle of the agentic path

---

## Software architecture

Modules are grouped by responsibility. Solid arrows are direct in-process calls; the agent boundary is gRPC.

```mermaid
graph TB
  subgraph Discord["Discord client surface"]
    DC[discord.js Client]
    MC[Message handler<br/>bot.js _handleMentionChat]
    RH[ReplyHandler]
    RxH[ReactionHandler]
    SCH[SlashCommandHandler]
    SLASH[20 slash commands<br/>commands/slash/*]
  end

  subgraph Chat["Chat orchestration"]
    CS[ChatService]
    CCS[ChannelContextService]
    VPS[VoiceProfileService]
    PERS[Personalities<br/>channel-voice]
  end

  subgraph Memory["Memory + storage"]
    MS[MongoService]
    QS[QdrantService]
    M0[Mem0Service]
    NMS[NickMappingService]
    STS[SandboxTraceService]
  end

  subgraph Agent["Agentic path"]
    AC[AgentClient<br/>gRPC + health poll]
    SIDE[(Python ADK sidecar<br/>see deployment view)]
  end

  subgraph Gen["Generation + tools"]
    SUM[SummarizationService]
    IMG[ImagenService]
    IPA[ImagePromptAnalyzerService]
    IRH[ImageRetryHandler]
    VEO[VeoService]
    LLS[LocalLlmService<br/>Ollama]
  end

  subgraph Aux["Auxiliary services"]
    RSS[RssService]
    FU[FollowUpService]
    LW[LinkwardenService]
    LWP[LinkwardenPollingService]
    CMU[CatchMeUpService]
    VSS[VoiceSearchService]
  end

  subgraph LLM["LLM providers"]
    OAI[OpenAI API]
    GEM[Gemini / Vertex AI]
    OLL[Ollama]
  end

  DC --> MC
  DC --> RxH
  DC --> SCH
  MC --> CS
  MC --> RH
  RH --> CS
  SCH --> SLASH

  CS --> PERS
  CS --> CCS
  CS --> VPS
  CS --> M0
  CS --> QS
  CS --> AC
  CS -.fallback.-> OAI

  CCS --> MS
  CCS --> QS
  CCS --> M0
  VPS --> MS
  VPS --> QS
  VPS --> CCS
  QS --> NMS

  AC -. gRPC .-> SIDE
  SIDE -. writes .-> MS
  RxH --> STS
  STS --> MS

  RH --> SUM
  RH --> IMG
  IRH --> IMG
  IRH --> IPA
  SUM --> OAI
  IMG --> GEM
  VEO --> GEM
  LLS --> OLL
  CMU --> MS
  CMU --> M0
  CMU --> OAI
  VSS --> QS
  VSS --> VPS
  VSS --> OAI
  RSS --> MS
  RSS --> SUM
  FU --> MS
  LWP --> LW
  LWP --> SUM
```

**Wiring notes**
- `ChatService` is the central orchestrator — it owns personality selection, memory enrichment, and the agent-vs-direct routing decision.
- `AgentClient.isHealthy()` is the binary switch: when the sidecar is reachable, channel-voice goes through the agent; otherwise it falls through to direct OpenAI with no user-visible change beyond losing tool use.
- `SandboxTraceService` is lazy-initialized inside `ReactionHandler` so the bot doesn't pay for it when sandbox is disabled.
- Memory has three tiers: in-process buffer (transient) → Qdrant (semantic recall over IRC + channel) → Mem0 (long-lived facts about users/channels).

---

## Deployment architecture

Single Kubernetes namespace (`discord-article-bot`), two long-lived pods, ephemeral sandbox pods spawned on demand.

```mermaid
graph TB
  subgraph DiscordCloud["discord.gg"]
    DAPI[Discord Gateway + REST]
  end

  subgraph K8s["Kubernetes namespace: discord-article-bot"]
    subgraph BotPod["Pod: discord-article-bot (bot)"]
      BOT[Node.js bot v2.13.x<br/>image: mvilliger/discord-article-bot:semver]
    end

    subgraph SidePod["Pod: discord-article-bot-agent (Recreate, 1 replica)"]
      ADK[Python ADK Agent<br/>gRPC :50051<br/>image: mvilliger/discord-article-bot-agent:SHA]
    end

    subgraph Sandbox["Ephemeral sandbox jobs (per call)"]
      direction LR
      KATA1[Kata VM pod<br/>runtimeClass: kata-qemu-runtime-rs<br/>image: mvilliger/sandbox-base:SHA<br/>dynatrace.com/inject: false<br/>readOnlyRootFs, drop-all caps]
    end

    SVC_AGENT[Service: agent-sidecar<br/>ClusterIP :50051]
    NP_BOT[NetworkPolicy: bot]
    NP_AGENT[NetworkPolicy: agent<br/>egress to apiserver via ipBlock]
    NP_SBX[NetworkPolicy: sandbox<br/>private CIDRs blocked]
    RC[RuntimeClass: kata-qemu-runtime-rs]
    CM_SBX[ConfigMap: sandbox-config<br/>AGENT_MODEL, SANDBOX_*]
    SA_AGENT[ServiceAccount + Role/Binding<br/>jobs/pods CRUD in own ns]
  end

  subgraph Backing["Backing services in cluster"]
    MONGO[(MongoDB)]
    QDR[(Qdrant)]
    OLLAMA[(Ollama 192.168.1.164)]
    LWS[(Linkwarden)]
  end

  subgraph SaaS["External APIs"]
    OAI2[OpenAI]
    GEM2[Vertex AI<br/>Imagen + Veo + Gemini]
    M0S[Mem0]
  end

  subgraph Obs["Observability"]
    DT[Dynatrace OTLP<br/>OneAgent NOT injected into sandbox]
  end

  DAPI <-. WSS gateway + REST .-> BOT
  BOT -. gRPC .-> SVC_AGENT
  SVC_AGENT --> ADK
  ADK -. K8s API: create/watch/delete Job .-> Sandbox
  ADK --> CM_SBX
  ADK --> SA_AGENT
  KATA1 -. egress: public CIDRs only .-> OAI2

  BOT --> MONGO
  BOT --> QDR
  BOT --> OLLAMA
  BOT --> LWS
  BOT --> OAI2
  BOT --> GEM2
  BOT --> M0S
  ADK --> MONGO
  ADK --> GEM2

  BOT -. OTLP traces .-> DT
  ADK -. OTLP traces .-> DT
```

**Operational invariants**
- **Single-replica `Recreate`** for the agent sidecar — concurrency state is in-process; do not scale.
- **Image pinning** — bot uses semver, agent + sandbox-base use git short-SHA. The `agent-deployment.yaml` enforces a lockstep rule: `containers[0].image` and the `SANDBOX_BASE_IMAGE` env var always carry the same SHA.
- **OneAgent exclusion** — sandbox pods carry `dynatrace.com/inject: "false"`. Without it, OneAgent prevents PID 1 from exiting and inflates per-call wall-clock to ~120s.
- **Private-network egress** is denied by NetworkPolicy by default; new integrations must add explicit ipBlock rules (see `CLAUDE.md`).
- **AGENT_ENABLED=false** flips channel-voice back to direct OpenAI without redeploy.

---

## Channel-voice + sandbox sequence

The happy path of a `@bot` mention in a channel-voice configured channel where the model decides to call `run_in_sandbox`. Direct-OpenAI fallback is shown as a dashed alt branch.

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Disc as Discord
  participant Bot as bot.js<br/>_handleMentionChat
  participant CS as ChatService
  participant AC as AgentClient<br/>(gRPC)
  participant ADK as ADK Agent<br/>(sidecar)
  participant Gem as Gemini API
  participant Orch as SandboxOrchestrator
  participant K8s as K8s API
  participant Kata as Kata sandbox pod
  participant Mongo as MongoDB
  participant RH as ReplyHandler<br/>+ MessageService

  User->>Disc: @bot write code to find Mersenne primes
  Disc->>Bot: messageCreate event
  Bot->>CS: chat(personalityId='channel-voice', userMessage, ...)
  CS->>CS: enrich with channel context, voice profile, memory

  alt Sidecar healthy (last health < 30s)
    CS->>AC: chat({user_id, user_message, ...})
    AC->>ADK: gRPC Chat RPC
    ADK->>Gem: generateContent(prompt + run_in_sandbox tool)
    Gem-->>ADK: tool_call run_in_sandbox(language, code)
    ADK->>Orch: run_in_sandbox(language, code, stdin)
    Orch->>K8s: create Job (Kata runtimeClass, ConfigMap env)
    K8s->>Kata: schedule + boot QEMU/KVM guest (~1.5–3s cold start)
    Kata->>Kata: executor.py runs code, captures stdout/stderr
    Kata-->>K8s: pod Completed
    Orch->>K8s: read logs, delete Job
    Orch->>Mongo: insert sandbox_executions doc<br/>{exit_code, stdout, stderr, duration_ms, code, ...}
    Orch-->>ADK: {exit_code, stdout, stderr, duration_ms, ...}
    ADK->>Gem: tool_result
    Gem-->>ADK: final assistant message
    ADK-->>AC: ChatResponse{message_text, summary{execution_ids}}
    AC-->>CS: response
  else Sidecar unhealthy or AGENT_ENABLED=false
    CS->>Gem: direct OpenAI/Gemini call (no tools)
    Gem-->>CS: assistant message
  end

  CS-->>Bot: response text + execution_ids
  Bot->>RH: send reply
  RH->>Disc: post message
  Bot->>Mongo: record bot reply → execution_ids mapping<br/>(for reaction reveal)

  Note over User,Disc: Optional: user reacts 🔍 / 📜 / 🐛
  User->>Disc: react 🔍 on bot reply
  Disc->>Bot: messageReactionAdd
  Bot->>RH: ReactionHandler.handleReaction
  RH->>Mongo: SandboxTraceService → fetch trace by id
  Mongo-->>RH: { code, stdout, stderr }
  RH->>Disc: attach source code as file
```

**Key timing + behavior facts**
- **Cold start adds ~1.5–3s per Kata call** — the agent prompt is aware of this so the model doesn't think the call hung.
- **Per-turn budget** is enforced by the agent (`SANDBOX_AGENT_TURN_CALL_BUDGET`) — the model can chain a few sandbox calls per user turn but not run unbounded.
- **Trace retention** — the sidecar's daily loop demotes traces beyond `SANDBOX_TRACE_RETENTION_PER_USER` (default 50) per user: keeps `exit_code`/`stdout`/`stderr`/`duration_ms`, nulls out `code`/`stdin`/`env_keys`/`egress_events`/`runtime_events`/`agent_rationale`.
- **Reaction reveal** — 🔍 returns source, 📜 returns stdout+stderr (when non-empty), 🐛 returns stderr only.
- **Failure modes** — sidecar unreachable, Gemini 4xx (logged via `_summarize_llm_error`), and sandbox Job timeouts all collapse to the dashed alt branch with no user-visible error beyond losing tool output.

---

## Cross-references

- `CLAUDE.md` — deployment workflow, NetworkPolicy rules, the lockstep image-tag rule
- `k8s/sandbox/README.md` — Kata install play-by-play (Helm `--set k8sDistribution=rke2`, RKE2 imports template patch, `kvm_amd sev=0` workaround, `dynatrace.com/inject: false`)
- `features.md` — user-facing feature catalogue
- `flow.md` — earlier message-flow notes (kept for historical context)
