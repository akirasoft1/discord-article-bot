# Local Prompt Tuning Tool

Iterate on the `channel-voice` system prompt locally. Pulls recent user messages from MongoDB, replays each against a candidate template AND the current production baseline, and emits a markdown side-by-side report you eyeball in your editor.

Spec: `docs/superpowers/specs/2026-05-16-prompt-tuning-tool-design.md`

## Quickstart

```bash
# 1. Draft a candidate
cp personalities/channel-voice.js scripts/prompt-tuning/candidates/no-tech-bias-v1.js
$EDITOR scripts/prompt-tuning/candidates/no-tech-bias-v1.js

# 2. Run replay (n=20 by default, ~$0.005 on gpt-5-mini)
node scripts/prompt-tuning/run.js \
  --candidate scripts/prompt-tuning/candidates/no-tech-bias-v1.js \
  --n 20 --label no-tech-bias-v1

# 3. Open the report (path printed at end of run)
$EDITOR scripts/prompt-tuning/runs/<timestamp>-no-tech-bias-v1.md

# 4. Iterate: edit the candidate, re-run (each run is a new timestamped report)

# 5. Promote (manual — deliberate "I'm shipping this" step):
#    Copy the candidate's systemPrompt value into personalities/channel-voice.js
#    Commit, bump version, build/push image, deploy.
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

Set `OPENAI_API_KEY` and `MONGO_URI` (same values your local bot uses).

Cost guardrail: refuses to run if estimated cost exceeds $1 unless `PROMPT_TUNING_CONFIRM_COST=1` is set.

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
