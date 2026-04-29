# Overnight Run — Pause Snapshot

**Paused:** 2026-04-29 (mid-Phase 4) — user paused execution to switch into auto-accept mode.

**Branch:** `feat/agentic-sandbox-skills-runtime` (synced to origin, all commits pushed).

## Where we are

**Completed:** Phases 0–3 fully + Task 4.1.

| Task | Status | Commit |
|---|---|---|
| 1.1 executor.py | ✅ done | a0bb42b |
| 1.2 Sandbox Dockerfile + README | ✅ done | b4e45db, e5865d0 (+size correction) |
| 2.1 gRPC proto contract | ✅ done | 22cf9de |
| 2.2 Python project skeleton | ✅ done | b854f6c |
| 2.3 Generate Python gRPC stubs | ✅ done | 0e25762 |
| 2.4 gRPC server (Health-only) | ✅ done | ab36dd8 |
| 2.5 Sidecar Dockerfile | ✅ done | 828e281 |
| 3.1 Concurrency gate | ✅ done | dcde491 |
| 3.2 K8s Job template generator | ✅ done | 33912b8 |
| 3.3 Log partitioning | ✅ done | 810d92e |
| 3.4 Trace store | ✅ done | bb22bcc |
| 3.5 Egress scraper | ✅ done | 245a77a |
| 3.6 Sandbox orchestrator | ✅ done | 01b11ad |
| 4.1 run_in_sandbox tool | ✅ done | 08c1495 |
| 4.2 ADK agent + Chat handler | ⏸️ paused — about to start | — |
| 4.3 Live K8s client adapter | ⏸️ pending | — |
| 4.4 Phase 4 sanity check | ⏸️ pending | — |
| 5.1–8.8 | ⏸️ pending | — |

**All sidecar tests passing:** 39/39 at last run (`cd agent-sidecar && . .venv/bin/activate && make test`).

## State of the working tree

Clean. Everything committed. Origin in sync. No uncommitted edits anywhere.

## What's tracked in TaskList

32 tasks created (IDs 1–32). Tasks 1–14 marked completed. Task 15 (Task 4.2 ADK agent) marked in_progress when execution paused.

## Notable findings (read these before resuming)

1. **`google-adk` landed at 1.31.1** in the venv (plan was written assuming `>=0.5.0`). The plan explicitly anticipated this and said "exact API may shift between versions; adapt agent.py while keeping process_chat() shape." The Task 4.2 implementer needs to probe the installed API first (`from google.adk.agents import Agent; inspect.signature(Agent.__init__)`) and adapt the import paths/argument shape if needed, OR fall back to a stub `process_chat()` that returns `agent integration pending` so phases 5–8 stay unblocked.

2. **`zstd` was missing from the sandbox Dockerfile** (Task 1.2). Implementer added it because Ollama's installer requires it on Debian 12 slim. Spec was wrong. Real fix, kept.

3. **Sandbox image is ~8Gi, not 3–4Gi** as spec/plan estimated. README updated to reflect reality (commit e5865d0). Plan ahead for ~8Gi node pull time on first deployment.

4. **Sidecar Dockerfile uses `PYTHONPATH=/app:/app/src`** (not just `/app` as the plan said). Why: protoc-generated `agent_pb2_grpc.py` uses bare `import agent_pb2`, which only resolves with `/app/src` on the path. The fix is correct and necessary.

5. **`enableServiceLinks: false`** in the sandbox Job template — confirmed in tests. Without this, K8s would inject env vars for every Service in the namespace (e.g. `MONGODB_PORT_27017_TCP_ADDR`), leaking RFC1918 reachability paths into the sandbox env. Critical security control.

6. **Task 3.6 had a silent failure mode the first time** — the implementer agent created the orchestrator files but never committed/pushed. The retry caught it (files existed; just needed to add+commit+push). Worth watching for similar mode in remaining tasks: always verify `git log` after each task.

7. **Phase 9 prerequisites the user must handle**:
   - Install `runsc` on each Harvester worker node (gVisor runtime).
   - Decide on Calico flow log enablement (egress observation depends on it; falls back to Noop if not).
   - Discover and fill `<CLUSTER_POD_CIDR>` and `<CLUSTER_SERVICE_CIDR>` in `k8s/overlays/deployed/sandbox-networkpolicy.yaml` (Task 8.3) — these are gitignored placeholder slots in the deployed overlay anyway.

## Resuming

When you're back, you can either:

- **(A)** Tell Claude to continue from Task 4.2 in the same conversation.
- **(B)** Start a new session with auto-accept enabled and say something like "continue executing the agentic sandbox plan starting from Task 4.2 — see `docs/superpowers/plans/2026-04-28-agentic-sandbox-skills-runtime.md`, the spec at `docs/superpowers/specs/2026-04-28-agentic-sandbox-skills-runtime-design.md`, and `NIGHTLY_NOTES.md` for state." The fresh session can pick up the TaskList and dispatch Task 4.2 directly.

Either way, Task 4.2's prompt was already drafted (look back in transcript for the prompt that was rejected — it's complete and ready to dispatch). The implementer's first instruction is: "probe ADK 1.31.1 API before coding."

## Verification command

To confirm state on resume:

```bash
cd /home/ubuntu/workspace/discord-article-bot
git log --oneline main..HEAD | head
cd agent-sidecar && . .venv/bin/activate && make test
```

Expected: 17 commits ahead of main, 39/39 sidecar tests passing.
