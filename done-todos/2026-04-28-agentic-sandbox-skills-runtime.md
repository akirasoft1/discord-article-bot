# Agentic Sandbox Skills Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Addendum (2026-04-29):** The sandbox runtime was swapped from gVisor to
> Kata Containers (`runtimeClassName: kata-qemu`) before any of Phase 9 ran.
> Reason: Harvester's immutable host OS makes per-node `runsc` install
> fragile, and Kata's pod-as-tiny-VM model fits KubeVirt-on-bare-metal
> natively. Code, manifests, and tests have been updated in place; the
> trace field `gvisor_events` is now `runtime_events` (runtime-neutral
> name). See the spec's addendum for the full rationale and trade-offs,
> and `k8s/sandbox/README.md` for the `kata-deploy` install flow that
> replaces the per-node `runsc` prereq. The body of this plan still
> contains some historical "gVisor" wording in the as-shipped task
> snippets — treat those as historical context, not as instructions.

**Goal:** Add an ADK-backed agent sidecar with a single `run_in_sandbox` tool that lets the Discord bot autonomously execute user-prompted code in ephemeral Kata-isolated pods, with reaction-based output reveal in Discord.

**Architecture:** Node bot calls a new Python sidecar pod over gRPC. The sidecar hosts a `google-adk` Agent that, on its own initiative, calls `run_in_sandbox`, which the sidecar's in-process `SandboxOrchestrator` translates into a fresh K8s Job with `runtimeClassName: kata-qemu`. The sandbox pod has open public-internet egress but is denied RFC1918 + cluster CIDR + K8s API by NetworkPolicy. Per-execution traces persist to a new MongoDB collection. Bot UX is unchanged on the surface — `/chat`, `@mention`, and reply still work the same; reaction emojis (🔍 🐛 📜) on the bot's reply reveal full code/output as Discord attachments.

**Tech Stack:** Node 20, Python 3.12, `google-adk`, `grpcio` / `@grpc/grpc-js`, MongoDB, Kubernetes (Harvester / RKE2), Kata Containers (`kata-qemu`), Calico CNI, Debian-based sandbox image, Jest + pytest, OpenTelemetry → Dynatrace.

**Spec:** `docs/superpowers/specs/2026-04-28-agentic-sandbox-skills-runtime-design.md` — read this before starting.

---

## File Structure

This plan creates three new top-level directories, plus changes inside the existing Node app.

```
discord-article-bot/
├── agent-sidecar/                                        # NEW Python service
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── pyproject.toml
│   ├── proto/
│   │   └── agent.proto                                   # gRPC contract (also consumed by Node)
│   ├── src/
│   │   ├── __init__.py
│   │   ├── server.py                                     # gRPC server entrypoint
│   │   ├── agent.py                                      # ADK Agent assembly
│   │   ├── tools.py                                      # run_in_sandbox tool
│   │   ├── orchestrator.py                               # SandboxOrchestrator
│   │   ├── concurrency.py                                # per-user + global semaphores
│   │   ├── job_template.py                               # K8s Job spec generator
│   │   ├── log_partition.py                              # split combined log → stdout/stderr
│   │   ├── egress_scraper.py                             # CNI flow log scraper (best-effort)
│   │   ├── trace_store.py                                # writes sandbox_executions docs
│   │   ├── retention.py                                  # daily demotion cron
│   │   ├── config.py                                     # env-var → config object
│   │   └── tracing.py                                    # OTel exporter setup
│   └── tests/
│       ├── test_concurrency.py
│       ├── test_job_template.py
│       ├── test_log_partition.py
│       ├── test_orchestrator.py
│       ├── test_retention.py
│       ├── test_trace_store.py
│       └── test_tools.py
│
├── sandbox-base/                                         # NEW container image
│   ├── Dockerfile
│   ├── executor.py
│   └── README.md
│
├── services/
│   ├── AgentClient.js                                    # NEW gRPC client
│   ├── ChatService.js                                    # MODIFIED: route channel-voice through agent
│   └── SandboxTraceService.js                            # NEW: read-only Mongo accessor for reaction reveal
├── handlers/
│   └── ReactionHandler.js                                # MODIFIED: 🔍 / 📜 / 🐛 reveal cases
├── proto/
│   └── agent.proto                                       # symlink/copy of agent-sidecar/proto/agent.proto
├── config/
│   └── config.js                                         # MODIFIED: AGENT_ENABLED + sandbox knobs
├── bot.js                                                # MODIFIED: wire AgentClient into ChatService
├── k8s/overlays/deployed/
│   ├── runtimeclass-gvisor.yaml                          # NEW (cluster-wide, applied once)
│   ├── agent-deployment.yaml                             # NEW
│   ├── agent-service.yaml                                # NEW
│   ├── agent-serviceaccount.yaml                         # NEW
│   ├── agent-role.yaml                                   # NEW
│   ├── agent-rolebinding.yaml                            # NEW
│   ├── agent-networkpolicy.yaml                          # NEW
│   ├── sandbox-serviceaccount.yaml                       # NEW
│   ├── sandbox-networkpolicy.yaml                        # NEW
│   ├── configmap-sandbox.yaml                            # NEW (sandbox tunables)
│   └── networkpolicy.yaml                                # MODIFIED: add bot→agent egress
└── __tests__/
    ├── services/
    │   ├── AgentClient.test.js                           # NEW
    │   ├── ChatService.test.js                           # MODIFIED
    │   └── SandboxTraceService.test.js                   # NEW
    └── handlers/
        └── ReactionHandler.test.js                       # NEW (file doesn't exist yet) — covers 🔍/📜/🐛
```

**Decomposition principle:** the sidecar splits orchestration from agent assembly from concurrency from K8s details. Each sidecar module is < 200 LOC and has one job. The Node side is intentionally thin — only an `AgentClient` (gRPC adapter) and a `SandboxTraceService` (Mongo reader for reaction reveal). `ChatService` keeps its public contract; the change is internal routing.

---

## Phased Roadmap

The plan is organized in phases. Phases land independently and each leaves the bot working.

- **Phase 0** — Branch + scaffolding + spec sanity check (no functional change).
- **Phase 1** — Sandbox base image + executor.py (verifiable in isolation with `docker run`).
- **Phase 2** — Sidecar foundation: gRPC server, config, tracing, health endpoint (no agent, no sandbox, just the pod).
- **Phase 3** — Sandbox orchestrator + concurrency + job template + log partition + trace store (in-process tests, no agent yet).
- **Phase 4** — ADK agent + `run_in_sandbox` tool wired to orchestrator (sidecar end-to-end).
- **Phase 5** — Node `AgentClient` + `ChatService` integration + `AGENT_ENABLED` flag + fallback-on-down (bot can talk to agent).
- **Phase 6** — Reaction reveal: `SandboxTraceService` + `ReactionHandler` extensions + tests.
- **Phase 7** — Retention cron job (daily demotion).
- **Phase 8** — K8s manifests, RBAC, NetworkPolicies, deployment runbook.
- **Phase 9** — Integration testing on a real cluster + acceptance checklist.

Each task in each phase ends with a commit. Multi-task phases end with a phase-completion verification step.

---

## Phase 0 — Branch & Scaffolding

### Task 0.1: Create implementation branch off `main`

**Files:**
- (no file changes)

- [ ] **Step 1: Verify clean tree on main**

```bash
git status
git checkout main
git pull origin main
```

Expected: working tree clean; `On branch main`.

- [ ] **Step 2: Create branch**

```bash
git checkout -b feat/agentic-sandbox-skills-runtime
git branch --show-current
```

Expected output: `feat/agentic-sandbox-skills-runtime`.

- [ ] **Step 3: Create empty top-level dirs**

```bash
mkdir -p agent-sidecar/src agent-sidecar/tests agent-sidecar/proto sandbox-base proto
```

- [ ] **Step 4: Commit scaffolding**

```bash
git add agent-sidecar sandbox-base proto
git status
```

