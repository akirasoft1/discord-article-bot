# Kubernetes Deployment Runbook

Operational runbook for deploying and operating the Discord Article Bot on Kubernetes. For the cluster topology and how all the pieces connect, see [`docs/architecture.md`](docs/architecture.md). For the Kata sandbox install play-by-play, see [`k8s/sandbox/README.md`](k8s/sandbox/README.md).

## Quick orientation

- **Namespace**: `discord-article-bot`. Everything lives here — bot, agent sidecar, ephemeral Kata sandbox Jobs, MongoDB, Qdrant, Postgres.
- **Source of truth**: `k8s/overlays/deployed/` is gitignored and holds the live manifests with real secrets. The `k8s/base/` and `k8s/overlays/prod/` paths are stale (out of sync, placeholder secrets) — **do not use them**.
- **Image tags**: every image is pinned to a git short-SHA. `:latest` is forbidden. The bot, agent sidecar, and `sandbox-base` images move in lockstep when any of them changes.
- **Container name** in the bot deployment is `bot`, not `discord-article-bot`.

## Prerequisites

- A Kubernetes cluster with the **Kata Containers RuntimeClass `kata-qemu-runtime-rs`** registered — see [`k8s/sandbox/README.md`](k8s/sandbox/README.md) for the install play-by-play. Without Kata, the agent sidecar's `run_in_sandbox` tool won't work.
- `kubectl` configured for the cluster.
- A Docker registry (this project uses Docker Hub: `mvilliger/*`).
- A live MongoDB pod, Qdrant pod, and Postgres-pgvector pod in the same namespace. All three run in-cluster; see deployment manifests under `k8s/overlays/deployed/`.

## Initial deploy

1. **Create the namespace.**
   ```bash
   kubectl create namespace discord-article-bot
   ```

2. **Fill in your local `k8s/overlays/deployed/` files.** This directory is gitignored. You need at minimum:
   - `secret.yaml` — `DISCORD_TOKEN`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY` (if music gen is on), `MONGO_PASSWORD`, `LINKWARDEN_API_TOKEN` (optional), `BOT_ADMIN_USER_IDS`, and a `service-account.json` for Vertex AI / GCS if Veo is enabled.
   - `configmap.yaml` — all env vars (feature flags, model names, etc.). The bot's `config/config.js` is the canonical source of which keys are read.
   - `configmap-prompt.yaml` — `prompt.txt` content mounted into the bot at `/usr/src/app/prompt.txt`.
   - `configmap-sandbox.yaml` — sandbox tunables for the agent sidecar (concurrency, wall-clock, etc.).
   - `deployment.yaml` — bot Deployment, with `image:` pinned to a built short-SHA and the env vars wired from the secret/configmap.
   - `service.yaml`, `serviceaccount.yaml`, `networkpolicy.yaml` — for the bot pod.
   - `agent-deployment.yaml`, `agent-service.yaml`, `agent-serviceaccount.yaml`, `agent-role.yaml`, `agent-rolebinding.yaml`, `agent-networkpolicy.yaml` — for the agent sidecar (with K8s RBAC to create/delete sandbox Jobs).
   - `sandbox-networkpolicy.yaml`, `sandbox-serviceaccount.yaml` — for the ephemeral sandbox pods.

3. **Apply everything.**
   ```bash
   kubectl apply -f k8s/overlays/deployed/ -n discord-article-bot
   ```

4. **Register slash commands.** Wait for the bot pod to be `1/1 Running`, then:
   ```bash
   POD=$(kubectl get pod -n discord-article-bot -l app.kubernetes.io/name=discord-article-bot -o jsonpath='{.items[0].metadata.name}')
   kubectl exec -n discord-article-bot $POD -c bot -- node scripts/registerCommands.js
   ```
   This pushes the schema globally AND (if `DISCORD_TEST_GUILD_ID` is set) to your test guild for instant feedback. Global propagation can take up to 1 hour.

## Ship-a-change deploy loop

```bash
# 1. Run tests
npm test

# 2. Bump version (semver: minor for features, patch for fixes)
npm version minor --no-git-tag-version
git add package.json package-lock.json && git commit -m "chore: bump version to X.Y.Z"

# 3. Build + push (always pin to git short-SHA — no :latest)
SHA=$(git rev-parse --short HEAD)
docker build -t mvilliger/discord-article-bot:$SHA .
docker push mvilliger/discord-article-bot:$SHA

# 4. Update local deployment.yaml image tag to $SHA, then roll out
kubectl set image deployment/discord-article-bot bot=mvilliger/discord-article-bot:$SHA -n discord-article-bot
kubectl rollout status deployment/discord-article-bot -n discord-article-bot --timeout=180s

