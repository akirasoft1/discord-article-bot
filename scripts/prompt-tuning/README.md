# Prompt Tuning Tool

Iterate on the `channel-voice` system prompt. Pulls recent user messages from MongoDB, replays each against a candidate template AND the current production baseline, and emits a markdown side-by-side report you eyeball in your editor.

Spec: `docs/superpowers/specs/2026-05-16-prompt-tuning-tool-design.md`

## Running it — the only supported path

The MongoDB used by the bot is **cluster-internal** (`mongodb://...@akmongodb-svc:27017/discord`) and not reachable from outside the cluster. Run the tool **inside the bot pod** via `kubectl exec`. The pod already has every required environment variable wired up (the bot uses them every second), so you don't need to populate `.env` locally.

A wrapper script handles the copy-in / exec / copy-out:

```bash
# 1. Draft a candidate locally
cp personalities/channel-voice.js scripts/prompt-tuning/candidates/no-tech-bias-v1.js
$EDITOR scripts/prompt-tuning/candidates/no-tech-bias-v1.js

# 2. Run inside the production bot pod (wrapper handles cp-in, exec, cp-out)
./scripts/prompt-tuning/run-in-pod.sh \
  scripts/prompt-tuning/candidates/no-tech-bias-v1.js \
  --n 20 --label no-tech-bias-v1

# 3. Open the report (path printed at end of run; lands locally)
$EDITOR scripts/prompt-tuning/runs/<timestamp>-no-tech-bias-v1.md

# 4. Iterate: edit the candidate, re-run. Each run is a new timestamped report.

# 5. Promote (manual — deliberate "I'm shipping this" step):
#    Copy the winning candidate's systemPrompt value into personalities/channel-voice.js
#    Commit, bump version, build/push image, deploy via the standard flow.
```

The wrapper requires `kubectl` configured for the cluster and the `discord-article-bot` namespace.

### What happens inside the pod

The wrapper is image-agnostic — it works whether the running pod was built before or after this tool existed. It:
1. Resolves the current bot pod name (`kubectl get pod -l app.kubernetes.io/name=discord-article-bot ...`)
2. `mkdir -p`s `/usr/src/app/scripts/prompt-tuning/{candidates,runs}` inside the pod (no-op when the image already has them)
3. `kubectl cp`s your local `run.js` into `/usr/src/app/scripts/prompt-tuning/run.js` (so the wrapper works even against pods built before this tool existed)
4. `kubectl cp`s your candidate file into `/usr/src/app/scripts/prompt-tuning/candidates/`
5. `kubectl exec`s `node scripts/prompt-tuning/run.js --candidate ...` with all the runtime env vars already populated by the deployment's envFrom/secret bindings
6. `kubectl cp`s the resulting report back to your local `scripts/prompt-tuning/runs/`
7. Cleans up the candidate + report files from the pod so they don't survive across pod rolls. (`run.js` is intentionally left in place — harmless and saves the next run a copy step.)

### Manual fallback (no wrapper)

If you prefer to run the commands by hand:

```bash
POD=$(kubectl get pod -n discord-article-bot \
  -l app.kubernetes.io/name=discord-article-bot \
  -o jsonpath='{.items[0].metadata.name}')

# Copy candidate in
kubectl cp -c bot scripts/prompt-tuning/candidates/no-tech-bias-v1.js \
  discord-article-bot/${POD}:/usr/src/app/scripts/prompt-tuning/candidates/no-tech-bias-v1.js

# Run
kubectl exec -n discord-article-bot ${POD} -c bot -- \
  node scripts/prompt-tuning/run.js \
  --candidate scripts/prompt-tuning/candidates/no-tech-bias-v1.js \
  --n 20 --label no-tech-bias-v1

# Find the report filename it wrote (printed at the end of the run)
# Then copy it out
kubectl cp -c bot \
  discord-article-bot/${POD}:/usr/src/app/scripts/prompt-tuning/runs/<filename>.md \
  scripts/prompt-tuning/runs/<filename>.md
```

## CLI flags

| Flag | Default | Notes |
|---|---|---|
| `--candidate` (required) | — | Path to a personality module |
| `--n` | `20` | Number of recent user messages to replay |
| `--label` | filename stem of `--candidate` | Used in report filename |
| `--channel` | unset (all tracked channels) | Discord channel ID to filter to |
| `--days` | `7` | Look-back window |
| `--baseline` | `personalities/channel-voice.js` | Control prompt |
| `--model` | `config.openai.model` | OpenAI model |
| `--seed` | unset | Pass `seed:` for reproducibility |

## Environment

When running via `run-in-pod.sh` (the supported path), the pod already has `OPENAI_API_KEY`, `MONGO_URI`, `DISCORD_CLIENT_ID`, and every other env var the bot needs — there is nothing for you to set locally. The wrapper script does NOT touch your `.env`.

If you're running outside the cluster (`node scripts/prompt-tuning/run.js` directly), you need `OPENAI_API_KEY` and `MONGO_URI` — but be aware the MongoDB endpoint `akmongodb-svc:27017` is only resolvable inside the cluster, so direct local runs only work if you've port-forwarded MongoDB or have your own copy of the data.

Cost guardrail: refuses to run if estimated cost exceeds $1 unless `PROMPT_TUNING_CONFIRM_COST=1` is set. The wrapper script forwards this env var into the pod when set locally.

## What the report contains

- Run metadata (date, candidate, baseline, model, voice profile version, seed, total cost)
- Diff summary (avg response length, tokens, exact-match rate)
- Per-case block: channel + author, user input, baseline response, candidate response

## Limitations

- **Single-turn replay only.** No prior conversation history, no mem0 memories, no channel-context injection, no agent-sidecar routing. This is intentional — the tool isolates the `systemPrompt` template as the only variable.
- **Subjective comparison.** No automated scoring; you eyeball the report and decide what to ship.
- **Local-only.** This tool is not exposed at runtime. There is no slash command for it.

## Workflow notes

- `candidates/` and `runs/` are gitignored; drafts and reports stay on your machine.
- Promoting a winner is a deliberate manual copy into `personalities/channel-voice.js` — forces an "I'm shipping this" decision and a normal commit + version-bump + deploy.
- The longer-term plan is to harden the voice-profile *regeneration* pipeline so the auto-generated `voice_instructions` are less topic-biased; see `docs/architecture.md` and `features.md` for that follow-up.
