# Local Prompt Tuning Tool — Design Spec

**Date:** 2026-05-16
**Status:** Approved, going to implementation
**Author:** Michael Villiger (with Claude)

## Goal

A local Node.js script the developer runs from the dev console to iterate on `personalities/channel-voice.js` and decide what to commit. Pulls recent real user messages from MongoDB, replays each against a candidate `systemPrompt` template AND the current baseline, and emits a markdown side-by-side report. No production code is touched; no deploy.

## Motivation

The bot has been over-indexing on developer topics (github, .net, etc.) in chat responses. The static `channel-voice` system prompt already says "don't introduce topics nobody mentioned," but that guard isn't holding — likely because the auto-generated voice profile bakes dev-flavored vocabulary into `voice_instructions`. Short term, the developer wants offline iteration on the static template to commit fixes immediately. Longer term, the regen pipeline itself needs hardening (separate work item — see `features.md`).

## Non-goals

- Tuning the voice-profile regeneration pipeline (`VoiceProfileService`'s `ANALYSIS_PROMPT` and `SYNTHESIS_PROMPT`). Out of scope; tracked as a separate follow-up.
- Reproducing the full `ChatService` chain (mem0 + channel context + agent sidecar routing). The tool deliberately isolates the system-prompt variable.
- Automated scoring of candidate vs. baseline. Decisions are eyeball/judgment, not numeric.
- Continuous integration into CI. This is a dev-console tool, not a CI gate.
- Runtime feature exposure (no slash command, no admin UI). Local-only.

## Approach

**Approach A (selected): Standalone Node.js script** under `scripts/prompt-tuning/`. Imports the bot's existing `MongoService` and config; spins up a minimal OpenAI client; runs N parallel candidate-vs-baseline replays; writes a markdown report. No new dependencies.

**Approach B (rejected):** Jest-as-eval-harness. Wrong tool — eval harnesses are for automated scoring against a ground truth. Here the "ground truth" is the developer's subjective judgment of two responses.

**Approach C (rejected):** Interactive REPL. Overbuilt for a tool used a few times per week.

## File layout

```
scripts/prompt-tuning/
  run.js                 (new — main entry)
  README.md              (new — workflow guide)
  candidates/
    .gitkeep             (new)
  runs/
    .gitkeep             (new)
.gitignore               (modified — ignore candidates/* + runs/* with .gitkeep + README exceptions)
docs/architecture.md     (modified — one-line follow-up note)
features.md              (modified — backlog entry)
```

**No production code modified.** The script imports `services/MongoService.js` and `config/config.js` but does not mutate them.

## CLI

```
node scripts/prompt-tuning/run.js \
  --candidate scripts/prompt-tuning/candidates/no-tech-bias-v1.js \
  --n 20 \
  --label no-tech-bias-v1 \
  [--channel <channelId>] \
  [--days 7] \
  [--baseline personalities/channel-voice.js] \
  [--model gpt-5-mini] \
  [--seed 42]
```

| Flag | Required | Default | Notes |
|---|---|---|---|
| `--candidate` | yes | — | Path to a personality module (must default-export `{ id, name, systemPrompt, useVoiceProfile, ... }`) |
| `--n` | no | `20` | Number of recent user messages to replay |
| `--label` | no | filename stem of `--candidate` | Used in the output report filename |
| `--channel` | no | unset (all tracked channels) | Discord channel ID to sample from |
| `--days` | no | `7` | Look-back window for sampling |
| `--baseline` | no | `personalities/channel-voice.js` | Control prompt to compare against |
| `--model` | no | `config.openai.model` | OpenAI model used for both candidate and baseline runs |
| `--seed` | no | unset | If set, pass `seed:` to OpenAI for reproducibility |

## Data flow

```
node scripts/prompt-tuning/run.js
   ↓
1. Parse args; validate required flags.
2. Load config (config/config.js — same module the bot uses).
3. Validate: candidate path exists; OPENAI_API_KEY and MONGO_URI present.
4. Construct: MongoService instance, OpenAI client.
5. Load voice profile snapshot:
     - Query MongoDB voice_profiles collection for the latest doc.
     - Extract voiceInstructions string.
     - If none: warn, substitute "[no voice profile available]" into the slot.
6. Sample input set:
     - Query MongoDB messages collection: last --days days,
       optional channel filter, user messages only (no bot replies,
       no slash-command invocations).
     - Order chronological, take last --n.
     - If 0 results: exit 1 with a clear error.
7. Estimate cost:
     - Rough token count = (avg prompt tokens) × --n × 2 sides.
     - Apply config model's pricing from CostService's pricing map.
     - If estimated cost > $1 and PROMPT_TUNING_CONFIRM_COST != "1": exit 1.
     - Otherwise print the estimate and proceed.
8. For each sampled message (batched, concurrency 4):
     a. baselineSystem = baselineModule.systemPrompt.replace('{VOICE_INSTRUCTIONS}', voiceInstructions)
     b. candidateSystem = candidateModule.systemPrompt.replace('{VOICE_INSTRUCTIONS}', voiceInstructions)
     c. Parallel: two openai.chat.completions.create calls
          { model, messages: [{role:'system', content:<system>}, {role:'user', content:msg.content}], seed? }
     d. Capture both responses + usage objects.
     e. If one side errors: log it, mark that side "[OPENAI ERROR: <message>]", continue.
9. Build markdown report (see below).
10. Write to scripts/prompt-tuning/runs/<YYYY-MM-DD-HHMM>-<label>.md
11. Print the absolute path of the report to stdout.
12. Close MongoService.
```

## Report format

```markdown
# Prompt tuning run: <label>

**Date:** <YYYY-MM-DD HH:MM UTC>
**Candidate:** <path>
**Baseline:** <path>
**Model:** <model>
**Voice profile:** v<n> (generated <date>)
**Sampled:** <n> user messages from last <d> days[, channel <id>]
**Seed:** <seed or "none">
**Cost:** $<baseline> baseline + $<candidate> candidate = $<total> total

## Diff summary
- Avg response length: baseline <chars>, candidate <chars> (<delta%>)
- Tokens per response: baseline avg <n>, candidate avg <n>
- Exact-match (same wording): <m> / <n>

## Per-case results

### Case 1
**Channel:** #<channelName> (<author>)
**User input:**
> <message content>

**Baseline response:**
> <baseline reply>

**Candidate response:**
> <candidate reply>

---
### Case 2
...
```

## Error handling

| Failure | Behavior |
|---|---|
| `--candidate` path missing or invalid module | Exit 1 with `ERROR: candidate file not found at <path>` |
| Candidate module missing `systemPrompt` | Exit 1 with `ERROR: candidate <path> must export a personality module with a 'systemPrompt' field` |
| Candidate `systemPrompt` doesn't contain `{VOICE_INSTRUCTIONS}` | Warn but proceed (allowed) |
| OpenAI failure for one case | Log, mark that side `[OPENAI ERROR: <message>]`, continue |
| Zero eligible messages found | Exit 1 with `ERROR: no eligible messages found for last --days days[ in channel <id>]` |
| No voice profile in MongoDB | Warn, substitute `[no voice profile available]` into both sides, continue |
| Token estimate exceeds $1 | Refuse unless `PROMPT_TUNING_CONFIRM_COST=1` env is set |
| MongoService fails to connect | Exit 1 with the connection error verbatim |

No log truncation per project convention.

## The dev loop (intended workflow)

```bash
# Draft
cp personalities/channel-voice.js scripts/prompt-tuning/candidates/no-tech-bias-v1.js
$EDITOR scripts/prompt-tuning/candidates/no-tech-bias-v1.js

# Run
node scripts/prompt-tuning/run.js \
  --candidate scripts/prompt-tuning/candidates/no-tech-bias-v1.js \
  --n 20 --label no-tech-bias-v1

# Review
$EDITOR scripts/prompt-tuning/runs/2026-05-16-1432-no-tech-bias-v1.md

# Iterate: edit candidate, rerun (each run writes a new timestamped report)

# Promote (manual — forces an "I'm shipping this" decision):
# Copy candidate's systemPrompt value into personalities/channel-voice.js
# Commit, version bump, image build, deploy via standard flow.
```

## Gitignore

```
scripts/prompt-tuning/candidates/*
!scripts/prompt-tuning/candidates/.gitkeep
scripts/prompt-tuning/runs/*
!scripts/prompt-tuning/runs/.gitkeep
```

Candidates are unpolished drafts; runs include real user messages. Both stay local.

## Testing

No Jest tests. The script's value is in calling the real OpenAI API and the real MongoDB; tests would primarily verify the mocks and lose the point. Manual verification: run once against a small `--n 3`, eyeball the report, confirm sensible output.

## Doc touches outside the tool

- `docs/architecture.md` — add one line under "Open architectural follow-ups" linking to this tool and noting that the regen-pipeline hardening (synthesis prompt + topic-bleed filter + eval-gated rotation) is separate, deferred work.
- `features.md` — add a backlog entry under "Architectural follow-ups" with the same framing.

## Open questions

None for this scope. Voice-profile regen pipeline hardening is acknowledged as a separate follow-up.