# 5. Re-register slash commands if any command schema changed
POD=$(kubectl get pod -n discord-article-bot -l app.kubernetes.io/name=discord-article-bot -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n discord-article-bot $POD -c bot -- node scripts/registerCommands.js
```

For agent-sidecar changes the agent and `sandbox-base` images move together; build/push/deploy both at the same SHA.

## Adding a new secret-backed integration

This is the trap that bit PR #79's ElevenLabs rollout. When adding a new external service that needs a secret:

1. Add the key to **`k8s/overlays/deployed/secret.yaml`** (gitignored — local only).
2. Add the consuming env var defaults to **`k8s/overlays/deployed/configmap.yaml`**.
3. **Wire the secret as an env var in `k8s/overlays/deployed/deployment.yaml`** using `valueFrom: secretKeyRef`. Without this step the pod starts but `config.<service>.apiKey` reads an empty string and the service initializes as disabled. The agent will produce a startup warning like `<Service> disabled: missing <KEY>`.
4. `kubectl apply -f k8s/overlays/deployed/secret.yaml -f k8s/overlays/deployed/configmap.yaml -f k8s/overlays/deployed/deployment.yaml -n discord-article-bot` and roll out.

## NetworkPolicy: opening egress to a new destination

The bot namespace has a restrictive NetworkPolicy that blocks egress to private IP ranges by default. When adding a service on a home / lab network (`192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`):

1. Edit `k8s/overlays/deployed/networkpolicy.yaml` (gitignored).
2. Add an `egress` rule with the specific `ipBlock` CIDR and port. Example for Ollama on the home network:
   ```yaml
   - to:
       - ipBlock:
           cidr: 192.168.1.164/32
     ports:
       - protocol: TCP
         port: 11434
   ```
3. `kubectl apply -f k8s/overlays/deployed/networkpolicy.yaml -n discord-article-bot`
4. Restart the pod to re-evaluate any service inits that ran against a now-allowed endpoint.

To debug connectivity:
```bash
# Inspect current policy
kubectl get networkpolicies -n discord-article-bot -o yaml

# Test from a fresh unrestricted pod (bypasses the namespace policy because
# this pod isn't selected by it)
kubectl run test-curl --rm -it --image=curlimages/curl -- curl http://<ip>:<port>/path
```

## Troubleshooting

### Duplicate messages / multiple replies

**Always check this first.** If the bot is replying twice to every message, there are almost certainly two pods running with the same `DISCORD_TOKEN`:

```bash
kubectl get pods -A | grep -i discord
kubectl get deployments -A | grep -i discord
```

Multiple instances with the same token all receive Discord events and all respond. A real incident (Dec 2025): a forgotten deployment in the `default` namespace ran alongside production for 10 days.

### Bot starts but a feature is "disabled"

Check the pod's startup logs:
```bash
kubectl logs -n discord-article-bot deployment/discord-article-bot --tail=50 -c bot | grep -iE "disabled|enabled"
```
`<X>Service disabled: missing <KEY>` usually means a secret-binding gap in `deployment.yaml` — see [Adding a new secret-backed integration](#adding-a-new-secret-backed-integration).

### Local LLM (Ollama) circuit-breaker tripped

When Ollama becomes unavailable mid-runtime, the bot logs `LocalLlmService temporarily unavailable, falling back` and uses the cloud LLM for the next 60 seconds. The `uncensored` personality declares `fallbackPersonality: 'friendly'` and the user is notified with a warning emoji. After the cooldown, the next request optimistically retries Ollama.

### Sandbox pods not starting / Kata errors

Most likely the `kata-qemu-runtime-rs` RuntimeClass isn't installed in the cluster. Confirm:
```bash
kubectl get runtimeclass kata-qemu-runtime-rs
```
If missing, see [`k8s/sandbox/README.md`](k8s/sandbox/README.md) for the install procedure.

On AMD hosts, the `kvm_amd sev=0` kernel parameter is sometimes needed for nested virt to work. The sandbox README has the workaround.

### "Bot is online" but slash commands don't appear

You probably forgot the `scripts/registerCommands.js` step after the rollout, or you tried it before the new pod was healthy. Re-run it after `kubectl rollout status` returns success. Discord caches the schema globally for up to 1 hour; if you set `DISCORD_TEST_GUILD_ID`, the test-guild registration is instant.

## Observability

- Distributed traces (with full LLM prompt/completion content via OpenLLMetry) export over OTLP HTTP to `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` — in production this is `http://telemetry-ingest.dynatrace.svc.cluster.local:4318/v1/traces`.
- Metrics and logs exporters are explicitly set to `none` (Dynatrace OneAgent handles those).
- The `tracing.js` module **must be required before all other modules** — it's at `bot.js:4`.

## Pre-existing dev/operator preferences

- **Image pinning**: every Docker tag is a git short-SHA. The agent sidecar image and `sandbox-base` image move in lockstep (both must bump together on every release).
- **No log truncation**: logger calls never truncate payloads — full error messages, full URLs.
- **Single replica with `Recreate` strategy** for both the bot and the agent sidecar. Conversation state and sidecar concurrency caps are in-process — do not scale either to >1 replica.