Expected: nothing staged (empty dirs aren't tracked by git). This is fine — actual files come in later tasks. Skip the commit; `git status` should show clean tree.

---

## Phase 1 — Sandbox Base Image

This phase produces a Docker image you can `docker run` standalone. It does not depend on K8s, gRPC, or the agent.

### Task 1.1: Write `executor.py`

**Files:**
- Create: `sandbox-base/executor.py`

- [ ] **Step 1: Create the executor**

```python
#!/usr/bin/env python3
"""Sandbox executor shim — reads {language, code, stdin?} from stdin,
runs it, exits with the child's exit code. Output is unmodified."""
import json
import pathlib
import subprocess
import sys
import tempfile

LANG_RUNNERS = {
    "bash":   ("sh",   None),
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


def main() -> None:
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
            capture_output=False,
            timeout=None,
        )
        sys.exit(result.returncode)
    except FileNotFoundError as e:
        print(f"runtime missing: {e}", file=sys.stderr)
        sys.exit(127)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Make executable locally for sanity check**

```bash
chmod +x sandbox-base/executor.py
echo '{"language":"python","code":"print(2+2)"}' | python3 sandbox-base/executor.py
```

Expected output: `4` then process exits 0.

- [ ] **Step 3: Commit**

```bash
git add sandbox-base/executor.py
git commit -m "feat(sandbox): add executor shim for sandbox base image"
```

### Task 1.2: Write the Dockerfile

**Files:**
- Create: `sandbox-base/Dockerfile`
- Create: `sandbox-base/README.md`

- [ ] **Step 1: Create Dockerfile**

```dockerfile
# sandbox-base/Dockerfile
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

# Pre-create writable dirs that are owned by nobody (uid 65534)
# These will be overlaid by emptyDir tmpfs at pod runtime, but having them
# pre-created with right ownership makes local docker-run testing work.
RUN mkdir -p /tmp /work && chown 65534:65534 /tmp /work

USER 65534
WORKDIR /work
ENTRYPOINT ["/usr/local/bin/executor"]
```

- [ ] **Step 2: Create README**

```markdown
# sandbox-base

Container image used by the agent-sidecar to spawn ephemeral execution pods.

## Build

```bash
docker build -t mvilliger/sandbox-base:$(git rev-parse --short HEAD) .
docker tag  mvilliger/sandbox-base:$(git rev-parse --short HEAD) mvilliger/sandbox-base:latest
docker push mvilliger/sandbox-base:$(git rev-parse --short HEAD)
docker push mvilliger/sandbox-base:latest
```

## Local smoke test

```bash
echo '{"language":"python","code":"print(2+2)"}' \
  | docker run --rm -i mvilliger/sandbox-base:latest
```

Expected: `4`, exit 0.

```bash
echo '{"language":"bash","code":"curl -s https://example.com | head -1"}' \
  | docker run --rm -i mvilliger/sandbox-base:latest
```

Expected: HTML doctype line, exit 0.

## Image contents

- python3, node 20, go, rust stable, .NET 8 SDK
- build-essential, git, jq, ripgrep
- nmap, dig, nc
- ollama (binary only; pull models at runtime via `ollama pull <model>`)

The image is ~3-4Gi. Pulled once per K8s node and cached.

## Security properties

- Runs as uid 65534 (nobody).
- No shell-escape pre-baked configuration. The `executor` is the only entrypoint.
- Image is consumed only by sandbox K8s pods that disable SA token automount,
  drop all capabilities, and run with `readOnlyRootFilesystem: true` plus
  `runtimeClassName: gvisor`.
```

- [ ] **Step 3: Build the image locally**

```bash
cd sandbox-base
docker build -t sandbox-base-test:dev .
cd ..
```

Expected: clean build. May take 10+ minutes on first run due to Rust toolchain.

- [ ] **Step 4: Smoke test each language**

```bash
echo '{"language":"python","code":"print(2+2)"}'                | docker run --rm -i sandbox-base-test:dev
echo '{"language":"node","code":"console.log(2+2)"}'             | docker run --rm -i sandbox-base-test:dev
echo '{"language":"go","code":"package main\nfunc main(){println(2+2)}"}' | docker run --rm -i sandbox-base-test:dev
echo '{"language":"bash","code":"echo hello"}'                   | docker run --rm -i sandbox-base-test:dev
```

Expected: each prints `4` (or `hello` for bash) and exits 0.

- [ ] **Step 5: Smoke test exit code propagation**

```bash
echo '{"language":"bash","code":"exit 7"}' | docker run --rm -i sandbox-base-test:dev; echo "exit=$?"
```

Expected: `exit=7`.

- [ ] **Step 6: Commit**

```bash
git add sandbox-base/Dockerfile sandbox-base/README.md
git commit -m "feat(sandbox): Dockerfile and README for sandbox base image"
```

---

## Phase 2 — Sidecar Foundation

This phase stands up a minimal Python gRPC server pod with health-only behavior. No agent, no sandbox spawning yet. Goal: a deployable sidecar.

### Task 2.1: Write the gRPC proto contract

**Files:**
- Create: `agent-sidecar/proto/agent.proto`
- Create: `proto/agent.proto` (copy — Node consumes from here)

- [ ] **Step 1: Write the proto**

```protobuf
syntax = "proto3";

package discordbot.agent;

service Agent {
  rpc Chat(ChatRequest) returns (ChatResponse);
  rpc Health(HealthRequest) returns (HealthResponse);
}

message ChatRequest {
  string user_id        = 1;
  string user_tag       = 2;
  string channel_id     = 3;
  string guild_id       = 4;
  string interaction_id = 5;
  string user_message   = 6;
  string image_url      = 7;
}

message ChatResponse {
  string message_text          = 1;
  repeated ImageAttachment images = 2;
  ExecutionSummary summary     = 3;
  bool fallback_occurred       = 4;
}

message ExecutionSummary {
  int32 execution_count          = 1;
  bool any_failed                = 2;
  repeated string execution_ids  = 3;
}

message ImageAttachment {
  bytes data        = 1;
  string filename   = 2;
  string mime_type  = 3;
}

message HealthRequest {}
message HealthResponse {
  bool healthy = 1;
}
```

- [ ] **Step 2: Mirror to Node-side proto dir**

```bash
cp agent-sidecar/proto/agent.proto proto/agent.proto
diff agent-sidecar/proto/agent.proto proto/agent.proto
```

Expected: no output (files identical).

- [ ] **Step 3: Commit**

```bash
git add agent-sidecar/proto/agent.proto proto/agent.proto
git commit -m "feat(agent): gRPC contract for bot↔sidecar"
```

### Task 2.2: Sidecar Python project skeleton

**Files:**
- Create: `agent-sidecar/requirements.txt`
- Create: `agent-sidecar/pyproject.toml`
- Create: `agent-sidecar/src/__init__.py`
- Create: `agent-sidecar/src/config.py`

- [ ] **Step 1: requirements.txt**

```txt
google-adk>=0.5.0
grpcio>=1.66.0
grpcio-tools>=1.66.0
kubernetes>=30.0.0
pymongo>=4.10.0
opentelemetry-api>=1.27.0
opentelemetry-sdk>=1.27.0
opentelemetry-exporter-otlp>=1.27.0
opentelemetry-instrumentation-grpc>=0.48b0
pytest>=8.3.0
pytest-asyncio>=0.24.0
```

- [ ] **Step 2: pyproject.toml**

```toml
[project]
name = "discord-article-bot-agent"
version = "0.1.0"
requires-python = ">=3.12"

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
pythonpath = ["src"]

[tool.setuptools.packages.find]
where = ["src"]
```

- [ ] **Step 3: src/__init__.py**

```python
"""discord-article-bot agent sidecar."""
```

- [ ] **Step 4: src/config.py**

```python
"""Environment-driven configuration for the agent sidecar."""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    # gRPC
    grpc_listen_addr: str

    # OpenAI (borrowed from bot's secret mount)
    openai_api_key: str
    openai_model: str

    # MongoDB
    mongo_uri: str

    # Sandbox knobs (mirror the spec's ConfigMap)
    sandbox_inline_output_chars: int
    sandbox_wall_clock_seconds: int
    sandbox_per_user_concurrency: int
    sandbox_global_concurrency: int
    sandbox_memory_limit: str
    sandbox_cpu_limit: str
    sandbox_base_image: str
    sandbox_trace_retention_per_user: int
    sandbox_agent_turn_call_budget: int

    # K8s
    k8s_namespace: str

    # OTel
    otlp_endpoint: str | None
    otlp_headers: str | None


def load() -> Config:
    return Config(
        grpc_listen_addr=os.environ.get("GRPC_LISTEN_ADDR", "0.0.0.0:50051"),
        openai_api_key=os.environ["OPENAI_API_KEY"],
        openai_model=os.environ.get("OPENAI_MODEL", "gpt-5.1"),
        mongo_uri=os.environ["MONGO_URI"],
        sandbox_inline_output_chars=int(os.environ.get("SANDBOX_INLINE_OUTPUT_CHARS", "750")),
        sandbox_wall_clock_seconds=int(os.environ.get("SANDBOX_WALL_CLOCK_SECONDS", "300")),
        sandbox_per_user_concurrency=int(os.environ.get("SANDBOX_PER_USER_CONCURRENCY", "2")),
        sandbox_global_concurrency=int(os.environ.get("SANDBOX_GLOBAL_CONCURRENCY", "15")),
        sandbox_memory_limit=os.environ.get("SANDBOX_MEMORY_LIMIT", "2Gi"),
        sandbox_cpu_limit=os.environ.get("SANDBOX_CPU_LIMIT", "2"),
        sandbox_base_image=os.environ["SANDBOX_BASE_IMAGE"],
        sandbox_trace_retention_per_user=int(os.environ.get("SANDBOX_TRACE_RETENTION_PER_USER", "50")),
        sandbox_agent_turn_call_budget=int(os.environ.get("SANDBOX_AGENT_TURN_CALL_BUDGET", "8")),
        k8s_namespace=os.environ.get("K8S_NAMESPACE", "discord-article-bot"),
        otlp_endpoint=os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"),
        otlp_headers=os.environ.get("OTEL_EXPORTER_OTLP_HEADERS"),
    )
```

- [ ] **Step 5: Commit**

```bash
git add agent-sidecar/requirements.txt agent-sidecar/pyproject.toml agent-sidecar/src/__init__.py agent-sidecar/src/config.py
git commit -m "feat(agent): Python project skeleton + config loader"
```

### Task 2.3: Generate gRPC stubs (Python)

**Files:**
- Create: `agent-sidecar/Makefile`
- Generated: `agent-sidecar/src/agent_pb2.py`, `agent-sidecar/src/agent_pb2_grpc.py`

- [ ] **Step 1: Add Makefile**

```makefile
.PHONY: protoc test

protoc:
	python3 -m grpc_tools.protoc \
	  -I proto \
	  --python_out=src \
	  --grpc_python_out=src \
	  proto/agent.proto

test:
	pytest -v
```

- [ ] **Step 2: Install deps in a venv**

```bash
cd agent-sidecar
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

- [ ] **Step 3: Generate stubs**

```bash
make protoc
ls src/agent_pb2.py src/agent_pb2_grpc.py
```

Expected: both files present.

- [ ] **Step 4: Add generated files to gitignore — wait, NO. We DO commit them.**

Generated stubs are committed so the sidecar Docker build doesn't need `grpcio-tools` at build time. This is the standard convention for protobuf in Python.

- [ ] **Step 5: Commit**

```bash
cd ..
git add agent-sidecar/Makefile agent-sidecar/src/agent_pb2.py agent-sidecar/src/agent_pb2_grpc.py
git commit -m "feat(agent): protoc stubs + Makefile"
```

### Task 2.4: gRPC server with Health-only impl

**Files:**
- Create: `agent-sidecar/src/server.py`
- Create: `agent-sidecar/src/tracing.py`
- Create: `agent-sidecar/tests/test_server_health.py`

- [ ] **Step 1: Write the failing health test**

```python
# agent-sidecar/tests/test_server_health.py
import grpc
import pytest
from concurrent import futures

from src import agent_pb2, agent_pb2_grpc
from src.server import AgentServicer


@pytest.fixture
def grpc_server():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=2))
    agent_pb2_grpc.add_AgentServicer_to_server(AgentServicer(), server)
    port = server.add_insecure_port("127.0.0.1:0")
    server.start()
    yield port
    server.stop(grace=0)


def test_health_returns_healthy(grpc_server):
    port = grpc_server
    with grpc.insecure_channel(f"127.0.0.1:{port}") as channel:
        stub = agent_pb2_grpc.AgentStub(channel)
        resp = stub.Health(agent_pb2.HealthRequest())
    assert resp.healthy is True


def test_chat_unimplemented_for_now(grpc_server):
    port = grpc_server
    with grpc.insecure_channel(f"127.0.0.1:{port}") as channel:
        stub = agent_pb2_grpc.AgentStub(channel)
        with pytest.raises(grpc.RpcError) as exc:
            stub.Chat(agent_pb2.ChatRequest(user_id="u", user_message="hi"))
    assert exc.value.code() == grpc.StatusCode.UNIMPLEMENTED
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd agent-sidecar
. .venv/bin/activate
make test
```

Expected: `ModuleNotFoundError: src.server` or `ImportError: AgentServicer`.

- [ ] **Step 3: Write tracing.py**

```python
"""OpenTelemetry exporter setup; no-op when no OTLP endpoint configured."""
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from .config import Config


def setup(config: Config) -> None:
    resource = Resource.create({"service.name": "discord-article-bot-agent"})
    provider = TracerProvider(resource=resource)
    if config.otlp_endpoint:
        provider.add_span_processor(
            BatchSpanProcessor(OTLPSpanExporter(endpoint=config.otlp_endpoint))
        )
    trace.set_tracer_provider(provider)
```

- [ ] **Step 4: Write server.py with Health-only impl**

```python
"""gRPC server entrypoint for the agent sidecar."""
import logging
import signal
from concurrent import futures

import grpc

from . import agent_pb2, agent_pb2_grpc
from .config import load as load_config
from .tracing import setup as setup_tracing

log = logging.getLogger(__name__)


class AgentServicer(agent_pb2_grpc.AgentServicer):
    def __init__(self) -> None:
        pass

    def Health(self, request: agent_pb2.HealthRequest, context):  # noqa: N802
        return agent_pb2.HealthResponse(healthy=True)

    def Chat(self, request: agent_pb2.ChatRequest, context):  # noqa: N802
        # Wired in Phase 4.
        context.set_code(grpc.StatusCode.UNIMPLEMENTED)
        context.set_details("Chat not yet implemented")
        return agent_pb2.ChatResponse()


def serve() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    config = load_config()
    setup_tracing(config)
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=16))
    agent_pb2_grpc.add_AgentServicer_to_server(AgentServicer(), server)
    server.add_insecure_port(config.grpc_listen_addr)
    server.start()
    log.info(f"agent sidecar listening on {config.grpc_listen_addr}")

    def handle_term(signum, frame):
        log.info("shutting down (signal %s)", signum)
        server.stop(grace=10)

    signal.signal(signal.SIGTERM, handle_term)
    signal.signal(signal.SIGINT, handle_term)
    server.wait_for_termination()


if __name__ == "__main__":
    serve()
```

- [ ] **Step 5: Run the test to confirm it passes**

```bash
make test
```

Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
cd ..
git add agent-sidecar/src/server.py agent-sidecar/src/tracing.py agent-sidecar/tests/test_server_health.py
git commit -m "feat(agent): gRPC server skeleton with Health endpoint"
```

### Task 2.5: Sidecar Dockerfile

**Files:**
- Create: `agent-sidecar/Dockerfile`
- Create: `agent-sidecar/.dockerignore`

- [ ] **Step 1: Dockerfile**

```dockerfile
# agent-sidecar/Dockerfile
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY proto/ ./proto/

ENV PYTHONUNBUFFERED=1 PYTHONPATH=/app

USER 1000
EXPOSE 50051
CMD ["python", "-m", "src.server"]
```

- [ ] **Step 2: .dockerignore**

```text
.venv
__pycache__
*.pyc
tests
.pytest_cache
```

- [ ] **Step 3: Build locally**

```bash
cd agent-sidecar
docker build -t agent-sidecar-test:dev .
cd ..
```

Expected: clean build.

- [ ] **Step 4: Smoke run (won't fully start without env vars, but should fail past config load)**

```bash
docker run --rm \
  -e OPENAI_API_KEY=dummy \
  -e MONGO_URI=mongodb://localhost \
  -e SANDBOX_BASE_IMAGE=dummy:latest \
  agent-sidecar-test:dev &
DOCKER_PID=$!
sleep 2
docker ps | grep agent-sidecar-test || echo "EXITED — check below"
docker logs $(docker ps -aq -f ancestor=agent-sidecar-test:dev) 2>&1 | tail -20
docker stop $(docker ps -q -f ancestor=agent-sidecar-test:dev) 2>/dev/null || true
```

Expected log line: `agent sidecar listening on 0.0.0.0:50051`.

- [ ] **Step 5: Commit**

```bash
git add agent-sidecar/Dockerfile agent-sidecar/.dockerignore
git commit -m "feat(agent): sidecar Dockerfile"
```

---

## Phase 3 — Sandbox Orchestrator

Builds the in-process orchestrator that creates K8s Jobs, manages concurrency, captures logs, scrapes egress events, and writes traces. Tested in isolation with a mocked K8s client. Real K8s integration deferred to Phase 9.

### Task 3.1: Concurrency gate

**Files:**
- Create: `agent-sidecar/src/concurrency.py`
- Create: `agent-sidecar/tests/test_concurrency.py`

- [ ] **Step 1: Write failing tests**

```python
# agent-sidecar/tests/test_concurrency.py
import asyncio
import pytest

from src.concurrency import ConcurrencyGate, GateAcquireError


async def test_acquire_within_caps_succeeds():
    gate = ConcurrencyGate(per_user=2, global_=15)
    async with gate.acquire(user_id="u1"):
        async with gate.acquire(user_id="u1"):
            pass


async def test_per_user_cap_blocks_third_for_same_user():
    gate = ConcurrencyGate(per_user=2, global_=15)

    async def hold():
        async with gate.acquire(user_id="u1"):
            await asyncio.sleep(0.5)

    t1 = asyncio.create_task(hold())
    t2 = asyncio.create_task(hold())
    await asyncio.sleep(0.05)  # let them grab their slots

    with pytest.raises(GateAcquireError) as exc:
        async with gate.acquire(user_id="u1", wait=False):
            pass
    assert exc.value.scope == "user"

    await t1
    await t2


async def test_per_user_cap_does_not_block_other_users():
    gate = ConcurrencyGate(per_user=2, global_=15)

    async def hold(user):
        async with gate.acquire(user_id=user):
            await asyncio.sleep(0.3)

    holders = [asyncio.create_task(hold("u1")) for _ in range(2)]
    await asyncio.sleep(0.05)

    async with gate.acquire(user_id="u2", wait=False):
        pass  # u2 unaffected

    await asyncio.gather(*holders)


async def test_global_cap_blocks_when_exhausted():
    gate = ConcurrencyGate(per_user=10, global_=2)

    async def hold(user):
        async with gate.acquire(user_id=user):
            await asyncio.sleep(0.3)

    holders = [asyncio.create_task(hold(f"u{i}")) for i in range(2)]
    await asyncio.sleep(0.05)

    with pytest.raises(GateAcquireError) as exc:
        async with gate.acquire(user_id="u3", wait=False):
            pass
    assert exc.value.scope == "global"

    await asyncio.gather(*holders)
```

- [ ] **Step 2: Run tests to confirm fail**

```bash
cd agent-sidecar && . .venv/bin/activate && pytest tests/test_concurrency.py -v
```

Expected: `ImportError: cannot import name 'ConcurrencyGate'`.

- [ ] **Step 3: Implement ConcurrencyGate**

```python
# agent-sidecar/src/concurrency.py
"""Per-user + global concurrency gate.

Single-replica sidecar only; uses asyncio primitives. Documented constraint:
do not scale this sidecar past 1 replica without distributed coordination.
"""
import asyncio
from collections import defaultdict
from contextlib import asynccontextmanager
from dataclasses import dataclass


@dataclass
class GateAcquireError(Exception):
    scope: str  # "user" or "global"

    def __str__(self) -> str:
        return f"concurrency cap exceeded ({self.scope})"


class ConcurrencyGate:
    def __init__(self, per_user: int, global_: int) -> None:
        self._per_user = per_user
        self._global = global_
        self._user_counts: dict[str, int] = defaultdict(int)
        self._global_count = 0
        self._lock = asyncio.Lock()
        self._cond = asyncio.Condition(self._lock)

    @asynccontextmanager
    async def acquire(self, *, user_id: str, wait: bool = True):
        async with self._lock:
            while not self._can_admit(user_id):
                if not wait:
                    raise GateAcquireError(scope=self._blocking_scope(user_id))
                await self._cond.wait()
            self._user_counts[user_id] += 1
            self._global_count += 1
        try:
            yield
        finally:
            async with self._lock:
                self._user_counts[user_id] -= 1
                if self._user_counts[user_id] == 0:
                    del self._user_counts[user_id]
                self._global_count -= 1
                self._cond.notify_all()

    def _can_admit(self, user_id: str) -> bool:
        return (
            self._user_counts[user_id] < self._per_user
            and self._global_count < self._global
        )

    def _blocking_scope(self, user_id: str) -> str:
        if self._global_count >= self._global:
            return "global"
        return "user"
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
pytest tests/test_concurrency.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cd ..
git add agent-sidecar/src/concurrency.py agent-sidecar/tests/test_concurrency.py
git commit -m "feat(agent): concurrency gate with per-user + global caps"
```

### Task 3.2: K8s Job template generator

**Files:**
- Create: `agent-sidecar/src/job_template.py`
- Create: `agent-sidecar/tests/test_job_template.py`

- [ ] **Step 1: Write failing tests**

```python
# agent-sidecar/tests/test_job_template.py
from src.job_template import build_job_spec


def test_runtime_class_is_gvisor():
    spec = build_job_spec(
        execution_id="abc-1234",
        user_id="discord-user-1",
        image="sandbox-base:test",
        wall_clock_seconds=300,
        cpu_limit="2",
        memory_limit="2Gi",
        env={},
        namespace="discord-article-bot",
    )
    assert spec["spec"]["template"]["spec"]["runtimeClassName"] == "gvisor"


def test_no_sa_token_mounted():
    spec = build_job_spec(
        execution_id="abc-1234", user_id="u", image="x:y",
        wall_clock_seconds=300, cpu_limit="2", memory_limit="2Gi",
        env={}, namespace="ns",
    )
    assert spec["spec"]["template"]["spec"]["automountServiceAccountToken"] is False
    assert spec["spec"]["template"]["spec"]["serviceAccountName"] == "sandbox-sa"


def test_service_links_disabled():
    spec = build_job_spec(
        execution_id="x", user_id="u", image="x:y",
        wall_clock_seconds=300, cpu_limit="2", memory_limit="2Gi",
        env={}, namespace="ns",
    )
    assert spec["spec"]["template"]["spec"]["enableServiceLinks"] is False


def test_pod_runs_as_nobody_with_dropped_caps():
    spec = build_job_spec(
        execution_id="x", user_id="u", image="x:y",
        wall_clock_seconds=300, cpu_limit="2", memory_limit="2Gi",
        env={}, namespace="ns",
    )
    pod = spec["spec"]["template"]["spec"]
    assert pod["securityContext"]["runAsUser"] == 65534
    assert pod["securityContext"]["runAsNonRoot"] is True
    container = pod["containers"][0]
    assert container["securityContext"]["readOnlyRootFilesystem"] is True
    assert container["securityContext"]["allowPrivilegeEscalation"] is False
    assert container["securityContext"]["capabilities"]["drop"] == ["ALL"]


def test_resource_limits_applied():
    spec = build_job_spec(
        execution_id="x", user_id="u", image="x:y",
        wall_clock_seconds=300, cpu_limit="2", memory_limit="2Gi",
        env={}, namespace="ns",
    )
    container = spec["spec"]["template"]["spec"]["containers"][0]
    assert container["resources"]["limits"]["cpu"] == "2"
    assert container["resources"]["limits"]["memory"] == "2Gi"
    assert container["resources"]["limits"]["ephemeral-storage"] == "256Mi"


def test_active_deadline_seconds_set():
    spec = build_job_spec(
        execution_id="x", user_id="u", image="x:y",
        wall_clock_seconds=300, cpu_limit="2", memory_limit="2Gi",
        env={}, namespace="ns",
    )
    assert spec["spec"]["activeDeadlineSeconds"] == 300
    assert spec["spec"]["backoffLimit"] == 0
    assert spec["spec"]["ttlSecondsAfterFinished"] == 30


def test_labels_include_user_and_execution():
    spec = build_job_spec(
        execution_id="exec-id-123", user_id="user-id-456", image="x:y",
        wall_clock_seconds=300, cpu_limit="2", memory_limit="2Gi",
        env={}, namespace="ns",
    )
    labels = spec["spec"]["template"]["metadata"]["labels"]
    assert labels["app.kubernetes.io/component"] == "sandbox"
    assert labels["sandbox.user-id"] == "user-id-456"
    assert labels["sandbox.execution-id"] == "exec-id-123"


def test_user_supplied_env_passed_through():
    spec = build_job_spec(
        execution_id="x", user_id="u", image="x:y",
        wall_clock_seconds=300, cpu_limit="2", memory_limit="2Gi",
        env={"OPENAI_API_KEY": "sk-user-supplied", "WEIRD_VAR": "hello"},
        namespace="ns",
    )
    env = spec["spec"]["template"]["spec"]["containers"][0]["env"]
    by_name = {e["name"]: e["value"] for e in env}
    assert by_name["OPENAI_API_KEY"] == "sk-user-supplied"
    assert by_name["WEIRD_VAR"] == "hello"


def test_volumes_are_tmpfs_emptydirs():
    spec = build_job_spec(
        execution_id="x", user_id="u", image="x:y",
        wall_clock_seconds=300, cpu_limit="2", memory_limit="2Gi",
        env={}, namespace="ns",
    )
    vols = {v["name"]: v for v in spec["spec"]["template"]["spec"]["volumes"]}
    for name in ("tmp", "work"):
        assert vols[name]["emptyDir"]["medium"] == "Memory"
        assert vols[name]["emptyDir"]["sizeLimit"] == "256Mi"
```

- [ ] **Step 2: Run tests; expect ImportError**

```bash
cd agent-sidecar && . .venv/bin/activate && pytest tests/test_job_template.py -v
```

- [ ] **Step 3: Implement job_template.py**

```python
"""K8s Job spec generator for sandbox executions."""
from typing import Any


def build_job_spec(
    *,
    execution_id: str,
    user_id: str,
    image: str,
    wall_clock_seconds: int,
    cpu_limit: str,
    memory_limit: str,
    env: dict[str, str],
    namespace: str,
) -> dict[str, Any]:
    """Build a K8s Job spec for a single sandbox execution.

    The Job runs one Pod with one container under runtimeClassName: gvisor.
    Returns a plain dict suitable for kubernetes BatchV1Api.create_namespaced_job.
    """
    user_short = user_id[:8] if user_id else "anon"
    return {
        "apiVersion": "batch/v1",
        "kind": "Job",
        "metadata": {
            "generateName": f"sandbox-{user_short}-",
            "namespace": namespace,
            "labels": {
                "app.kubernetes.io/component": "sandbox",
                "sandbox.user-id": user_id,
                "sandbox.execution-id": execution_id,
            },
        },
        "spec": {
            "ttlSecondsAfterFinished": 30,
            "backoffLimit": 0,
            "activeDeadlineSeconds": wall_clock_seconds,
            "template": {
                "metadata": {
                    "labels": {
                        "app.kubernetes.io/component": "sandbox",
                        "sandbox.execution-id": execution_id,
                    },
                },
                "spec": {
                    "runtimeClassName": "gvisor",
                    "automountServiceAccountToken": False,
                    "serviceAccountName": "sandbox-sa",
                    "restartPolicy": "Never",
                    "enableServiceLinks": False,
                    "securityContext": {
                        "runAsUser": 65534,
                        "runAsGroup": 65534,
                        "runAsNonRoot": True,
                        "fsGroup": 65534,
                        "seccompProfile": {"type": "RuntimeDefault"},
                    },
                    "containers": [
                        {
                            "name": "executor",
                            "image": image,
                            "imagePullPolicy": "IfNotPresent",
                            "command": ["/usr/local/bin/executor"],
                            "stdin": True,
                            "stdinOnce": True,
                            "tty": False,
                            "resources": {
                                "requests": {"cpu": "500m", "memory": "512Mi"},
                                "limits": {
                                    "cpu": cpu_limit,
                                    "memory": memory_limit,
                                    "ephemeral-storage": "256Mi",
                                },
                            },
                            "securityContext": {
                                "allowPrivilegeEscalation": False,
                                "readOnlyRootFilesystem": True,
                                "capabilities": {"drop": ["ALL"]},
                            },
                            "volumeMounts": [
                                {"name": "tmp", "mountPath": "/tmp"},
                                {"name": "work", "mountPath": "/work"},
                            ],
                            "workingDir": "/work",
                            "env": [{"name": k, "value": v} for k, v in env.items()],
                        }
                    ],
                    "volumes": [
                        {
                            "name": "tmp",
                            "emptyDir": {"sizeLimit": "256Mi", "medium": "Memory"},
                        },
                        {
                            "name": "work",
                            "emptyDir": {"sizeLimit": "256Mi", "medium": "Memory"},
                        },
                    ],
                },
            },
        },
    }
```

- [ ] **Step 4: Run tests; expect pass**

```bash
pytest tests/test_job_template.py -v
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
cd ..
git add agent-sidecar/src/job_template.py agent-sidecar/tests/test_job_template.py
git commit -m "feat(agent): K8s Job spec generator"
```

### Task 3.3: Log partitioning

K8s Pod logs combine stdout and stderr. The executor uses `subprocess.run(capture_output=False)` so each stream goes to its own underlying file descriptor — but K8s' `kubectl logs` returns them interleaved by default. We need a way to split them. Approach: have the executor write a sentinel-prefixed line for stderr (`__SBSTDERR__:<line>`). Update Phase 1 executor accordingly *before* the partitioner can be tested faithfully — but split this so tests can run on synthetic data first.

**Files:**
- Modify: `sandbox-base/executor.py:32-67` — capture stdout/stderr, prefix stderr lines
- Create: `agent-sidecar/src/log_partition.py`
- Create: `agent-sidecar/tests/test_log_partition.py`

- [ ] **Step 1: Update executor to prefix stderr**

Replace the `subprocess.run` call in `sandbox-base/executor.py` with:

```python
    try:
        result = subprocess.run(
            proc_argv,
            input=stdin_data,
            text=True,
            capture_output=True,
            timeout=None,
        )
        if result.stdout:
            sys.stdout.write(result.stdout)
        if result.stderr:
            for line in result.stderr.splitlines():
                sys.stdout.write(f"__SBSTDERR__:{line}\n")
        sys.stdout.flush()
        sys.exit(result.returncode)
    except FileNotFoundError as e:
        sys.stdout.write(f"__SBSTDERR__:runtime missing: {e}\n")
        sys.exit(127)
```

- [ ] **Step 2: Smoke test the executor change locally**

```bash
echo '{"language":"python","code":"import sys; print(\"out\"); print(\"err\", file=sys.stderr)"}' \
  | python3 sandbox-base/executor.py
```

Expected output:
```
out
__SBSTDERR__:err
```

- [ ] **Step 3: Write failing partition tests**

```python
# agent-sidecar/tests/test_log_partition.py
from src.log_partition import partition_logs


def test_pure_stdout():
    assert partition_logs("hello\nworld\n") == ("hello\nworld\n", "")


def test_pure_stderr():
    raw = "__SBSTDERR__:oops\n__SBSTDERR__:bad\n"
    assert partition_logs(raw) == ("", "oops\nbad\n")


def test_mixed_preserves_order_per_stream():
    raw = "out1\n__SBSTDERR__:err1\nout2\n__SBSTDERR__:err2\n"
    stdout, stderr = partition_logs(raw)
    assert stdout == "out1\nout2\n"
    assert stderr == "err1\nerr2\n"


def test_empty_input():
    assert partition_logs("") == ("", "")


def test_line_without_trailing_newline_preserved():
    raw = "out1\n__SBSTDERR__:err1"
    stdout, stderr = partition_logs(raw)
    assert stdout == "out1\n"
    assert stderr == "err1"
```

- [ ] **Step 4: Run; expect ImportError**

```bash
cd agent-sidecar && . .venv/bin/activate && pytest tests/test_log_partition.py -v
```

- [ ] **Step 5: Implement log_partition.py**

```python
"""Split combined pod logs into stdout/stderr streams.

The sandbox executor prefixes stderr lines with __SBSTDERR__: so they can
be separated from stdout in K8s pod logs. This module reverses that.
"""
STDERR_PREFIX = "__SBSTDERR__:"


def partition_logs(raw: str) -> tuple[str, str]:
    if not raw:
        return "", ""
    stdout_parts: list[str] = []
    stderr_parts: list[str] = []
    has_trailing_newline = raw.endswith("\n")
    lines = raw.split("\n")
    if has_trailing_newline:
        lines = lines[:-1]
    for line in lines:
        if line.startswith(STDERR_PREFIX):
            stderr_parts.append(line[len(STDERR_PREFIX):])
        else:
            stdout_parts.append(line)
    stdout = "\n".join(stdout_parts)
    stderr = "\n".join(stderr_parts)
    if has_trailing_newline:
        if stdout_parts:
            stdout += "\n"
        if stderr_parts:
            stderr += "\n"
    return stdout, stderr
```

- [ ] **Step 6: Run tests; expect pass**

```bash
pytest tests/test_log_partition.py -v
```

Expected: 5 passed.

- [ ] **Step 7: Commit**

```bash
cd ..
git add sandbox-base/executor.py agent-sidecar/src/log_partition.py agent-sidecar/tests/test_log_partition.py
git commit -m "feat(sandbox): stderr line prefixing + partition module"
```

### Task 3.4: Trace store

**Files:**
- Create: `agent-sidecar/src/trace_store.py`
- Create: `agent-sidecar/tests/test_trace_store.py`

- [ ] **Step 1: Write failing tests using mongomock**

Add to `agent-sidecar/requirements.txt`:

```text
mongomock>=4.3.0
```

Reinstall:

```bash
cd agent-sidecar && . .venv/bin/activate && pip install mongomock
```

Tests:

```python
# agent-sidecar/tests/test_trace_store.py
from datetime import datetime, timezone

import mongomock
import pytest

from src.trace_store import TraceStore, ExecutionRecord


@pytest.fixture
def store():
    client = mongomock.MongoClient()
    return TraceStore(db=client["bot"])


async def test_record_persists_doc(store):
    rec = ExecutionRecord(
        execution_id="exec-1",
        parent_interaction_id="msg-1",
        user_id="u1",
        user_tag="test#0001",
        channel_id="c1",
        guild_id="g1",
        agent_turn_index=0,
        agent_rationale="testing",
        language="python",
        code="print(1)",
        stdin=None,
        env_keys=[],
        exit_code=0,
        stdout="1\n",
        stderr="",
        stdout_truncated=False,
        stderr_truncated=False,
        duration_ms=100,
        schedule_wait_ms=50,
        timed_out=False,
        oom_killed=False,
        orchestrator_error=None,
        egress_events=[],
        gvisor_events=[],
        resource_usage={"peak_memory_bytes": None, "cpu_seconds": None},
        pod_name="sandbox-u1-x",
        node_name=None,
    )
    await store.record(rec)
    docs = list(store._db.sandbox_executions.find())
    assert len(docs) == 1
    assert docs[0]["exit_code"] == 0
    assert docs[0]["language"] == "python"
    assert "created_at" in docs[0]


async def test_get_by_execution_id(store):
    rec = ExecutionRecord(
        execution_id="exec-2",
        parent_interaction_id="m",
        user_id="u",
        user_tag="t#0",
        channel_id="c",
        guild_id="g",
        agent_turn_index=0,
        agent_rationale=None,
        language="bash",
        code="echo hi",
        stdin=None,
        env_keys=[],
        exit_code=0,
        stdout="hi\n",
        stderr="",
        stdout_truncated=False,
        stderr_truncated=False,
        duration_ms=10,
        schedule_wait_ms=5,
        timed_out=False,
        oom_killed=False,
        orchestrator_error=None,
        egress_events=[],
        gvisor_events=[],
        resource_usage={"peak_memory_bytes": None, "cpu_seconds": None},
        pod_name="x",
        node_name=None,
    )
    await store.record(rec)
    fetched = await store.get_by_execution_id("exec-2")
    assert fetched["execution_id"] == "exec-2"
    assert fetched["stdout"] == "hi\n"
```

- [ ] **Step 2: Run; expect ImportError**

```bash
pytest tests/test_trace_store.py -v
```

- [ ] **Step 3: Implement trace_store.py**

```python
"""Persists sandbox_executions documents to MongoDB."""
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any


@dataclass
class ExecutionRecord:
    execution_id: str
    parent_interaction_id: str
    user_id: str
    user_tag: str
    channel_id: str
    guild_id: str
    agent_turn_index: int
    agent_rationale: str | None
    language: str
    code: str
    stdin: str | None
    env_keys: list[str]
    exit_code: int
    stdout: str
    stderr: str
    stdout_truncated: bool
    stderr_truncated: bool
    duration_ms: int
    schedule_wait_ms: int
    timed_out: bool
    oom_killed: bool
    orchestrator_error: str | None
    egress_events: list[dict[str, Any]]
    gvisor_events: list[dict[str, Any]]
    resource_usage: dict[str, Any]
    pod_name: str
    node_name: str | None


class TraceStore:
    def __init__(self, db) -> None:  # `db` is a pymongo Database (or mongomock equivalent)
        self._db = db
        self._coll = db.sandbox_executions

    async def record(self, rec: ExecutionRecord) -> None:
        doc = asdict(rec)
        doc["created_at"] = datetime.now(tz=timezone.utc)
        doc["demoted_at"] = None
        self._coll.insert_one(doc)

    async def get_by_execution_id(self, execution_id: str) -> dict[str, Any] | None:
        return self._coll.find_one({"execution_id": execution_id})

    def ensure_indexes(self) -> None:
        self._coll.create_index([("user_id", 1), ("created_at", -1)])
        self._coll.create_index("parent_interaction_id")
        self._coll.create_index([("created_at", -1)])
        self._coll.create_index("egress_events.dst_ip", sparse=True)
```

- [ ] **Step 4: Run tests; expect pass**

```bash
pytest tests/test_trace_store.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
cd ..
git add agent-sidecar/src/trace_store.py agent-sidecar/tests/test_trace_store.py agent-sidecar/requirements.txt
git commit -m "feat(agent): trace store for sandbox_executions"
```

### Task 3.5: Egress scraper (best-effort stub)

**Files:**
- Create: `agent-sidecar/src/egress_scraper.py`
- Create: `agent-sidecar/tests/test_egress_scraper.py`

The scraper has two implementations: `NoopEgressScraper` (always returns `[]`) and `CalicoFlowLogScraper` (queries Calico via K8s API). Phase 3 ships only Noop and a regex-based parser used by Calico. The Calico-end-to-end live integration happens in Phase 9.

- [ ] **Step 1: Write failing tests for the parser**

```python
# agent-sidecar/tests/test_egress_scraper.py
from datetime import datetime, timezone

from src.egress_scraper import (
    NoopEgressScraper,
    parse_calico_flow_log_line,
)


async def test_noop_returns_empty_list():
    scraper = NoopEgressScraper()
    result = await scraper.scrape(pod_ip="10.244.1.5", start=datetime.now(tz=timezone.utc), end=datetime.now(tz=timezone.utc))
    assert result == []


def test_parse_calico_allow():
    line = (
        '2026-04-28T15:00:00.000Z calico-felix INFO action=allow src=10.244.1.5 '
        'dst=93.184.216.34 proto=tcp dport=443'
    )
    ev = parse_calico_flow_log_line(line, sandbox_pod_ip="10.244.1.5")
    assert ev is not None
    assert ev["verdict"] == "allow"
    assert ev["dst_ip"] == "93.184.216.34"
    assert ev["dst_port"] == 443
    assert ev["protocol"] == "tcp"


def test_parse_calico_deny():
    line = (
        '2026-04-28T15:00:00.000Z calico-felix INFO action=deny src=10.244.1.5 '
        'dst=192.168.1.1 proto=tcp dport=22'
    )
    ev = parse_calico_flow_log_line(line, sandbox_pod_ip="10.244.1.5")
    assert ev["verdict"] == "deny"
    assert ev["dst_ip"] == "192.168.1.1"


def test_parse_unrelated_pod_returns_none():
    line = "2026-04-28T15:00:00.000Z calico-felix INFO action=allow src=10.244.9.9 dst=1.1.1.1 proto=udp dport=53"
    assert parse_calico_flow_log_line(line, sandbox_pod_ip="10.244.1.5") is None


def test_parse_garbage_returns_none():
    assert parse_calico_flow_log_line("not a real line", sandbox_pod_ip="10.244.1.5") is None
```

- [ ] **Step 2: Run; expect ImportError**

```bash
pytest tests/test_egress_scraper.py -v
```

- [ ] **Step 3: Implement egress_scraper.py**

```python
"""Egress event scraping. v1 is best-effort and CNI-dependent.

Two implementations:
- NoopEgressScraper: always empty list. Used when CNI logs unavailable.
- CalicoFlowLogScraper: tails Calico Felix logs via K8s API.

The line-parsing function is exported for unit testing.
"""
import re
from datetime import datetime, timezone
from typing import Any, Protocol


class EgressScraper(Protocol):
    async def scrape(self, *, pod_ip: str, start: datetime, end: datetime) -> list[dict[str, Any]]: ...


class NoopEgressScraper:
    async def scrape(self, *, pod_ip: str, start: datetime, end: datetime) -> list[dict[str, Any]]:
        return []


_CALICO_LINE_RE = re.compile(
    r"^(?P<ts>\S+)\s+calico-felix\s+\S+\s+"
    r"action=(?P<verdict>allow|deny)\s+"
    r"src=(?P<src>\S+)\s+"
    r"dst=(?P<dst>\S+)\s+"
    r"proto=(?P<proto>\S+)\s+"
    r"dport=(?P<dport>\d+)"
)


def parse_calico_flow_log_line(line: str, *, sandbox_pod_ip: str) -> dict[str, Any] | None:
    m = _CALICO_LINE_RE.match(line)
    if not m:
        return None
    if m.group("src") != sandbox_pod_ip:
        return None
    try:
        ts = datetime.fromisoformat(m.group("ts").replace("Z", "+00:00"))
    except ValueError:
        ts = datetime.now(tz=timezone.utc)
    return {
        "timestamp": ts,
        "direction": "out",
        "verdict": m.group("verdict"),
        "protocol": m.group("proto"),
        "dst_ip": m.group("dst"),
        "dst_port": int(m.group("dport")),
        "reason": None if m.group("verdict") == "allow" else "matched-deny-rule",
    }


class CalicoFlowLogScraper:
    """Stub for Phase 9. v1 only stitches lines from a pre-collected log buffer
    pulled by the orchestrator out of the K8s API. The actual log pulling lives
    in orchestrator.py to keep this module pure."""

    def __init__(self, log_lines_provider) -> None:
        self._provider = log_lines_provider

    async def scrape(self, *, pod_ip: str, start: datetime, end: datetime) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        async for line in self._provider(start, end):
            ev = parse_calico_flow_log_line(line, sandbox_pod_ip=pod_ip)
            if ev is not None:
                events.append(ev)
        return events
```

- [ ] **Step 4: Run tests; expect pass**

```bash
pytest tests/test_egress_scraper.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
cd ..
git add agent-sidecar/src/egress_scraper.py agent-sidecar/tests/test_egress_scraper.py
git commit -m "feat(agent): egress scraper noop + Calico flow log parser"
```

### Task 3.6: Sandbox orchestrator

**Files:**
- Create: `agent-sidecar/src/orchestrator.py`
- Create: `agent-sidecar/tests/test_orchestrator.py`

This is the heart of Phase 3. Tests use a `FakeK8sClient` that mimics `kubernetes.client.BatchV1Api` + `CoreV1Api` enough to simulate Job creation and pod-log retrieval.

- [ ] **Step 1: Write failing tests**

```python
# agent-sidecar/tests/test_orchestrator.py
from datetime import datetime, timedelta, timezone

import pytest

from src.concurrency import ConcurrencyGate, GateAcquireError
from src.egress_scraper import NoopEgressScraper
from src.orchestrator import (
    SandboxOrchestrator,
    OrchestratorResult,
    UserConcurrencyCap,
    GlobalConcurrencyCap,
)


class FakeK8sClient:
    """In-memory K8s simulator. Tracks created/deleted Jobs and serves canned logs."""
    def __init__(self, *, scripted_logs: str = "", scripted_exit: int = 0,
                 scripted_timeout: bool = False, scripted_oom: bool = False,
                 unschedulable: bool = False, image_pull_failure: bool = False):
        self.scripted_logs = scripted_logs
        self.scripted_exit = scripted_exit
        self.scripted_timeout = scripted_timeout
        self.scripted_oom = scripted_oom
        self.unschedulable = unschedulable
        self.image_pull_failure = image_pull_failure
        self.created_jobs: list[dict] = []
        self.deleted_jobs: list[str] = []

    async def create_job(self, spec: dict) -> str:
        if self.unschedulable:
            raise RuntimeError("unschedulable")
        self.created_jobs.append(spec)
        return f"sandbox-{len(self.created_jobs)}"

    async def wait_pod_ready(self, job_name: str, timeout_s: int) -> str:
        if self.image_pull_failure:
            raise RuntimeError("image_pull")
        return f"{job_name}-pod"

    async def stream_stdin_and_wait(self, pod_name: str, payload: bytes, deadline_s: int) -> tuple[int, str, bool, bool]:
        return self.scripted_exit, self.scripted_logs, self.scripted_timeout, self.scripted_oom

    async def get_pod_node(self, pod_name: str) -> str | None:
        return "node-1"

    async def delete_job(self, job_name: str) -> None:
        self.deleted_jobs.append(job_name)


@pytest.fixture
def gate():
    return ConcurrencyGate(per_user=2, global_=15)


@pytest.fixture
def make_orch(gate):
    def _make(k8s):
        return SandboxOrchestrator(
            k8s=k8s,
            gate=gate,
            egress=NoopEgressScraper(),
            namespace="discord-article-bot",
            sandbox_image="sandbox-base:test",
            wall_clock_seconds=300,
            cpu_limit="2",
            memory_limit="2Gi",
            stdout_storage_cap_bytes=256 * 1024,
        )
    return _make


async def test_happy_path_returns_stdout_and_exit(make_orch):
    k8s = FakeK8sClient(scripted_logs="hello world\n", scripted_exit=0)
    orch = make_orch(k8s)
    result: OrchestratorResult = await orch.run(
        user_id="u1", language="python", code="print('hello world')", stdin=None, env={},
    )
    assert result.exit_code == 0
    assert result.stdout == "hello world\n"
    assert result.stderr == ""
    assert result.timed_out is False
    assert result.oom_killed is False
    assert len(k8s.created_jobs) == 1
    assert len(k8s.deleted_jobs) == 1


async def test_stderr_partitioned_correctly(make_orch):
    k8s = FakeK8sClient(scripted_logs="hi\n__SBSTDERR__:bad\n", scripted_exit=1)
    orch = make_orch(k8s)
    result = await orch.run(user_id="u", language="bash", code="x", stdin=None, env={})
    assert result.stdout == "hi\n"
    assert result.stderr == "bad\n"
    assert result.exit_code == 1


async def test_timeout_marks_timed_out(make_orch):
    k8s = FakeK8sClient(scripted_logs="partial", scripted_exit=124, scripted_timeout=True)
    orch = make_orch(k8s)
    result = await orch.run(user_id="u", language="bash", code="sleep 1000", stdin=None, env={})
    assert result.timed_out is True
    assert result.exit_code == 124


async def test_oom_marks_oom_killed(make_orch):
    k8s = FakeK8sClient(scripted_exit=137, scripted_oom=True)
    orch = make_orch(k8s)
    result = await orch.run(user_id="u", language="python", code="a=' '*10**10", stdin=None, env={})
    assert result.oom_killed is True
    assert result.exit_code == 137


async def test_unschedulable_returns_minus_one(make_orch):
    k8s = FakeK8sClient(unschedulable=True)
    orch = make_orch(k8s)
    result = await orch.run(user_id="u", language="bash", code="x", stdin=None, env={})
    assert result.exit_code == -1
    assert result.orchestrator_error == "unschedulable"


async def test_image_pull_failure_returns_minus_one(make_orch):
    k8s = FakeK8sClient(image_pull_failure=True)
    orch = make_orch(k8s)
    result = await orch.run(user_id="u", language="bash", code="x", stdin=None, env={})
    assert result.exit_code == -1
    assert result.orchestrator_error == "image_pull"


async def test_per_user_cap_raises(make_orch, gate):
    # Pre-fill the gate manually
    async with gate.acquire(user_id="u1"):
        async with gate.acquire(user_id="u1"):
            k8s = FakeK8sClient(scripted_logs="ok", scripted_exit=0)
            orch = make_orch(k8s)
            with pytest.raises(UserConcurrencyCap):
                await orch.run(user_id="u1", language="bash", code="x", stdin=None, env={})


async def test_stdout_capped_at_storage_limit(make_orch):
    big = "a" * 300_000  # exceeds 256KB cap
    k8s = FakeK8sClient(scripted_logs=big, scripted_exit=0)
    orch = make_orch(k8s)
    result = await orch.run(user_id="u", language="bash", code="x", stdin=None, env={})
    assert len(result.stdout) <= 256 * 1024 + 64  # cap + truncation marker
    assert result.stdout_truncated is True
```

- [ ] **Step 2: Run; expect ImportError**

```bash
pytest tests/test_orchestrator.py -v
```

- [ ] **Step 3: Implement orchestrator.py**

```python
"""SandboxOrchestrator — drives Job lifecycle for one execution."""
import asyncio
import json
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol

from .concurrency import ConcurrencyGate, GateAcquireError
from .egress_scraper import EgressScraper
from .job_template import build_job_spec
from .log_partition import partition_logs


class K8sClient(Protocol):
    async def create_job(self, spec: dict) -> str: ...
    async def wait_pod_ready(self, job_name: str, timeout_s: int) -> str: ...
    async def stream_stdin_and_wait(self, pod_name: str, payload: bytes, deadline_s: int) -> tuple[int, str, bool, bool]: ...
    async def get_pod_node(self, pod_name: str) -> str | None: ...
    async def delete_job(self, job_name: str) -> None: ...


@dataclass
class OrchestratorResult:
    execution_id: str
    exit_code: int
    stdout: str
    stderr: str
    stdout_truncated: bool
    stderr_truncated: bool
    duration_ms: int
    schedule_wait_ms: int
    timed_out: bool
    oom_killed: bool
    orchestrator_error: str | None
    egress_events: list[dict[str, Any]]
    pod_name: str
    node_name: str | None


class UserConcurrencyCap(Exception):
    pass


class GlobalConcurrencyCap(Exception):
    pass


_TRUNC_MARKER = "\n...[truncated by sandbox storage cap]..."


def _truncate(s: str, cap: int) -> tuple[str, bool]:
    if len(s) <= cap:
        return s, False
    return s[:cap] + _TRUNC_MARKER, True


class SandboxOrchestrator:
    def __init__(
        self,
        *,
        k8s: K8sClient,
        gate: ConcurrencyGate,
        egress: EgressScraper,
        namespace: str,
        sandbox_image: str,
        wall_clock_seconds: int,
        cpu_limit: str,
        memory_limit: str,
        stdout_storage_cap_bytes: int = 256 * 1024,
    ) -> None:
        self._k8s = k8s
        self._gate = gate
        self._egress = egress
        self._namespace = namespace
        self._image = sandbox_image
        self._wall_clock = wall_clock_seconds
        self._cpu = cpu_limit
        self._memory = memory_limit
        self._cap = stdout_storage_cap_bytes

    async def run(
        self,
        *,
        user_id: str,
        language: str,
        code: str,
        stdin: str | None,
        env: dict[str, str],
    ) -> OrchestratorResult:
        execution_id = uuid.uuid4().hex
        try:
            async with self._gate.acquire(user_id=user_id, wait=False):
                return await self._do_run(execution_id, user_id, language, code, stdin, env)
        except GateAcquireError as e:
            if e.scope == "user":
                raise UserConcurrencyCap from e
            raise GlobalConcurrencyCap from e

    async def _do_run(
        self,
        execution_id: str,
        user_id: str,
        language: str,
        code: str,
        stdin: str | None,
        env: dict[str, str],
    ) -> OrchestratorResult:
        spec = build_job_spec(
            execution_id=execution_id,
            user_id=user_id,
            image=self._image,
            wall_clock_seconds=self._wall_clock,
            cpu_limit=self._cpu,
            memory_limit=self._memory,
            env=env,
            namespace=self._namespace,
        )

        t_start = time.monotonic()
        scrape_start = datetime.now(tz=timezone.utc)
        try:
            job_name = await self._k8s.create_job(spec)
        except Exception as e:
            return OrchestratorResult(
                execution_id=execution_id, exit_code=-1, stdout="", stderr="",
                stdout_truncated=False, stderr_truncated=False, duration_ms=0,
                schedule_wait_ms=0, timed_out=False, oom_killed=False,
                orchestrator_error="unschedulable" if "unschedulable" in str(e) else str(e),
                egress_events=[], pod_name="", node_name=None,
            )

        try:
            t_ready_start = time.monotonic()
            try:
                pod_name = await self._k8s.wait_pod_ready(job_name, timeout_s=30)
            except Exception as e:
                return OrchestratorResult(
                    execution_id=execution_id, exit_code=-1, stdout="", stderr="",
                    stdout_truncated=False, stderr_truncated=False, duration_ms=0,
                    schedule_wait_ms=int((time.monotonic() - t_ready_start) * 1000),
                    timed_out=False, oom_killed=False,
                    orchestrator_error="image_pull" if "image_pull" in str(e) else str(e),
                    egress_events=[], pod_name="", node_name=None,
                )
            schedule_wait_ms = int((time.monotonic() - t_ready_start) * 1000)

            payload = json.dumps({"language": language, "code": code, "stdin": stdin}).encode()
            exit_code, raw_logs, timed_out, oom_killed = await self._k8s.stream_stdin_and_wait(
                pod_name, payload, deadline_s=self._wall_clock,
            )
            stdout, stderr = partition_logs(raw_logs)
            stdout, stdout_trunc = _truncate(stdout, self._cap)
            stderr, stderr_trunc = _truncate(stderr, self._cap)

            node_name = await self._k8s.get_pod_node(pod_name)
            scrape_end = datetime.now(tz=timezone.utc)
            egress_events = await self._egress.scrape(
                pod_ip=pod_name, start=scrape_start, end=scrape_end,
            )

            return OrchestratorResult(
                execution_id=execution_id,
                exit_code=exit_code,
                stdout=stdout, stderr=stderr,
                stdout_truncated=stdout_trunc, stderr_truncated=stderr_trunc,
                duration_ms=int((time.monotonic() - t_start) * 1000),
                schedule_wait_ms=schedule_wait_ms,
                timed_out=timed_out, oom_killed=oom_killed,
                orchestrator_error=None,
                egress_events=egress_events,
                pod_name=pod_name, node_name=node_name,
            )
        finally:
            try:
                await self._k8s.delete_job(job_name)
            except Exception:
                pass  # cleanup best-effort
```

- [ ] **Step 4: Run tests; expect pass**

```bash
pytest tests/test_orchestrator.py -v
```

Expected: 8 passed.

- [ ] **Step 5: Run all sidecar tests**

```bash
make test
```

Expected: all phase-3 tests green.

- [ ] **Step 6: Commit**

```bash
cd ..
git add agent-sidecar/src/orchestrator.py agent-sidecar/tests/test_orchestrator.py
git commit -m "feat(agent): SandboxOrchestrator with full lifecycle handling"
```

---

## Phase 4 — ADK Agent + Tool

Wires the orchestrator into an ADK agent. The agent gets a single tool that adapts the orchestrator into ADK's tool-call interface.

### Task 4.1: `run_in_sandbox` tool

**Files:**
- Create: `agent-sidecar/src/tools.py`
- Create: `agent-sidecar/tests/test_tools.py`

- [ ] **Step 1: Write failing tests**

```python
# agent-sidecar/tests/test_tools.py
import pytest

from src.tools import RunInSandboxTool, ToolBudgetExceeded


class FakeOrch:
    def __init__(self):
        self.calls = []

    async def run(self, *, user_id, language, code, stdin, env):
        self.calls.append((user_id, language, code, stdin, env))
        from src.orchestrator import OrchestratorResult
        return OrchestratorResult(
            execution_id=f"exec-{len(self.calls)}",
            exit_code=0, stdout="ok", stderr="", stdout_truncated=False,
            stderr_truncated=False, duration_ms=10, schedule_wait_ms=5,
            timed_out=False, oom_killed=False, orchestrator_error=None,
            egress_events=[], pod_name="p", node_name=None,
        )


async def test_tool_calls_orchestrator():
    orch = FakeOrch()
    tool = RunInSandboxTool(orch=orch, user_id="u1", call_budget=8)
    result = await tool.run(language="python", code="print(1)", stdin=None, env=None)
    assert result["exit_code"] == 0
    assert result["stdout"] == "ok"
    assert orch.calls == [("u1", "python", "print(1)", None, {})]


async def test_tool_enforces_call_budget():
    orch = FakeOrch()
    tool = RunInSandboxTool(orch=orch, user_id="u1", call_budget=2)
    await tool.run(language="bash", code="echo 1", stdin=None, env=None)
    await tool.run(language="bash", code="echo 2", stdin=None, env=None)
    with pytest.raises(ToolBudgetExceeded):
        await tool.run(language="bash", code="echo 3", stdin=None, env=None)


async def test_tool_records_execution_ids():
    orch = FakeOrch()
    tool = RunInSandboxTool(orch=orch, user_id="u1", call_budget=8)
    await tool.run(language="bash", code="x", stdin=None, env=None)
    await tool.run(language="bash", code="y", stdin=None, env=None)
    assert tool.execution_ids == ["exec-1", "exec-2"]


async def test_user_concurrency_cap_returns_minus_two():
    from src.orchestrator import UserConcurrencyCap
    class CappedOrch(FakeOrch):
        async def run(self, **kw):
            raise UserConcurrencyCap()
    tool = RunInSandboxTool(orch=CappedOrch(), user_id="u1", call_budget=8)
    result = await tool.run(language="bash", code="x", stdin=None, env=None)
    assert result["exit_code"] == -2
    assert result["error"] == "user_concurrency_cap"
```

- [ ] **Step 2: Run; expect ImportError**

```bash
cd agent-sidecar && . .venv/bin/activate && pytest tests/test_tools.py -v
```

- [ ] **Step 3: Implement tools.py**

```python
"""ADK tool wrapper around SandboxOrchestrator."""
from dataclasses import asdict
from typing import Any

from .orchestrator import (
    SandboxOrchestrator,
    UserConcurrencyCap,
    GlobalConcurrencyCap,
)


class ToolBudgetExceeded(Exception):
    pass


class RunInSandboxTool:
    """Stateful per-turn tool. One instance per agent turn so call_budget
    is scoped to a single user message."""

    def __init__(self, *, orch: SandboxOrchestrator, user_id: str, call_budget: int) -> None:
        self._orch = orch
        self._user_id = user_id
        self._budget = call_budget
        self._used = 0
        self.execution_ids: list[str] = []
        self.results: list[Any] = []

    async def run(
        self,
        *,
        language: str,
        code: str,
        stdin: str | None = None,
        env: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        if self._used >= self._budget:
            raise ToolBudgetExceeded()
        self._used += 1
        try:
            result = await self._orch.run(
                user_id=self._user_id,
                language=language,
                code=code,
                stdin=stdin,
                env=env or {},
            )
        except UserConcurrencyCap:
            return {"exit_code": -2, "error": "user_concurrency_cap", "execution_id": None}
        except GlobalConcurrencyCap:
            return {"exit_code": -2, "error": "global_concurrency_cap", "execution_id": None}
        self.execution_ids.append(result.execution_id)
        self.results.append(result)
        return asdict(result)
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_tools.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cd ..
git add agent-sidecar/src/tools.py agent-sidecar/tests/test_tools.py
git commit -m "feat(agent): run_in_sandbox tool with per-turn call budget"
```

### Task 4.2: ADK agent assembly + Chat handler wiring

**Files:**
- Create: `agent-sidecar/src/agent.py`
- Modify: `agent-sidecar/src/server.py`

`google-adk` is opinionated about how Agents are constructed. The exact API may shift between versions. This task uses the documented `Agent(name, instruction, tools=[...])` shape from ADK ≥ 0.5; if the installed version differs, adapt the `agent.py` while keeping the public `process_chat()` shape the server calls.

- [ ] **Step 1: Implement agent.py**

```python
"""ADK Agent assembly. One Agent per ChatRequest (so per-turn tool state is fresh)."""
import logging
from dataclasses import dataclass

from google.adk.agents import Agent
from google.adk.runners import InMemoryRunner

from .config import Config
from .orchestrator import SandboxOrchestrator
from .tools import RunInSandboxTool, ToolBudgetExceeded

log = logging.getLogger(__name__)

TOOL_AVAILABILITY_PREAMBLE = """
You have access to a sandboxed Linux environment via the run_in_sandbox tool.
The sandbox runs in gVisor with 2 vCPU, 2Gi RAM, 256Mi tmpfs, 300s wall clock.
It has internet access (RFC1918 blocked) and ships with python, node, dotnet,
go, rust, ollama, common build/network tools. You cannot persist state between
calls — each invocation is a fresh pod. You receive {exit_code, stdout, stderr,
duration_ms, egress_events, gvisor_events} back.

Use the sandbox WHEN:
  - The user asked you to run, build, compile, scan, fetch, or test something.
  - You need to verify a fact you'd otherwise hallucinate.
  - The user explicitly asked you to do a task that's mechanically executable.
Do NOT use the sandbox WHEN:
  - The user is having a casual conversation.
  - The task is purely social/creative writing/discussion.
  - You can answer accurately from your own knowledge or recent channel context.

You do not have to ask permission to use the sandbox; the user has pre-consented.
Surface what you actually did in your final reply (one short sentence).
Do NOT prefix your reply with a personality header. Do NOT include code blocks
unless they're trivially short and serve the explanation; long code is auto-attached
via reaction reveal.
""".strip()


@dataclass
class AgentChatResult:
    message_text: str
    execution_ids: list[str]
    any_failed: bool


class ChannelVoiceAgent:
    """Wraps the ADK Agent so the gRPC server can call it without
    knowing ADK internals."""

    def __init__(self, *, config: Config, orchestrator: SandboxOrchestrator, base_system_prompt: str) -> None:
        self._config = config
        self._orch = orchestrator
        self._base_system_prompt = base_system_prompt

    async def process_chat(self, *, user_id: str, user_message: str) -> AgentChatResult:
        tool = RunInSandboxTool(
            orch=self._orch,
            user_id=user_id,
            call_budget=self._config.sandbox_agent_turn_call_budget,
        )

        async def _run_in_sandbox(language: str, code: str, stdin: str | None = None,
                                   env: dict[str, str] | None = None) -> dict:
            """Execute code in the gVisor sandbox.

            Args:
              language: 'bash'|'python'|'node'|'csharp'|'go'|'rust'|'raw'
              code: full source or shell command
              stdin: optional piped stdin
              env: extra env vars (use ONLY for user-supplied keys; never invent)
            """
            try:
                return await tool.run(language=language, code=code, stdin=stdin, env=env)
            except ToolBudgetExceeded:
                return {"exit_code": -3, "error": "turn_call_budget_exceeded"}

        agent = Agent(
            name="channel-voice",
            instruction=f"{self._base_system_prompt}\n\n{TOOL_AVAILABILITY_PREAMBLE}",
            tools=[_run_in_sandbox],
            model=self._config.openai_model,
        )
        runner = InMemoryRunner(agent=agent, app_name="discord-article-bot")
        events = []
        async for event in runner.run_async(user_id=user_id, session_id=user_id, new_message=user_message):
            events.append(event)
        # ADK's run_async yields events; the final text response is in the last event with content.
        message_text = ""
        for ev in reversed(events):
            if getattr(ev, "content", None) and getattr(ev.content, "parts", None):
                for part in ev.content.parts:
                    if getattr(part, "text", None):
                        message_text = part.text
                        break
                if message_text:
                    break

        any_failed = any(r.exit_code != 0 for r in tool.results)
        return AgentChatResult(
            message_text=message_text,
            execution_ids=tool.execution_ids,
            any_failed=any_failed,
        )
```

- [ ] **Step 2: Modify server.py to host the agent**

Replace the `AgentServicer` class in `agent-sidecar/src/server.py` with:

```python
class AgentServicer(agent_pb2_grpc.AgentServicer):
    def __init__(self, channel_voice_agent) -> None:
        self._agent = channel_voice_agent

    def Health(self, request, context):  # noqa: N802
        return agent_pb2.HealthResponse(healthy=True)

    async def Chat(self, request, context):  # noqa: N802
        try:
            result = await self._agent.process_chat(
                user_id=request.user_id,
                user_message=request.user_message,
            )
        except Exception as e:
            log.exception("Chat handler failed")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return agent_pb2.ChatResponse()

        summary = agent_pb2.ExecutionSummary(
            execution_count=len(result.execution_ids),
            any_failed=result.any_failed,
            execution_ids=result.execution_ids,
        )
        return agent_pb2.ChatResponse(
            message_text=result.message_text,
            summary=summary,
            fallback_occurred=False,
        )
```

Update `serve()` to wire dependencies:

```python
def serve() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    config = load_config()
    setup_tracing(config)

    # K8s, orchestrator, agent assembly happens here. Imported lazily so unit tests
    # that import server.py don't pull google-adk.
    from kubernetes import config as kube_config, client as kube_client
    from pymongo import MongoClient
    from .concurrency import ConcurrencyGate
    from .egress_scraper import NoopEgressScraper
    from .k8s_client import LiveK8sClient  # added in Task 4.3
    from .orchestrator import SandboxOrchestrator
    from .agent import ChannelVoiceAgent

    kube_config.load_incluster_config()
    k8s_batch = kube_client.BatchV1Api()
    k8s_core = kube_client.CoreV1Api()
    mongo = MongoClient(config.mongo_uri)
    db = mongo.get_default_database()

    gate = ConcurrencyGate(
        per_user=config.sandbox_per_user_concurrency,
        global_=config.sandbox_global_concurrency,
    )
    k8s = LiveK8sClient(batch=k8s_batch, core=k8s_core, namespace=config.k8s_namespace)
    orch = SandboxOrchestrator(
        k8s=k8s, gate=gate, egress=NoopEgressScraper(),
        namespace=config.k8s_namespace, sandbox_image=config.sandbox_base_image,
        wall_clock_seconds=config.sandbox_wall_clock_seconds,
        cpu_limit=config.sandbox_cpu_limit, memory_limit=config.sandbox_memory_limit,
    )

    base_prompt = open("/app/prompt/base.txt", "r").read() if __import__("os").path.exists("/app/prompt/base.txt") else "You are a helpful assistant."
    agent = ChannelVoiceAgent(config=config, orchestrator=orch, base_system_prompt=base_prompt)

    server = grpc.aio.server()
    agent_pb2_grpc.add_AgentServicer_to_server(AgentServicer(agent), server)
    server.add_insecure_port(config.grpc_listen_addr)

    import asyncio
    async def _run():
        await server.start()
        log.info(f"agent sidecar listening on {config.grpc_listen_addr}")
        await server.wait_for_termination()

    asyncio.run(_run())
```

- [ ] **Step 3: Verify tests still pass**

```bash
cd agent-sidecar && . .venv/bin/activate && make test
```

Expected: all green. (`server.py`'s Chat is now async — adjust `test_server_health.py` to use `grpc.aio` if it complains. If the test fixture spins up a sync server but Chat is async, K8s/MongoDB imports happen lazily in `serve()` not in `AgentServicer.__init__`, so the test fixture only constructs `AgentServicer(channel_voice_agent=None)` — pass a `MagicMock()` and the existing UNIMPLEMENTED expectation needs updating.)

If the test fails because `Chat` no longer returns UNIMPLEMENTED: update `test_server_health.py:test_chat_unimplemented_for_now` to instead assert that calling Chat with a `MagicMock` agent that raises returns INTERNAL. Or remove that test — the agent-down case is covered by Phase 5 fallback tests.

- [ ] **Step 4: Commit**

```bash
cd ..
git add agent-sidecar/src/agent.py agent-sidecar/src/server.py agent-sidecar/tests/test_server_health.py
git commit -m "feat(agent): ADK Agent assembly + Chat handler"
```

### Task 4.3: Live K8s client adapter

**Files:**
- Create: `agent-sidecar/src/k8s_client.py`

This adapter implements the `K8sClient` Protocol from `orchestrator.py` against the real `kubernetes` Python library. **No unit tests** — this code is only correct when run against a real cluster, which is Phase 9.

- [ ] **Step 1: Implement k8s_client.py**

```python
"""Real-cluster adapter implementing the orchestrator's K8sClient Protocol."""
import asyncio
import time
from typing import Any

from kubernetes import client as kube_client, watch
from kubernetes.client.rest import ApiException
from kubernetes.stream import stream


class LiveK8sClient:
    def __init__(self, *, batch, core, namespace: str) -> None:
        self._batch = batch
        self._core = core
        self._ns = namespace

    async def create_job(self, spec: dict) -> str:
        try:
            created = await asyncio.to_thread(
                self._batch.create_namespaced_job, self._ns, spec,
            )
            return created.metadata.name
        except ApiException as e:
            if e.status in (403, 422):
                raise RuntimeError("unschedulable") from e
            raise

    async def wait_pod_ready(self, job_name: str, timeout_s: int) -> str:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            pods = await asyncio.to_thread(
                self._core.list_namespaced_pod,
                self._ns, label_selector=f"job-name={job_name}",
            )
            if pods.items:
                pod = pods.items[0]
                # ImagePullBackOff / ErrImagePull → fail fast
                for cs in (pod.status.container_statuses or []):
                    if cs.state.waiting and cs.state.waiting.reason in ("ImagePullBackOff", "ErrImagePull"):
                        raise RuntimeError("image_pull")
                if pod.status.phase == "Running":
                    return pod.metadata.name
            await asyncio.sleep(0.5)
        raise RuntimeError("ready_timeout")

    async def stream_stdin_and_wait(self, pod_name: str, payload: bytes, deadline_s: int) -> tuple[int, str, bool, bool]:
        # Open exec channel with stdin enabled; write payload; wait for the job to complete.
        # Then read pod logs (combined stdout/stderr), and inspect pod status for OOM/timeout.
        def _do() -> tuple[int, str, bool, bool]:
            ws = stream(
                self._core.connect_get_namespaced_pod_attach,
                pod_name, self._ns,
                stdin=True, stdout=False, stderr=False, tty=False,
                _preload_content=False,
            )
            try:
                ws.write_stdin(payload.decode("utf-8"))
                ws.close()
            finally:
                ws.update(timeout=1)
            # Wait for completion.
            t0 = time.monotonic()
            while time.monotonic() - t0 < deadline_s + 5:
                pod = self._core.read_namespaced_pod(pod_name, self._ns)
                if pod.status.phase in ("Succeeded", "Failed"):
                    break
                time.sleep(0.5)
            else:
                pod = self._core.read_namespaced_pod(pod_name, self._ns)

            timed_out = False
            oom_killed = False
            exit_code = 0
            for cs in (pod.status.container_statuses or []):
                if cs.state.terminated:
                    exit_code = cs.state.terminated.exit_code or 0
                    if cs.state.terminated.reason == "OOMKilled":
                        oom_killed = True
                    if cs.state.terminated.reason == "DeadlineExceeded":
                        timed_out = True
            if pod.status.reason == "DeadlineExceeded":
                timed_out = True

            logs = self._core.read_namespaced_pod_log(pod_name, self._ns)
            return exit_code, logs, timed_out, oom_killed

        return await asyncio.to_thread(_do)

    async def get_pod_node(self, pod_name: str) -> str | None:
        try:
            pod = await asyncio.to_thread(self._core.read_namespaced_pod, pod_name, self._ns)
            return pod.spec.node_name
        except ApiException:
            return None

    async def delete_job(self, job_name: str) -> None:
        try:
            await asyncio.to_thread(
                self._batch.delete_namespaced_job, job_name, self._ns,
                propagation_policy="Foreground",
            )
        except ApiException:
            pass
```

- [ ] **Step 2: Commit**

```bash
git add agent-sidecar/src/k8s_client.py
git commit -m "feat(agent): live K8s client adapter (untested locally; verified Phase 9)"
```

### Task 4.4: Phase 4 sanity check

- [ ] **Step 1: Run all sidecar tests**

```bash
cd agent-sidecar && . .venv/bin/activate && make test
cd ..
```

Expected: all green.

- [ ] **Step 2: Rebuild sidecar image**

```bash
docker build -t agent-sidecar-test:dev agent-sidecar/
```

Expected: clean build with the new agent + tools modules.

---

## Phase 5 — Node Bot Integration

Adds `AgentClient` and routes channel-voice through it. Bot still works if sidecar is down (graceful fallback).

### Task 5.1: Generate Node gRPC client

**Files:**
- Modify: `package.json` (add `@grpc/grpc-js` and `@grpc/proto-loader`)

- [ ] **Step 1: Install deps**

```bash
npm install --save @grpc/grpc-js @grpc/proto-loader
```

- [ ] **Step 2: Verify proto/agent.proto already exists**

```bash
ls proto/agent.proto
```

Expected: file present (created in Phase 2).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add grpc client deps for agent sidecar"
```

### Task 5.2: AgentClient with fallback-on-down detection

**Files:**
- Create: `services/AgentClient.js`
- Create: `__tests__/services/AgentClient.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// __tests__/services/AgentClient.test.js
const path = require('path');

jest.mock('@grpc/grpc-js', () => {
  const actual = jest.requireActual('@grpc/grpc-js');
  return { ...actual };
});

const AgentClient = require('../../services/AgentClient');

describe('AgentClient', () => {
  let client;

  beforeEach(() => {
    client = new AgentClient({
      address: '127.0.0.1:65535', // unreachable
      protoPath: path.join(__dirname, '..', '..', 'proto', 'agent.proto'),
      healthIntervalMs: 50,
      unhealthyThresholdMs: 100,
    });
  });

  afterEach(() => {
    if (client) client.close();
  });

  it('reports unhealthy when sidecar unreachable', async () => {
    // Wait beyond unhealthyThresholdMs
    await new Promise(r => setTimeout(r, 250));
    expect(client.isHealthy()).toBe(false);
  });

  it('chat() rejects when unhealthy', async () => {
    await new Promise(r => setTimeout(r, 250));
    await expect(client.chat({
      userId: 'u', userTag: 'u#0', channelId: 'c', guildId: 'g',
      interactionId: 'i', userMessage: 'hi', imageUrl: '',
    })).rejects.toThrow(/sidecar unhealthy/);
  });
});
```

- [ ] **Step 2: Run; expect import failure**

```bash
npm test -- --testPathPatterns="AgentClient"
```

- [ ] **Step 3: Implement AgentClient**

```javascript
// services/AgentClient.js
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const logger = require('../logger');

class AgentClient {
  constructor({ address, protoPath, healthIntervalMs = 5000, unhealthyThresholdMs = 30000 }) {
    this.address = address;
    this.unhealthyThresholdMs = unhealthyThresholdMs;
    this._lastHealthyAt = 0;
    this._closed = false;

    const packageDef = protoLoader.loadSync(protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = grpc.loadPackageDefinition(packageDef).discordbot.agent;
    this._stub = new proto.Agent(address, grpc.credentials.createInsecure());

    this._healthTimer = setInterval(() => this._healthCheck(), healthIntervalMs);
    this._healthCheck();
  }

  _healthCheck() {
    if (this._closed) return;
    this._stub.Health({}, { deadline: new Date(Date.now() + 2000) }, (err, resp) => {
      if (!err && resp?.healthy) {
        this._lastHealthyAt = Date.now();
      }
    });
  }

  isHealthy() {
    return Date.now() - this._lastHealthyAt < this.unhealthyThresholdMs;
  }

  chat(req) {
    return new Promise((resolve, reject) => {
      if (!this.isHealthy()) {
        reject(new Error('sidecar unhealthy'));
        return;
      }
      this._stub.Chat({
        user_id: req.userId,
        user_tag: req.userTag,
        channel_id: req.channelId,
        guild_id: req.guildId,
        interaction_id: req.interactionId,
        user_message: req.userMessage,
        image_url: req.imageUrl || '',
      }, { deadline: new Date(Date.now() + 600000) }, (err, resp) => {
        if (err) return reject(err);
        resolve({
          messageText: resp.message_text,
          summary: {
            executionCount: resp.summary?.execution_count || 0,
            anyFailed: resp.summary?.any_failed || false,
            executionIds: resp.summary?.execution_ids || [],
          },
          fallbackOccurred: resp.fallback_occurred || false,
        });
      });
    });
  }

  close() {
    this._closed = true;
    clearInterval(this._healthTimer);
    if (this._stub && this._stub.close) this._stub.close();
  }
}

module.exports = AgentClient;
```

- [ ] **Step 4: Run tests; expect pass**

```bash
npm test -- --testPathPatterns="AgentClient"
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add services/AgentClient.js __tests__/services/AgentClient.test.js
git commit -m "feat: AgentClient gRPC client with health-based fallback"
```

### Task 5.3: ChatService routing for channel-voice

**Files:**
- Modify: `services/ChatService.js:376` (the `chat` method)
- Modify: `__tests__/services/ChatService.test.js`

The change: when `personalityId === 'channel-voice'` and `agentClient` is provided AND healthy, route through agent. Otherwise (other personalities, agent unhealthy, agent disabled) use existing direct-OpenAI path.

- [ ] **Step 1: Read current ChatService constructor**

```bash
grep -n "constructor\|chat(" services/ChatService.js | head -10
```

Note the existing constructor signature so the agentClient parameter slots in cleanly. Add `agentClient = null` as the LAST positional/optional parameter.

- [ ] **Step 2: Add a failing test that proves channel-voice routes to the agent when healthy**

Append to `__tests__/services/ChatService.test.js`:

```javascript
describe('ChatService agent routing', () => {
  let chatService;
  let mockAgentClient;
  let mockOpenAI;

  beforeEach(() => {
    mockAgentClient = {
      isHealthy: jest.fn().mockReturnValue(true),
      chat: jest.fn().mockResolvedValue({
        messageText: 'agent says hi',
        summary: { executionCount: 0, anyFailed: false, executionIds: [] },
        fallbackOccurred: false,
      }),
    };
    mockOpenAI = {
      responses: {
        create: jest.fn().mockResolvedValue({ output_text: 'cloud says hi', usage: { input_tokens: 0, output_tokens: 0 } }),
      },
    };
    chatService = new ChatService(/* fill in deps from existing tests */);
    chatService.agentClient = mockAgentClient;
  });

  it('routes channel-voice through agent when healthy', async () => {
    const result = await chatService.chat('channel-voice', 'hi', { id: 'u', tag: 'u#0' }, 'c', 'g');
    expect(mockAgentClient.chat).toHaveBeenCalled();
    expect(result.message).toBe('agent says hi');
  });

  it('falls back to direct-OpenAI when agent unhealthy', async () => {
    mockAgentClient.isHealthy.mockReturnValue(false);
    const result = await chatService.chat('channel-voice', 'hi', { id: 'u', tag: 'u#0' }, 'c', 'g');
    expect(mockAgentClient.chat).not.toHaveBeenCalled();
    expect(result.success).toBeDefined();
  });
});
```

(The test stub above uses placeholder constructor args because `ChatService` has many deps — fill from the patterns at the top of the existing test file.)

- [ ] **Step 3: Run; expect failure**

- [ ] **Step 4: Modify ChatService.chat to route**

In `services/ChatService.js`, near line 376 in `chat()`, add at the very top of the method body (after the existing fallback-personality recursion guard):

```javascript
    // Route channel-voice through the agent sidecar when available and healthy.
    if (personalityId === 'channel-voice'
        && this.agentClient
        && this.agentClient.isHealthy()
        && process.env.AGENT_ENABLED !== 'false') {
      try {
        const agentResp = await this.agentClient.chat({
          userId: user.id,
          userTag: user.tag || user.username,
          channelId,
          guildId,
          interactionId: user.interactionId || '',
          userMessage,
          imageUrl: imageUrl || '',
        });
        return {
          success: true,
          message: agentResp.messageText,
          personality: { id: 'channel-voice', name: 'Channel Voice', emoji: '🗣️' },
          tokens: { input: 0, output: 0, total: 0 },  // counted in agent-side tracing
          executionSummary: agentResp.summary,
        };
      } catch (err) {
        logger.warn(`Agent call failed; falling through to direct-OpenAI: ${err.message}`);
        // fall through
      }
    }
```

Add `agentClient = null` as a constructor field so existing call sites that don't pass one keep working. Add to the constructor:

```javascript
    this.agentClient = arguments[N] || null; // where N is the new last position
```

(Or refactor the constructor to accept an options object — preferred long-term, but out of scope for this task.)

- [ ] **Step 5: Run tests; expect pass**

```bash
npm test -- --testPathPatterns="ChatService"
```

- [ ] **Step 6: Commit**

```bash
git add services/ChatService.js __tests__/services/ChatService.test.js
git commit -m "feat: route channel-voice through agent sidecar when healthy"
```

### Task 5.4: Wire AgentClient into bot.js

**Files:**
- Modify: `bot.js:21-25` and constructor
- Modify: `config/config.js`

- [ ] **Step 1: Add config**

In `config/config.js`, inside the `module.exports` object, add a top-level `agent` section:

```javascript
  agent: {
    enabled: process.env.AGENT_ENABLED !== 'false',  // default true
    address: process.env.AGENT_GRPC_ADDR || 'discord-article-bot-agent.discord-article-bot.svc.cluster.local:50051',
  },
```

- [ ] **Step 2: Wire AgentClient in bot.js**

Near the top of `bot.js`:

```javascript
const AgentClient = require('./services/AgentClient');
```

In the bot constructor, before `this.chatService = new ChatService(...)`:

```javascript
    this.agentClient = config.agent.enabled
      ? new AgentClient({
          address: config.agent.address,
          protoPath: require('path').join(__dirname, 'proto', 'agent.proto'),
        })
      : null;
```

Then pass `this.agentClient` as the new last constructor argument to `new ChatService(...)`.

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add bot.js config/config.js
git commit -m "feat: wire AgentClient into bot startup"
```

---

## Phase 6 — Reaction Reveal

### Task 6.1: SandboxTraceService (Mongo reader)

**Files:**
- Create: `services/SandboxTraceService.js`
- Create: `__tests__/services/SandboxTraceService.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// __tests__/services/SandboxTraceService.test.js
const SandboxTraceService = require('../../services/SandboxTraceService');

describe('SandboxTraceService', () => {
  let service;
  let fakeColl;

  beforeEach(() => {
    fakeColl = {
      findOne: jest.fn().mockImplementation(({ execution_id }) => {
        if (execution_id === 'exec-1') {
          return Promise.resolve({
            execution_id: 'exec-1',
            language: 'python',
            code: 'print(1)',
            stdout: '1\n',
            stderr: '',
            exit_code: 0,
          });
        }
        return Promise.resolve(null);
      }),
    };
    service = new SandboxTraceService({ collection: fakeColl });
  });

  it('returns trace by execution_id', async () => {
    const result = await service.getByExecutionId('exec-1');
    expect(result.code).toBe('print(1)');
  });

  it('returns null when not found', async () => {
    expect(await service.getByExecutionId('missing')).toBeNull();
  });

  it('builds code attachment buffer with correct extension', () => {
    const trace = { language: 'python', code: 'print(42)' };
    const att = service.buildCodeAttachment(trace);
    expect(att.filename).toMatch(/\.py$/);
    expect(att.buffer.toString()).toBe('print(42)');
  });

  it('uses .sh for bash and .cs for csharp', () => {
    expect(service.buildCodeAttachment({ language: 'bash', code: 'x' }).filename).toMatch(/\.sh$/);
    expect(service.buildCodeAttachment({ language: 'csharp', code: 'x' }).filename).toMatch(/\.cs$/);
  });
});
```

- [ ] **Step 2: Run; expect ImportError**

```bash
npm test -- --testPathPatterns="SandboxTraceService"
```

- [ ] **Step 3: Implement service**

```javascript
// services/SandboxTraceService.js
const EXT = {
  bash: 'sh', python: 'py', node: 'js', go: 'go', rust: 'rs', csharp: 'cs', raw: 'sh',
};

class SandboxTraceService {
  constructor({ collection }) {
    this._coll = collection;
  }

  async getByExecutionId(executionId) {
    return await this._coll.findOne({ execution_id: executionId });
  }

  buildCodeAttachment(trace) {
    const ext = EXT[trace.language] || 'txt';
    return {
      filename: `code-${trace.execution_id || 'unknown'}.${ext}`,
      buffer: Buffer.from(trace.code || '', 'utf-8'),
    };
  }

  buildStdoutAttachment(trace) {
    return {
      filename: `stdout-${trace.execution_id || 'unknown'}.txt`,
      buffer: Buffer.from(trace.stdout || '', 'utf-8'),
    };
  }

  buildStderrAttachment(trace) {
    return {
      filename: `stderr-${trace.execution_id || 'unknown'}.txt`,
      buffer: Buffer.from(trace.stderr || '', 'utf-8'),
    };
  }
}

module.exports = SandboxTraceService;
```

- [ ] **Step 4: Run tests; expect pass**

```bash
npm test -- --testPathPatterns="SandboxTraceService"
```

- [ ] **Step 5: Commit**

```bash
git add services/SandboxTraceService.js __tests__/services/SandboxTraceService.test.js
git commit -m "feat: SandboxTraceService for reaction-reveal payload assembly"
```

### Task 6.2: Wire reaction reveal into ReactionHandler

**Files:**
- Modify: `handlers/ReactionHandler.js`
- Create: `__tests__/handlers/ReactionHandler.test.js` (new file)
- Modify: `bot.js` (pass new dep to ReactionHandler; add reveal-reaction emit on agent-completed messages)

The bot needs to remember which `execution_ids` map to which message id so reactions can look them up. Two options: (a) store mapping in Mongo as part of the existing message-record path, (b) hold an in-memory LRU. Picking (a) — extend the existing channel-message-record schema with optional `executionIds` field.

- [ ] **Step 1: Add executionIds to MongoService.recordChannelMessage**

In `services/MongoService.js`, find `recordChannelMessage` and accept `executionIds` in the input:

```javascript
async recordChannelMessage({ messageId, channelId, guildId, authorId, authorName, content, timestamp, executionIds = null }) {
  const doc = { messageId, channelId, guildId, authorId, authorName, content, timestamp };
  if (executionIds && executionIds.length > 0) {
    doc.executionIds = executionIds;
  }
  return this._db.collection('channel_messages').insertOne(doc);
}

async getMessageExecutionIds(messageId) {
  const doc = await this._db.collection('channel_messages').findOne({ messageId });
  return doc?.executionIds || [];
}
```

- [ ] **Step 2: After bot sends an agent reply, record executionIds**

In `bot.js`, in `_handleMentionChat` after `await message.reply({...})` for the agent path, capture the bot's reply message id and record it. Find the `_handleMentionChat` block in `bot.js:611` and adjust the success path. After the chat call returns, capture the `executionSummary` from `result` and pass `executionIds: result.executionSummary?.executionIds` to `mongoService.recordChannelMessage` for the bot's own reply message.

(The existing `recordChannelMessage` is called for user messages only. We extend it to also record the bot's reply when it has executionIds, so reactions on it can look them up.)

```javascript
// after const reply = await message.reply({ content: response, allowedMentions: { repliedUser: false } });
if (result.executionSummary?.executionIds?.length > 0 && reply?.id) {
  await this.mongoService.recordChannelMessage({
    messageId: reply.id,
    channelId: reply.channel.id,
    guildId: reply.guild?.id || null,
    authorId: this.client.user.id,
    authorName: this.client.user.username,
    content: response,
    timestamp: new Date(),
    executionIds: result.executionSummary.executionIds,
  });
}
```

(Capture `reply` from `message.reply(...)` — note that the existing path may use `message.channel.send` for long messages; both return a Message.)

- [ ] **Step 3: Modify ReactionHandler to handle 🔍 / 📜 / 🐛**

Add a method to `handlers/ReactionHandler.js`:

```javascript
async handleSandboxRevealReaction(reaction, user) {
  const emoji = reaction.emoji.name;
  if (!['🔍', '📜', '🐛'].includes(emoji)) return false;

  const message = reaction.message;
  if (!this.sandboxTraceService) return false;

  const executionIds = await this.mongoService.getMessageExecutionIds(message.id);
  if (executionIds.length === 0) return false;

  // Most recent execution is the rightmost in the list (agent_turn_index ascending).
  const trace = await this.sandboxTraceService.getByExecutionId(executionIds[executionIds.length - 1]);
  if (!trace) return false;

  const { AttachmentBuilder } = require('discord.js');
  const attachments = [];
  if (emoji === '🔍') {
    const a = this.sandboxTraceService.buildCodeAttachment(trace);
    attachments.push(new AttachmentBuilder(a.buffer, { name: a.filename }));
  } else if (emoji === '📜') {
    const out = this.sandboxTraceService.buildStdoutAttachment(trace);
    const err = this.sandboxTraceService.buildStderrAttachment(trace);
    attachments.push(new AttachmentBuilder(out.buffer, { name: out.filename }));
    if ((trace.stderr || '').length > 0) {
      attachments.push(new AttachmentBuilder(err.buffer, { name: err.filename }));
    }
  } else if (emoji === '🐛') {
    const err = this.sandboxTraceService.buildStderrAttachment(trace);
    attachments.push(new AttachmentBuilder(err.buffer, { name: err.filename }));
  }

  await message.reply({
    files: attachments,
    allowedMentions: { repliedUser: false },
  });
  return true;
}
```

Update constructor:

```javascript
constructor(summarizationService, mongoService, sandboxTraceService = null) {
  this.summarizationService = summarizationService;
  this.mongoService = mongoService;
  this.sandboxTraceService = sandboxTraceService;
}
```

- [ ] **Step 4: Wire SandboxTraceService into bot.js**

In `bot.js`, in the constructor after `this.mongoService` is available:

```javascript
const SandboxTraceService = require('./services/SandboxTraceService');
const sandboxColl = this.mongoService._db.collection('sandbox_executions');
this.sandboxTraceService = new SandboxTraceService({ collection: sandboxColl });
this.reactionHandler = new ReactionHandler(this.summarizationService, this.mongoService, this.sandboxTraceService);
```

(Note: accessing `_db` is a private field — if MongoService doesn't already expose a getter, add one: `get db() { return this._db; }` and use `this.mongoService.db.collection(...)`.)

- [ ] **Step 5: Wire the reveal reaction into the messageReactionAdd handler**

In `bot.js:433`, inside the `messageReactionAdd` handler, after `await this.reactionHandler.handleNewsReaction(reaction, user);`:

```javascript
await this.reactionHandler.handleSandboxRevealReaction(reaction, user);
```

- [ ] **Step 6: Add ReactionHandler tests**

```javascript
// __tests__/handlers/ReactionHandler.test.js
jest.mock('../../logger', () => ({ info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() }));

const ReactionHandler = require('../../handlers/ReactionHandler');

describe('ReactionHandler.handleSandboxRevealReaction', () => {
  let handler;
  let mockMongo;
  let mockSandboxTrace;
  let mockReply;

  beforeEach(() => {
    mockMongo = {
      getMessageExecutionIds: jest.fn().mockResolvedValue(['exec-1']),
    };
    mockSandboxTrace = {
      getByExecutionId: jest.fn().mockResolvedValue({
        execution_id: 'exec-1',
        language: 'python',
        code: 'print(1)',
        stdout: '1\n',
        stderr: '',
        exit_code: 0,
      }),
      buildCodeAttachment: jest.fn().mockReturnValue({ filename: 'code-exec-1.py', buffer: Buffer.from('print(1)') }),
      buildStdoutAttachment: jest.fn().mockReturnValue({ filename: 'stdout.txt', buffer: Buffer.from('1\n') }),
      buildStderrAttachment: jest.fn().mockReturnValue({ filename: 'stderr.txt', buffer: Buffer.from('') }),
    };
    mockReply = jest.fn().mockResolvedValue({});

    handler = new ReactionHandler({}, mockMongo, mockSandboxTrace);
  });

  function makeReaction(emojiName) {
    return {
      emoji: { name: emojiName },
      message: { id: 'm1', reply: mockReply },
    };
  }

  it('returns false for unrelated emoji', async () => {
    const result = await handler.handleSandboxRevealReaction(makeReaction('👍'), { id: 'u' });
    expect(result).toBe(false);
    expect(mockReply).not.toHaveBeenCalled();
  });

  it('replies with code attachment on 🔍', async () => {
    await handler.handleSandboxRevealReaction(makeReaction('🔍'), { id: 'u' });
    expect(mockSandboxTrace.buildCodeAttachment).toHaveBeenCalled();
    expect(mockReply).toHaveBeenCalled();
  });

  it('replies with stderr-only attachment on 🐛', async () => {
    await handler.handleSandboxRevealReaction(makeReaction('🐛'), { id: 'u' });
    expect(mockSandboxTrace.buildStderrAttachment).toHaveBeenCalled();
  });

  it('returns false when no executionIds tied to message', async () => {
    mockMongo.getMessageExecutionIds.mockResolvedValue([]);
    const result = await handler.handleSandboxRevealReaction(makeReaction('🔍'), { id: 'u' });
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 7: Run tests**

```bash
npm test
```

- [ ] **Step 8: Commit**

```bash
git add handlers/ReactionHandler.js bot.js services/MongoService.js __tests__/handlers/ReactionHandler.test.js
git commit -m "feat: 🔍/📜/🐛 reaction reveal for sandbox executions"
```

---

## Phase 7 — Retention Cron

### Task 7.1: Demotion job

**Files:**
- Create: `agent-sidecar/src/retention.py`
- Create: `agent-sidecar/tests/test_retention.py`

- [ ] **Step 1: Write failing test**

```python
# agent-sidecar/tests/test_retention.py
from datetime import datetime, timedelta, timezone

import mongomock
import pytest

from src.retention import demote_old_traces


@pytest.fixture
def db():
    return mongomock.MongoClient()["bot"]


def _make_doc(user_id: str, n: int) -> dict:
    return {
        "execution_id": f"{user_id}-{n}",
        "user_id": user_id,
        "language": "bash",
        "code": "echo " + str(n),
        "stdin": None,
        "env_keys": [],
        "stdout": str(n),
        "stderr": "",
        "egress_events": [{"dst_ip": "1.1.1.1"}],
        "gvisor_events": [],
        "agent_rationale": "test",
        "resource_usage": {},
        "exit_code": 0,
        "duration_ms": 1,
        "schedule_wait_ms": 0,
        "timed_out": False,
        "oom_killed": False,
        "orchestrator_error": None,
        "stdout_truncated": False,
        "stderr_truncated": False,
        "parent_interaction_id": "p",
        "user_tag": "u#0",
        "channel_id": "c",
        "guild_id": "g",
        "agent_turn_index": 0,
        "pod_name": "p",
        "node_name": None,
        "demoted_at": None,
        "created_at": datetime.now(tz=timezone.utc) - timedelta(days=n),
    }


def test_demotes_only_older_than_threshold(db):
    coll = db.sandbox_executions
    for i in range(60):
        coll.insert_one(_make_doc("u1", i))
    demote_old_traces(db, retention_per_user=50)

    # Newest 50 should keep code; older 10 should have code=None
    full = list(coll.find({"user_id": "u1", "code": {"$ne": None}}))
    assert len(full) == 50
    demoted = list(coll.find({"user_id": "u1", "demoted_at": {"$ne": None}}))
    assert len(demoted) == 10
    for d in demoted:
        assert d["code"] is None
        assert d["egress_events"] is None
        assert d["agent_rationale"] is None
        # Outputs preserved
        assert d["stdout"] is not None
        assert d["stderr"] is not None


def test_does_nothing_when_under_retention(db):
    coll = db.sandbox_executions
    for i in range(20):
        coll.insert_one(_make_doc("u1", i))
    demote_old_traces(db, retention_per_user=50)
    full = list(coll.find({"user_id": "u1", "code": {"$ne": None}}))
    assert len(full) == 20


def test_per_user_independent(db):
    coll = db.sandbox_executions
    for i in range(60):
        coll.insert_one(_make_doc("u1", i))
    for i in range(10):
        coll.insert_one(_make_doc("u2", i))
    demote_old_traces(db, retention_per_user=50)
    assert coll.count_documents({"user_id": "u1", "demoted_at": {"$ne": None}}) == 10
    assert coll.count_documents({"user_id": "u2", "demoted_at": {"$ne": None}}) == 0
```

- [ ] **Step 2: Run; expect ImportError**

```bash
cd agent-sidecar && . .venv/bin/activate && pytest tests/test_retention.py -v
```

- [ ] **Step 3: Implement retention.py**

```python
"""Daily retention/demotion job for sandbox_executions."""
from datetime import datetime, timezone
import logging

log = logging.getLogger(__name__)


def demote_old_traces(db, *, retention_per_user: int) -> None:
    coll = db.sandbox_executions
    user_ids = coll.distinct("user_id")
    for user_id in user_ids:
        excess = list(
            coll.find({"user_id": user_id, "demoted_at": None})
                .sort("created_at", -1)
                .skip(retention_per_user)
        )
        if not excess:
            continue
        cutoff = excess[0]["created_at"]
        result = coll.update_many(
            {"user_id": user_id, "created_at": {"$lte": cutoff}, "demoted_at": None},
            {"$set": {
                "code": None,
                "stdin": None,
                "env_keys": None,
                "egress_events": None,
                "gvisor_events": None,
                "agent_rationale": None,
                "resource_usage": None,
                "demoted_at": datetime.now(tz=timezone.utc),
            }},
        )
        log.info(f"demoted {result.modified_count} traces for user {user_id}")
```

- [ ] **Step 4: Run tests; expect pass**

```bash
pytest tests/test_retention.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Wire scheduler into server.py**

In `agent-sidecar/src/server.py` `serve()`, after creating the agent:

```python
    import asyncio as _asyncio
    from .retention import demote_old_traces

    async def _retention_loop():
        while True:
            try:
                demote_old_traces(db, retention_per_user=config.sandbox_trace_retention_per_user)
            except Exception:
                log.exception("retention loop iteration failed")
            await _asyncio.sleep(24 * 3600)

    async def _run():
        await server.start()
        log.info(f"agent sidecar listening on {config.grpc_listen_addr}")
        _asyncio.create_task(_retention_loop())
        await server.wait_for_termination()
```

- [ ] **Step 6: Commit**

```bash
cd ..
git add agent-sidecar/src/retention.py agent-sidecar/src/server.py agent-sidecar/tests/test_retention.py
git commit -m "feat(agent): daily retention demotion of sandbox traces"
```

---

## Phase 8 — Kubernetes Manifests

### Task 8.1: Cluster-wide RuntimeClass

**Files:**
- Create: `k8s/overlays/deployed/runtimeclass-gvisor.yaml`

- [ ] **Step 1: Create manifest**

```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc
```

- [ ] **Step 2: Apply (idempotent)**

```bash
kubectl apply -f k8s/overlays/deployed/runtimeclass-gvisor.yaml
kubectl get runtimeclass gvisor
```

Expected: `gvisor   runsc`. Will fail if `runsc` not yet installed on nodes — that's the prereq, not a manifest bug.

- [ ] **Step 3: Commit**

```bash
git add k8s/overlays/deployed/runtimeclass-gvisor.yaml
git commit -m "k8s: gvisor RuntimeClass"
```

### Task 8.2: ServiceAccounts, Role, RoleBinding

**Files:**
- Create: `k8s/overlays/deployed/agent-serviceaccount.yaml`
- Create: `k8s/overlays/deployed/agent-role.yaml`
- Create: `k8s/overlays/deployed/agent-rolebinding.yaml`
- Create: `k8s/overlays/deployed/sandbox-serviceaccount.yaml`

- [ ] **Step 1: agent-serviceaccount.yaml**

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: agent-sa
  namespace: discord-article-bot
```

- [ ] **Step 2: agent-role.yaml**

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
    resources: ["pods", "pods/log", "pods/attach"]
    verbs: ["get", "list", "watch", "create"]
```

- [ ] **Step 3: agent-rolebinding.yaml**

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: agent-sandbox-orchestrator
  namespace: discord-article-bot
subjects:
  - kind: ServiceAccount
    name: agent-sa
    namespace: discord-article-bot
roleRef:
  kind: Role
  name: agent-sandbox-orchestrator
  apiGroup: rbac.authorization.k8s.io
```

- [ ] **Step 4: sandbox-serviceaccount.yaml**

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: sandbox-sa
  namespace: discord-article-bot
automountServiceAccountToken: false
```

- [ ] **Step 5: Commit**

```bash
git add k8s/overlays/deployed/agent-serviceaccount.yaml k8s/overlays/deployed/agent-role.yaml k8s/overlays/deployed/agent-rolebinding.yaml k8s/overlays/deployed/sandbox-serviceaccount.yaml
git commit -m "k8s: agent + sandbox ServiceAccounts and RBAC"
```

### Task 8.3: Sandbox NetworkPolicy

**Files:**
- Create: `k8s/overlays/deployed/sandbox-networkpolicy.yaml`

- [ ] **Step 1: Discover cluster CIDRs**

```bash
kubectl cluster-info dump 2>/dev/null | grep -E "cluster-cidr|service-cluster-ip-range" | head -5
# OR check Harvester install configmap:
kubectl -n harvester-system get cm harvester-network-controller -o yaml 2>/dev/null | grep -i cidr
# OR ask kube-controller-manager flags:
kubectl get pods -n kube-system -l component=kube-controller-manager -o yaml 2>/dev/null | grep -E "cluster-cidr|service-cluster-ip-range"
```

Capture both CIDRs into shell vars:

```bash
export POD_CIDR="<paste here>"
export SVC_CIDR="<paste here>"
echo "$POD_CIDR / $SVC_CIDR"
```

- [ ] **Step 2: Write manifest with CIDRs filled in**

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
              - <POD_CIDR>          # replace with actual cluster pod CIDR
              - <SVC_CIDR>          # replace with actual cluster service CIDR
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

Replace `<POD_CIDR>` and `<SVC_CIDR>` with the values from Step 1. **Verify the manifest does not still contain placeholder strings before committing.**

- [ ] **Step 3: Commit**

```bash
git add k8s/overlays/deployed/sandbox-networkpolicy.yaml
git commit -m "k8s: sandbox egress NetworkPolicy (open public, deny RFC1918+cluster)"
```

### Task 8.4: Agent NetworkPolicy

**Files:**
- Create: `k8s/overlays/deployed/agent-networkpolicy.yaml`

- [ ] **Step 1: Manifest**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: agent-egress
  namespace: discord-article-bot
spec:
  podSelector:
    matchLabels:
      app: discord-article-bot-agent
  policyTypes: ["Egress", "Ingress"]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: discord-article-bot
      ports:
        - protocol: TCP
          port: 50051
  egress:
    # DNS
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
        - podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - { protocol: UDP, port: 53 }
        - { protocol: TCP, port: 53 }
    # In-cluster Mongo, Qdrant
    - to:
        - podSelector:
            matchLabels:
              app: mongodb
        - podSelector:
            matchLabels:
              app: qdrant
    # K8s API server (cluster-internal)
    - to:
        - namespaceSelector: {}
      ports:
        - { protocol: TCP, port: 443 }
        - { protocol: TCP, port: 6443 }
    # OpenAI public API
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 10.0.0.0/8
              - 172.16.0.0/12
              - 192.168.0.0/16
      ports:
        - { protocol: TCP, port: 443 }
```

- [ ] **Step 2: Commit**

```bash
git add k8s/overlays/deployed/agent-networkpolicy.yaml
git commit -m "k8s: agent NetworkPolicy (in-cluster + OpenAI only)"
```

### Task 8.5: Update bot NetworkPolicy

**Files:**
- Modify: `k8s/overlays/deployed/networkpolicy.yaml`

Add an egress rule from the bot pod to the agent service.

- [ ] **Step 1: Read current**

```bash
cat k8s/overlays/deployed/networkpolicy.yaml
```

- [ ] **Step 2: Append egress to agent**

Inside the existing bot NetworkPolicy's `egress` list, add:

```yaml
    # Allow bot → agent sidecar gRPC
    - to:
        - podSelector:
            matchLabels:
              app: discord-article-bot-agent
      ports:
        - protocol: TCP
          port: 50051
```

- [ ] **Step 3: Commit**

```bash
git add k8s/overlays/deployed/networkpolicy.yaml
git commit -m "k8s: bot NetworkPolicy — allow egress to agent sidecar"
```

### Task 8.6: ConfigMap for sandbox tunables

**Files:**
- Create: `k8s/overlays/deployed/configmap-sandbox.yaml`

- [ ] **Step 1: Manifest**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: sandbox-config
  namespace: discord-article-bot
data:
  SANDBOX_INLINE_OUTPUT_CHARS: "750"
  SANDBOX_WALL_CLOCK_SECONDS: "300"
  SANDBOX_PER_USER_CONCURRENCY: "2"
  SANDBOX_GLOBAL_CONCURRENCY: "15"
  SANDBOX_MEMORY_LIMIT: "2Gi"
  SANDBOX_CPU_LIMIT: "2"
  SANDBOX_TRACE_RETENTION_PER_USER: "50"
  SANDBOX_AGENT_TURN_CALL_BUDGET: "8"
  AGENT_ENABLED: "true"
  AGENT_GRPC_ADDR: "discord-article-bot-agent.discord-article-bot.svc.cluster.local:50051"
```

- [ ] **Step 2: Commit**

```bash
git add k8s/overlays/deployed/configmap-sandbox.yaml
git commit -m "k8s: ConfigMap for sandbox tunables"
```

### Task 8.7: Agent Deployment + Service

**Files:**
- Create: `k8s/overlays/deployed/agent-deployment.yaml`
- Create: `k8s/overlays/deployed/agent-service.yaml`

- [ ] **Step 1: Deployment**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: discord-article-bot-agent
  namespace: discord-article-bot
  labels:
    app: discord-article-bot-agent
spec:
  replicas: 1
  strategy:
    type: Recreate    # single-replica concurrency state; no rolling updates
  selector:
    matchLabels:
      app: discord-article-bot-agent
  template:
    metadata:
      labels:
        app: discord-article-bot-agent
    spec:
      serviceAccountName: agent-sa
      automountServiceAccountToken: true
      securityContext:
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
      containers:
        - name: agent
          image: mvilliger/discord-article-bot-agent:<TAG>
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 50051
              name: grpc
          env:
            - name: GRPC_LISTEN_ADDR
              value: "0.0.0.0:50051"
            - name: K8S_NAMESPACE
              value: "discord-article-bot"
            - name: SANDBOX_BASE_IMAGE
              value: "mvilliger/sandbox-base:<TAG>"
          envFrom:
            - configMapRef:
                name: sandbox-config
            - secretRef:
                name: discord-article-bot-secrets
          resources:
            requests:
              cpu: "200m"
              memory: "256Mi"
            limits:
              cpu: "1"
              memory: "512Mi"
          readinessProbe:
            tcpSocket:
              port: 50051
            initialDelaySeconds: 5
          livenessProbe:
            tcpSocket:
              port: 50051
            initialDelaySeconds: 30
            periodSeconds: 30
```

- [ ] **Step 2: Service**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: discord-article-bot-agent
  namespace: discord-article-bot
spec:
  selector:
    app: discord-article-bot-agent
  ports:
    - name: grpc
      port: 50051
      targetPort: 50051
  type: ClusterIP
```

- [ ] **Step 3: Commit**

```bash
git add k8s/overlays/deployed/agent-deployment.yaml k8s/overlays/deployed/agent-service.yaml
git commit -m "k8s: agent sidecar Deployment and Service"
```

### Task 8.8: Bot Deployment env updates

**Files:**
- Modify: `k8s/overlays/deployed/deployment.yaml`

- [ ] **Step 1: Add envFrom configmap-sandbox to bot container**

In the bot's container spec, add (or extend) `envFrom`:

```yaml
          envFrom:
            - configMapRef:
                name: sandbox-config
            - secretRef:
                name: discord-article-bot-secrets
```

- [ ] **Step 2: Commit**

```bash
git add k8s/overlays/deployed/deployment.yaml
git commit -m "k8s: bot reads sandbox-config configmap (AGENT_ENABLED + AGENT_GRPC_ADDR)"
```

---

## Phase 9 — Integration Testing & Acceptance

### Task 9.1: Build and push images

- [ ] **Step 1: Build sandbox image**

```bash
TAG=$(git rev-parse --short HEAD)
docker build -t mvilliger/sandbox-base:$TAG sandbox-base/
docker tag  mvilliger/sandbox-base:$TAG mvilliger/sandbox-base:latest
docker push mvilliger/sandbox-base:$TAG
docker push mvilliger/sandbox-base:latest
echo "sandbox tag: $TAG"
```

- [ ] **Step 2: Build agent image**

```bash
docker build -t mvilliger/discord-article-bot-agent:$TAG agent-sidecar/
docker push mvilliger/discord-article-bot-agent:$TAG
```

- [ ] **Step 3: Pin images in manifests**

In `k8s/overlays/deployed/agent-deployment.yaml`, replace both `<TAG>` placeholders with the actual `$TAG` value.

```bash
sed -i "s|mvilliger/discord-article-bot-agent:<TAG>|mvilliger/discord-article-bot-agent:$TAG|" k8s/overlays/deployed/agent-deployment.yaml
sed -i "s|mvilliger/sandbox-base:<TAG>|mvilliger/sandbox-base:$TAG|" k8s/overlays/deployed/agent-deployment.yaml
grep -E "image:|SANDBOX_BASE_IMAGE" k8s/overlays/deployed/agent-deployment.yaml
```

Verify no `<TAG>` strings remain.

- [ ] **Step 4: DO NOT commit deployed/ overlay (gitignored per CLAUDE.md)**

The `k8s/overlays/deployed/` overlay contains real secrets and is gitignored. Only commit the new manifests we created in Phase 8 *that don't contain secrets*. Verify by:

```bash
git status
git diff --stat
```

If `deployed/deployment.yaml` shows a diff with the image tag pinning, that's expected to live locally only. Pin tags are managed in `k8s/base/` for committed manifests if needed.

### Task 9.2: Apply manifests in order

- [ ] **Step 1: Apply RuntimeClass and SAs**

```bash
kubectl apply -f k8s/overlays/deployed/runtimeclass-gvisor.yaml
kubectl apply -f k8s/overlays/deployed/sandbox-serviceaccount.yaml
kubectl apply -f k8s/overlays/deployed/agent-serviceaccount.yaml
kubectl apply -f k8s/overlays/deployed/agent-role.yaml
kubectl apply -f k8s/overlays/deployed/agent-rolebinding.yaml
```

- [ ] **Step 2: Apply NetworkPolicies and ConfigMap**

```bash
kubectl apply -f k8s/overlays/deployed/sandbox-networkpolicy.yaml
kubectl apply -f k8s/overlays/deployed/agent-networkpolicy.yaml
kubectl apply -f k8s/overlays/deployed/configmap-sandbox.yaml
kubectl apply -f k8s/overlays/deployed/networkpolicy.yaml  # bot egress update
```

- [ ] **Step 3: Apply agent Deployment + Service**

```bash
kubectl apply -f k8s/overlays/deployed/agent-service.yaml
kubectl apply -f k8s/overlays/deployed/agent-deployment.yaml
kubectl rollout status deployment/discord-article-bot-agent -n discord-article-bot --timeout=120s
```

- [ ] **Step 4: Verify agent is healthy**

```bash
kubectl get pods -n discord-article-bot -l app=discord-article-bot-agent
kubectl logs -n discord-article-bot deployment/discord-article-bot-agent --tail=20
```

Expected log: `agent sidecar listening on 0.0.0.0:50051`.

### Task 9.3: RBAC verification

- [ ] **Step 1: sandbox-sa cannot read pods**

```bash
kubectl auth can-i --as=system:serviceaccount:discord-article-bot:sandbox-sa get pods -n discord-article-bot
```

Expected: `no`.

- [ ] **Step 2: agent-sa can create jobs but not nodes**

```bash
kubectl auth can-i --as=system:serviceaccount:discord-article-bot:agent-sa create jobs -n discord-article-bot
kubectl auth can-i --as=system:serviceaccount:discord-article-bot:agent-sa get nodes
```

Expected: `yes`, then `no`.

### Task 9.4: Sandbox manual integration tests

Each test is an `@bot <prompt>` in Discord (or a direct `Chat` gRPC call from a debug pod). Capture each result; record any failures as fixups.

For tests that don't need the agent's natural-language layer, you can poke the agent directly via grpcurl from inside a debug pod:

```bash
kubectl run debug --rm -it --image=fullstorydev/grpcurl:latest --restart=Never -- /bin/sh
# inside the debug pod:
grpcurl -plaintext -d '{"user_id":"test","user_message":"please run python: print(2+2)"}' \
  discord-article-bot-agent:50051 discordbot.agent.Agent/Chat
```

Then run the agent-driven scenarios from Discord.

- [ ] Hello world per language: `python`, `node`, `bash`, `go`, `rust`, `csharp` each return expected output, exit 0.
- [ ] Wall-clock timeout: prompt agent to run `sleep 1000`. Expect `timed_out: true`. Reply surfaces "hit the 300s wall."
- [ ] OOM: prompt agent to allocate `' '*10**10` in python. Expect `oom_killed: true`.
- [ ] Egress block to RFC1918: prompt agent to `curl -m 5 http://192.168.1.1`. Expect connection failure or timeout. If Calico flow logs available, expect deny event in the corresponding `sandbox_executions` doc.
- [ ] Egress allow public: prompt agent to `curl -s https://example.com | head -1`. Expect HTML doctype, exit 0.
- [ ] DNS works: prompt agent to `dig +short example.com`. Expect IP returned.
- [ ] No service-link env leak: prompt agent to `env | grep -i mongodb || echo NONE`. Expect `NONE`.
- [ ] No SA token: prompt agent to `cat /var/run/secrets/kubernetes.io/serviceaccount/token || echo MISSING`. Expect `MISSING` (or "No such file or directory").
- [ ] Per-user concurrency cap: hammer 3 simultaneous executions from one user. Expect 3rd to come back with "you have 2 sandboxes running" message immediately.
- [ ] Sidecar-down fallback: `kubectl scale deployment/discord-article-bot-agent --replicas=0 -n discord-article-bot`; send `/chat hello`. Bot should reply normally (direct-OpenAI path) within ~30s of detection. Restore: `kubectl scale ... --replicas=1`.
- [ ] Reaction reveal: send a prompt that triggers code exec. React to the bot's reply with 🔍 — expect code attachment. React with 📜 — expect stdout/stderr text attachments. React with 🐛 — expect stderr only.

### Task 9.5: Regression checks

- [ ] `npm test` (Node) — all green, including new + existing.
- [ ] `cd agent-sidecar && pytest` — all green.
- [ ] Mention chat without code intent (`@bot hi how are you`) does not spawn a sandbox.
- [ ] Reply to bot mention chat (the bug fixed in v2.12.1) still routes through agent.
- [ ] Reply to imagegen still regenerates image.
- [ ] Reply to summarization still answers follow-up.
- [ ] `/tldr`, `/stats`, `/chat`, `/personalities` all behave unchanged.

### Task 9.6: Acceptance gate

- [ ] All Phase-9 manual integration tests pass.
- [ ] `AGENT_ENABLED=false` → bot reverts to direct-OpenAI; verified with `kubectl set env deployment/discord-article-bot AGENT_ENABLED=false -n discord-article-bot`, then a real Discord prompt, then revert.
- [ ] One real friend-group test session against a soft-launch channel with no critical findings.
- [ ] Bump version, push, deploy bot side, open PR.

```bash
npm version minor --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore: bump version to <new>"
docker build -t mvilliger/discord-article-bot:<new> .
docker push mvilliger/discord-article-bot:<new>
kubectl set image deployment/discord-article-bot bot=mvilliger/discord-article-bot:<new> -n discord-article-bot
kubectl rollout status deployment/discord-article-bot -n discord-article-bot --timeout=120s
```

- [ ] Update `CLAUDE.md`'s "Voice Profile" section with a new "Agentic Sandbox" sibling section documenting the env vars and the AGENT_ENABLED kill switch.

```markdown
## Agentic Sandbox

The bot routes channel-voice through an ADK agent sidecar that can call
`run_in_sandbox` to execute code in ephemeral gVisor pods.

**Toggle:** `AGENT_ENABLED=false` reverts channel-voice to direct-OpenAI.
**Sidecar:** `discord-article-bot-agent` Deployment, single replica only
(in-process concurrency state; do not scale).

**Tunables (sandbox-config ConfigMap):** SANDBOX_INLINE_OUTPUT_CHARS,
SANDBOX_WALL_CLOCK_SECONDS, SANDBOX_PER_USER_CONCURRENCY,
SANDBOX_GLOBAL_CONCURRENCY, SANDBOX_MEMORY_LIMIT, SANDBOX_CPU_LIMIT,
SANDBOX_BASE_IMAGE, SANDBOX_TRACE_RETENTION_PER_USER,
SANDBOX_AGENT_TURN_CALL_BUDGET.
```

- [ ] Update `features.md` to document the agent + sandbox capability.

- [ ] Open PR against main:

```bash
git push -u origin feat/agentic-sandbox-skills-runtime
gh pr create --base main --head feat/agentic-sandbox-skills-runtime \
  --title "feat: agentic sandbox skills runtime (v1)" \
  --body "$(cat <<'EOF'
Implements the design at docs/superpowers/specs/2026-04-28-agentic-sandbox-skills-runtime-design.md.

## Summary
- ADK agent sidecar (Python) routes channel-voice chats with autonomous run_in_sandbox tool calls
- Ephemeral gVisor pods per execution; 2 vCPU / 2Gi / 256Mi tmpfs / 300s wall-clock
- NetworkPolicy: open public internet, deny RFC1918 + cluster CIDR + K8s API
- Concurrency 2/user, 15/cluster
- Reaction reveal (🔍 / 📜 / 🐛) on bot replies
- Trace storage in MongoDB sandbox_executions collection, demotion at 50/user
- AGENT_ENABLED=false kill switch for instant rollback

## Test plan
[manual integration test list from Phase 9.4]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes (post-write)

Spec coverage check:
- §1.3 in scope items — all covered.
- §1.3 out of scope — not implemented (correct).
- §2 architecture — AgentClient (Task 5.2), sidecar (Phase 2/4), orchestrator (Phase 3), sandbox pod (Phase 1 + Task 3.2) all present.
- §2.4 trust boundaries — sandbox SA has no Role (Task 8.2 + Task 3.2 enforces no-token); agent SA scoped Role (Task 8.2); bot networkpolicy update (Task 8.5).
- §3.1 trace doc fields — all populated by ExecutionRecord in Task 3.4 + orchestrator output.
- §3.3 retention demotion — Phase 7.
- §3.4 inline output cap (750 chars) — handled in `_handleMentionChat` rendering. **Gap noted**: the inline truncation was specced but isn't an explicit task. Adding a fixup note: bot.js `_handleMentionChat` should truncate `result.message` to `config.sandbox.inlineOutputChars` (default 750) and append "*(output truncated, react 📜 to see more)*" when `executionSummary.executionCount > 0` and message length exceeds cap. Implementer: do this inside Task 5.4 when wiring AgentClient. **Inline addendum below.**
- §3.5 ConfigMap knobs — Task 8.6 covers all of them including SANDBOX_AGENT_TURN_CALL_BUDGET.
- §3.6 gRPC contract — Task 2.1.
- §4 K8s manifests — Phase 8.
- §5 agent — Phase 4.
- §5.4 error/retry behavior — orchestrator + tool surface the codes (Tasks 3.6, 4.1).
- §5.5 testing — distributed across phases.
- §5.6 acceptance checklist — Phase 9.6.

**Inline addendum to Task 5.4 (inline output cap)**: when wiring AgentClient into bot.js, also add the inline-cap logic. In `_handleMentionChat` at the success path, if `result.executionSummary?.executionCount > 0` and `result.message.length > config.agent.inlineOutputChars` (read from new `config.agent.inlineOutputChars` env-var-default-750), truncate to the cap and append `\n\n*(output truncated, react 📜 to see more)*`. The split-favoring-stderr logic from §3.4 lives inside the agent sidecar's reply formatting (Phase 4 ChannelVoiceAgent.process_chat) — when assembling the natural-language reply that includes inline output snippets, the agent should be prompted via the system instruction to honor the 750-char inline cap. Document this in the system prompt by adding to TOOL_AVAILABILITY_PREAMBLE: `"When including stdout/stderr in your reply, keep total inline output ≤ 750 characters; users can react 📜 for the full output."`. Update `agent-sidecar/src/agent.py:TOOL_AVAILABILITY_PREAMBLE` to include this line in Phase 4 implementation.

Placeholder scan: no "TBD", no "TODO", no naked "implement later." Two `<TAG>` placeholders in agent-deployment.yaml are explicitly resolved by `sed` in Task 9.1 step 3. Two `<POD_CIDR>`/`<SVC_CIDR>` in sandbox-networkpolicy.yaml resolved by manual fill in Task 8.3 with verification step.

Type/name consistency: `OrchestratorResult` matches across Tasks 3.6, 4.1, and AgentClient mappings in 5.2. `ExecutionRecord` fields match the trace doc schema in §3.1. `RunInSandboxTool.execution_ids` matches the gRPC `ExecutionSummary.execution_ids` field name (snake/camel translated by AgentClient).

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-28-agentic-sandbox-skills-runtime.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for this plan because the phases are largely independent and each task is well-bounded.

**2. Inline Execution** — Execute tasks in this session using the executing-plans skill, batch execution with checkpoints for review.

**Which approach?**
