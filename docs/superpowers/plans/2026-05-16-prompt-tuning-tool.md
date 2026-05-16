# Local Prompt Tuning Tool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a local Node.js script under `scripts/prompt-tuning/` that pulls recent user messages from MongoDB, replays each against a candidate + baseline `systemPrompt` template, and emits a markdown side-by-side report.

**Architecture:** Standalone Node script reusing `services/MongoService.js` and `config/config.js`; no production code modified. Concurrency cap of 4 parallel OpenAI calls. Writes timestamped markdown reports to a gitignored `runs/` directory.

**Tech Stack:** Node.js, `openai` SDK, `mongodb` driver, no new dependencies beyond what's already in `package.json`.

**Spec:** `docs/superpowers/specs/2026-05-16-prompt-tuning-tool-design.md`

---

## File map

**New files:**
- `scripts/prompt-tuning/run.js`
- `scripts/prompt-tuning/README.md`
- `scripts/prompt-tuning/candidates/.gitkeep`
- `scripts/prompt-tuning/runs/.gitkeep`

**Modified files:**
- `.gitignore` (ignore `candidates/*` + `runs/*` with `.gitkeep` exceptions)
- `docs/architecture.md` (one-line follow-up note)
- `features.md` (backlog entry)

**No production code modified.** The script imports `services/MongoService.js` and `config/config.js`; it does not change them.

---

## Task 0: Branch + .gitkeep scaffolding

**Files:**
- Create: `scripts/prompt-tuning/candidates/.gitkeep`
- Create: `scripts/prompt-tuning/runs/.gitkeep`

- [ ] **Step 1: Verify branch**

The controller has already created `feat/prompt-tuning-tool` from main with the spec committed. Confirm:

```bash
git branch --show-current
```

Expected: `feat/prompt-tuning-tool`. If not, STOP and report.

- [ ] **Step 2: Create directory scaffolding**

```bash
mkdir -p scripts/prompt-tuning/candidates scripts/prompt-tuning/runs
touch scripts/prompt-tuning/candidates/.gitkeep scripts/prompt-tuning/runs/.gitkeep
```

- [ ] **Step 3: Commit**

```bash
git add scripts/prompt-tuning/candidates/.gitkeep scripts/prompt-tuning/runs/.gitkeep
git commit -m "feat(prompt-tuning): scaffold candidates/ and runs/ directories"
```

---

## Task 1: .gitignore entries

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Append gitignore entries**

Append to `.gitignore`:

```
# Prompt tuning tool — local-only drafts and reports
scripts/prompt-tuning/candidates/*
!scripts/prompt-tuning/candidates/.gitkeep
scripts/prompt-tuning/runs/*
!scripts/prompt-tuning/runs/.gitkeep
```

- [ ] **Step 2: Verify both directories are ignored except for .gitkeep**

```bash
echo "test" > scripts/prompt-tuning/candidates/test.js
echo "test" > scripts/prompt-tuning/runs/test.md
git check-ignore scripts/prompt-tuning/candidates/test.js scripts/prompt-tuning/runs/test.md
git check-ignore scripts/prompt-tuning/candidates/.gitkeep scripts/prompt-tuning/runs/.gitkeep
rm scripts/prompt-tuning/candidates/test.js scripts/prompt-tuning/runs/test.md
```

Expected: first `git check-ignore` prints both paths (ignored). Second prints nothing (NOT ignored, exits non-zero — that's fine, you can ignore the exit code via `git check-ignore ... || true`).

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore(gitignore): ignore prompt-tuning candidates and runs"
```

---

## Task 2: `run.js` — argument parsing + config load

**Files:**
- Create: `scripts/prompt-tuning/run.js`

- [ ] **Step 1: Create the script skeleton**

Create `scripts/prompt-tuning/run.js`:

```js
#!/usr/bin/env node
// scripts/prompt-tuning/run.js
// Local prompt tuning tool — see docs/superpowers/specs/2026-05-16-prompt-tuning-tool-design.md

const fs = require('fs');
const path = require('path');

const config = require('../../config/config');

function parseArgs(argv) {
  const args = { n: 20, days: 7, baseline: path.resolve(__dirname, '..', '..', 'personalities', 'channel-voice.js') };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    switch (flag) {
      case '--candidate':
        args.candidate = path.resolve(next);
        i++;
        break;
      case '--n':
        args.n = parseInt(next, 10);
        i++;
        break;
      case '--label':
        args.label = next;
        i++;
        break;
      case '--channel':
        args.channel = next;
        i++;
        break;
      case '--days':
        args.days = parseInt(next, 10);
        i++;
        break;
      case '--baseline':
        args.baseline = path.resolve(next);
        i++;
        break;
      case '--model':
        args.model = next;
        i++;
        break;
      case '--seed':
        args.seed = parseInt(next, 10);
        i++;
        break;
      case '--help':
      case '-h':
        printHelpAndExit();
        break;
      default:
        if (flag.startsWith('--')) {
          console.error(`ERROR: unknown flag ${flag}`);
          process.exit(1);
        }
    }
  }

  if (!args.candidate) {
    console.error('ERROR: --candidate <path> is required');
    process.exit(1);
  }
  if (!fs.existsSync(args.candidate)) {
    console.error(`ERROR: candidate file not found at ${args.candidate}`);
    process.exit(1);
  }
  if (!fs.existsSync(args.baseline)) {
    console.error(`ERROR: baseline file not found at ${args.baseline}`);
    process.exit(1);
  }
  if (!args.label) {
    args.label = path.basename(args.candidate, path.extname(args.candidate));
  }
  if (!args.model) {
    args.model = config.openai?.model || 'gpt-5-mini';
  }
  if (!Number.isFinite(args.n) || args.n <= 0) {
    console.error('ERROR: --n must be a positive integer');
    process.exit(1);
  }
  if (!Number.isFinite(args.days) || args.days <= 0) {
    console.error('ERROR: --days must be a positive integer');
    process.exit(1);
  }
  return args;
}

function printHelpAndExit() {
  console.log(`Usage: node scripts/prompt-tuning/run.js --candidate <path> [--n N] [--label LABEL] [--channel ID] [--days D] [--baseline PATH] [--model NAME] [--seed N]

Replays the last --n user messages from MongoDB against the candidate AND baseline
systemPrompt templates, then writes a markdown side-by-side comparison report.

See docs/superpowers/specs/2026-05-16-prompt-tuning-tool-design.md for the full spec.`);
  process.exit(0);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!config.openai?.apiKey) {
    console.error('ERROR: OPENAI_API_KEY is not set');
    process.exit(1);
  }
  if (!config.mongo?.uri) {
    console.error('ERROR: MONGO_URI is not set');
    process.exit(1);
  }
  console.log('Args:', { ...args, candidate: path.basename(args.candidate), baseline: path.basename(args.baseline) });
  // Task 3 onwards extend main()
}

main().catch((err) => {
  console.error('FATAL:', err.stack || err);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke-test the arg parsing**

```bash
node scripts/prompt-tuning/run.js --help
node scripts/prompt-tuning/run.js 2>&1 | head -1
echo "---"
echo "module.exports = { systemPrompt: 'test' };" > /tmp/test-candidate.js
node scripts/prompt-tuning/run.js --candidate /tmp/test-candidate.js --n 5
rm /tmp/test-candidate.js
```

Expected:
- `--help` prints usage
- No-arg run prints `ERROR: --candidate <path> is required`
- The third command prints `Args: { ... }` with all the parsed fields (OPENAI_API_KEY/MONGO_URI errors are fine — Task 3 wires those)

- [ ] **Step 3: Commit**

```bash
git add scripts/prompt-tuning/run.js
git commit -m "feat(prompt-tuning): arg parsing + config validation"
```

---

## Task 3: Load personality modules + voice profile

**Files:**
- Modify: `scripts/prompt-tuning/run.js`

- [ ] **Step 1: Add personality loader + voice profile loader**

In `scripts/prompt-tuning/run.js`, replace the `// Task 3 onwards extend main()` line with:

```js
  const candidateModule = require(args.candidate);
  const baselineModule = require(args.baseline);

  for (const [name, mod] of [['candidate', candidateModule], ['baseline', baselineModule]]) {
    if (!mod || typeof mod.systemPrompt !== 'string') {
      console.error(`ERROR: ${name} (${name === 'candidate' ? args.candidate : args.baseline}) must export a personality module with a 'systemPrompt' string field`);
      process.exit(1);
    }
    if (!mod.systemPrompt.includes('{VOICE_INSTRUCTIONS}')) {
      console.warn(`WARN: ${name} systemPrompt does not contain {VOICE_INSTRUCTIONS} — voice profile will not be substituted`);
    }
  }

  const MongoService = require('../../services/MongoService');
  const mongoService = new MongoService(config.mongo.uri);
  await mongoService.connect();

  let voiceProfile;
  try {
    const collection = mongoService.db.collection('voice_profiles');
    voiceProfile = await collection.findOne({}, { sort: { version: -1 } });
  } catch (err) {
    console.warn(`WARN: failed to load voice_profiles: ${err.message}`);
  }

  let voiceInstructions = '[no voice profile available]';
  let voiceProfileMeta = { version: null, generatedAt: null };
  if (voiceProfile?.voiceInstructions) {
    voiceInstructions = voiceProfile.voiceInstructions;
    voiceProfileMeta = { version: voiceProfile.version, generatedAt: voiceProfile.generatedAt };
    console.log(`Loaded voice profile v${voiceProfile.version} (generated ${voiceProfile.generatedAt})`);
  } else {
    console.warn('WARN: no voice profile found in MongoDB — using stub placeholder');
  }

  await mongoService.disconnect();
  console.log('voiceInstructions length:', voiceInstructions.length);
  // Task 4 onwards extend main()
```

- [ ] **Step 2: Smoke test (requires a populated MongoDB)**

If you have local access to the deployed MongoDB:

```bash
cp personalities/channel-voice.js /tmp/test-candidate.js
MONGO_URI="$(kubectl get secret discord-article-bot-secrets -n discord-article-bot -o jsonpath='{.data.MONGO_URI}' | base64 -d)" \
OPENAI_API_KEY=dummy \
node scripts/prompt-tuning/run.js --candidate /tmp/test-candidate.js --n 3
rm /tmp/test-candidate.js
```

Expected: prints `Args: { ... }`, then either `Loaded voice profile v<n>...` or `WARN: no voice profile found...`, then `voiceInstructions length: <n>`. If MongoDB connection fails entirely (network/secret issue), document the error and proceed — the next task's MongoDB query will surface it more cleanly.

If you don't have local MongoDB access, skip this smoke test and trust Task 5's end-to-end run will verify.

- [ ] **Step 3: Commit**

```bash
git add scripts/prompt-tuning/run.js
git commit -m "feat(prompt-tuning): load candidate/baseline modules and voice profile snapshot"
```

---

## Task 4: Sample input messages from MongoDB

**Files:**
- Modify: `scripts/prompt-tuning/run.js`

- [ ] **Step 1: Add the message sampling step**

**Schema confirmed before this plan was finalized** (from `bot.js:556` and `bot.js:801` call sites of `mongoService.recordChannelMessage`):
- Collection: `channel_messages` (NOT `messages`)
- Fields: `messageId`, `channelId`, `guildId`, `authorId`, `authorName`, `content`, `timestamp`, optional `executionIds` (string[], only on bot replies that triggered sandbox calls)
- No `isBot` field — filter bot replies via `authorId !== config.discord.clientId`

Replace the closing `await mongoService.disconnect();` line from Task 3 with the message-sampling step. The full updated section (after the voice profile load) becomes:

```js
  // Sample input messages
  const messagesCollection = mongoService.db.collection('channel_messages');
  const sinceMs = Date.now() - (args.days * 24 * 60 * 60 * 1000);
  const sinceDate = new Date(sinceMs);

  const botUserId = config.discord?.clientId;
  if (!botUserId) {
    console.warn('WARN: config.discord.clientId is not set — bot replies will not be filtered out of the sample');
  }

  const filter = {
    timestamp: { $gte: sinceDate },
    content: { $exists: true, $type: 'string', $not: /^\/\w/ } // reject slash-command invocations
  };
  if (botUserId) {
    filter.authorId = { $ne: botUserId };
  }
  if (args.channel) {
    filter.channelId = args.channel;
  }

  const sampled = await messagesCollection
    .find(filter, { projection: { content: 1, authorId: 1, authorName: 1, channelId: 1, timestamp: 1 } })
    .sort({ timestamp: -1 })
    .limit(args.n)
    .toArray();

  if (sampled.length === 0) {
    const where = args.channel ? ` in channel ${args.channel}` : '';
    console.error(`ERROR: no eligible messages found for last ${args.days} days${where}`);
    await mongoService.disconnect();
    process.exit(1);
  }

  // Reverse so report shows oldest first (more natural reading order)
  sampled.reverse();
  console.log(`Sampled ${sampled.length} messages`);

  await mongoService.disconnect();
  // Task 5 onwards extend main() — OpenAI replays + report writing
```

- [ ] **Step 2: Smoke test**

```bash
cp personalities/channel-voice.js /tmp/test-candidate.js
MONGO_URI="<your MONGO_URI>" \
OPENAI_API_KEY=dummy \
node scripts/prompt-tuning/run.js --candidate /tmp/test-candidate.js --n 5
rm /tmp/test-candidate.js
```

Expected: prints `Sampled 5 messages`. If you see `ERROR: no eligible messages found`, widen `--days` or relax the filter (after verifying the filter matches the actual schema).

- [ ] **Step 3: Commit**

```bash
git add scripts/prompt-tuning/run.js
git commit -m "feat(prompt-tuning): sample recent user messages from MongoDB"
```

---

## Task 5: OpenAI replays with concurrency cap

**Files:**
- Modify: `scripts/prompt-tuning/run.js`

- [ ] **Step 1: Add the replay loop**

In `scripts/prompt-tuning/run.js`, replace the `// Task 5 onwards extend main()` line with:

```js
  const OpenAI = require('openai');
  const openai = new OpenAI({ apiKey: config.openai.apiKey });

  const baselineSystem = baselineModule.systemPrompt.replace('{VOICE_INSTRUCTIONS}', voiceInstructions);
  const candidateSystem = candidateModule.systemPrompt.replace('{VOICE_INSTRUCTIONS}', voiceInstructions);

  async function callOnce(systemPrompt, userContent) {
    try {
      const params = {
        model: args.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ]
      };
      if (typeof args.seed === 'number') params.seed = args.seed;
      const resp = await openai.chat.completions.create(params);
      return {
        ok: true,
        text: resp.choices?.[0]?.message?.content || '',
        usage: resp.usage || null
      };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  // Batch with concurrency 4
  const BATCH = 4;
  const results = new Array(sampled.length);
  let completed = 0;
  for (let i = 0; i < sampled.length; i += BATCH) {
    const slice = sampled.slice(i, i + BATCH);
    const sliceResults = await Promise.all(slice.map(async (msg) => {
      const [base, cand] = await Promise.all([
        callOnce(baselineSystem, msg.content),
        callOnce(candidateSystem, msg.content)
      ]);
      return { msg, baseline: base, candidate: cand };
    }));
    sliceResults.forEach((r, j) => {
      results[i + j] = r;
      completed++;
      console.log(`[${completed}/${sampled.length}] case complete`);
    });
  }

  // Task 6 onwards extend main() — build + write the report
```

- [ ] **Step 2: Smoke test with --n 2 to verify OpenAI wiring**

```bash
cp personalities/channel-voice.js /tmp/test-candidate.js
MONGO_URI="<your MONGO_URI>" \
OPENAI_API_KEY="<your OPENAI_API_KEY>" \
node scripts/prompt-tuning/run.js --candidate /tmp/test-candidate.js --n 2
rm /tmp/test-candidate.js
```

Expected: prints `[1/2] case complete` and `[2/2] case complete`. Real OpenAI calls land; budget: ~$0.001 for n=2.

- [ ] **Step 3: Commit**

```bash
git add scripts/prompt-tuning/run.js
git commit -m "feat(prompt-tuning): OpenAI replay with concurrency cap of 4"
```

---

## Task 6: Build + write the markdown report

**Files:**
- Modify: `scripts/prompt-tuning/run.js`

- [ ] **Step 1: Add the report builder**

In `scripts/prompt-tuning/run.js`, replace the `// Task 6 onwards extend main() — build + write the report` line with:

```js
  // Compute diff summary
  const sumLen = (r) => (r.ok ? r.text.length : 0);
  const sumTokens = (r) => (r.ok && r.usage?.completion_tokens) || 0;
  const totalBaseLen = results.reduce((s, r) => s + sumLen(r.baseline), 0);
  const totalCandLen = results.reduce((s, r) => s + sumLen(r.candidate), 0);
  const totalBaseTokens = results.reduce((s, r) => s + sumTokens(r.baseline), 0);
  const totalCandTokens = results.reduce((s, r) => s + sumTokens(r.candidate), 0);
  const exactMatches = results.filter((r) => r.baseline.ok && r.candidate.ok && r.baseline.text === r.candidate.text).length;
  const avgBaseLen = Math.round(totalBaseLen / results.length);
  const avgCandLen = Math.round(totalCandLen / results.length);
  const lenDelta = avgBaseLen > 0 ? Math.round(((avgCandLen - avgBaseLen) / avgBaseLen) * 100) : 0;

  // Rough cost: model.pricing × tokens. Use a simple per-1M rate map.
  // gpt-5-mini placeholder rates; fall back to the same for unknown models.
  const RATES = {
    'gpt-5-mini': { in: 0.25, out: 2.0 },
    'gpt-4.1-mini': { in: 0.40, out: 1.60 },
    'gpt-4o-mini': { in: 0.15, out: 0.60 }
  };
  const rate = RATES[args.model] || RATES['gpt-4.1-mini'];
  const totalBaseIn = results.reduce((s, r) => s + ((r.baseline.ok && r.baseline.usage?.prompt_tokens) || 0), 0);
  const totalCandIn = results.reduce((s, r) => s + ((r.candidate.ok && r.candidate.usage?.prompt_tokens) || 0), 0);
  const baseCost = ((totalBaseIn * rate.in) + (totalBaseTokens * rate.out)) / 1_000_000;
  const candCost = ((totalCandIn * rate.in) + (totalCandTokens * rate.out)) / 1_000_000;

  // Build report
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const reportPath = path.join(__dirname, 'runs', `${stamp}-${args.label}.md`);

  const lines = [];
  lines.push(`# Prompt tuning run: ${args.label}`);
  lines.push('');
  lines.push(`**Date:** ${now.toISOString().replace('T', ' ').slice(0, 16)} UTC`);
  lines.push(`**Candidate:** \`${path.relative(path.join(__dirname, '..', '..'), args.candidate)}\``);
  lines.push(`**Baseline:** \`${path.relative(path.join(__dirname, '..', '..'), args.baseline)}\``);
  lines.push(`**Model:** ${args.model}`);
  if (voiceProfileMeta.version != null) {
    lines.push(`**Voice profile:** v${voiceProfileMeta.version} (generated ${voiceProfileMeta.generatedAt})`);
  } else {
    lines.push(`**Voice profile:** none (stub placeholder used)`);
  }
  const where = args.channel ? `, channel ${args.channel}` : '';
  lines.push(`**Sampled:** ${results.length} user messages from last ${args.days} days${where}`);
  lines.push(`**Seed:** ${args.seed != null ? args.seed : 'none'}`);
  lines.push(`**Cost:** $${baseCost.toFixed(4)} baseline + $${candCost.toFixed(4)} candidate = $${(baseCost + candCost).toFixed(4)} total`);
  lines.push('');
  lines.push('## Diff summary');
  lines.push(`- Avg response length: baseline ${avgBaseLen} chars, candidate ${avgCandLen} chars (${lenDelta >= 0 ? '+' : ''}${lenDelta}%)`);
  lines.push(`- Tokens per response: baseline avg ${Math.round(totalBaseTokens / results.length)}, candidate avg ${Math.round(totalCandTokens / results.length)}`);
  lines.push(`- Exact-match (same wording): ${exactMatches} / ${results.length}`);
  lines.push('');
  lines.push('## Per-case results');
  lines.push('');

  results.forEach((r, idx) => {
    const channelLabel = r.msg.channelId || 'unknown-channel';
    const author = r.msg.authorName || r.msg.authorId || 'unknown';
    lines.push(`### Case ${idx + 1}`);
    lines.push(`**Channel:** #${channelLabel} (${author})`);
    lines.push('**User input:**');
    r.msg.content.split('\n').forEach((line) => lines.push(`> ${line}`));
    lines.push('');
    lines.push('**Baseline response:**');
    const baselineText = r.baseline.ok ? r.baseline.text : `[OPENAI ERROR: ${r.baseline.error}]`;
    baselineText.split('\n').forEach((line) => lines.push(`> ${line}`));
    lines.push('');
    lines.push('**Candidate response:**');
    const candidateText = r.candidate.ok ? r.candidate.text : `[OPENAI ERROR: ${r.candidate.error}]`;
    candidateText.split('\n').forEach((line) => lines.push(`> ${line}`));
    lines.push('');
    lines.push('---');
  });

  fs.writeFileSync(reportPath, lines.join('\n'));
  console.log(`\nReport written: ${reportPath}`);
  console.log(`Total cost: $${(baseCost + candCost).toFixed(4)}`);
```

- [ ] **Step 2: End-to-end smoke test**

```bash
cp personalities/channel-voice.js /tmp/test-candidate.js
MONGO_URI="<your MONGO_URI>" \
OPENAI_API_KEY="<your OPENAI_API_KEY>" \
node scripts/prompt-tuning/run.js --candidate /tmp/test-candidate.js --n 3 --label smoke-test
rm /tmp/test-candidate.js
ls -la scripts/prompt-tuning/runs/
```

Expected: a markdown file with 3 case blocks. Open it to confirm content looks right.

If the report renders correctly, delete the smoke-test report:

```bash
rm scripts/prompt-tuning/runs/*smoke-test.md
```

(The `runs/` directory is gitignored, so the file doesn't need cleanup for commit, but tidying is good hygiene.)

- [ ] **Step 3: Commit**

```bash
git add scripts/prompt-tuning/run.js
git commit -m "feat(prompt-tuning): build and write markdown side-by-side report"
```

---

## Task 7: Cost guardrail

**Files:**
- Modify: `scripts/prompt-tuning/run.js`

- [ ] **Step 1: Add the pre-flight cost estimate + confirmation gate**

In `scripts/prompt-tuning/run.js`, after the `Sampled N messages` log line but BEFORE the `OpenAI` require, insert:

```js
  // Pre-flight cost estimate (rough): assume ~300 tokens in (system) + ~50 tokens out per call
  const ESTIMATED_IN_PER_CALL = 600;   // system+user; conservative
  const ESTIMATED_OUT_PER_CALL = 100;  // response; conservative
  const RATES_PRE = {
    'gpt-5-mini': { in: 0.25, out: 2.0 },
    'gpt-4.1-mini': { in: 0.40, out: 1.60 },
    'gpt-4o-mini': { in: 0.15, out: 0.60 }
  };
  const rate_pre = RATES_PRE[args.model] || RATES_PRE['gpt-4.1-mini'];
  const callsTotal = sampled.length * 2;
  const estCost = ((ESTIMATED_IN_PER_CALL * rate_pre.in) + (ESTIMATED_OUT_PER_CALL * rate_pre.out)) / 1_000_000 * callsTotal;
  console.log(`Estimated cost: $${estCost.toFixed(4)} for ${callsTotal} OpenAI calls`);

  if (estCost > 1 && process.env.PROMPT_TUNING_CONFIRM_COST !== '1') {
    console.error(`ERROR: estimated cost $${estCost.toFixed(4)} exceeds $1 guardrail. Re-run with PROMPT_TUNING_CONFIRM_COST=1 to proceed.`);
    process.exit(1);
  }
```

- [ ] **Step 2: Smoke test the gate**

Trigger the guardrail with a hypothetical large run:

```bash
cp personalities/channel-voice.js /tmp/test-candidate.js
MONGO_URI="<your MONGO_URI>" \
OPENAI_API_KEY="<your OPENAI_API_KEY>" \
node scripts/prompt-tuning/run.js --candidate /tmp/test-candidate.js --n 5000 2>&1 | tail -3
rm /tmp/test-candidate.js
```

Expected: `ERROR: estimated cost $... exceeds $1 guardrail. Re-run with PROMPT_TUNING_CONFIRM_COST=1 to proceed.` Note: the sample query will likely return fewer than 5000 messages (so it might actually succeed if the corpus is small) — adjust `--n` upward or `--days` larger if you need to force-trigger the gate, OR mock by manually editing the threshold for one test run.

- [ ] **Step 3: Commit**

```bash
git add scripts/prompt-tuning/run.js
git commit -m "feat(prompt-tuning): cost guardrail at \$1 with confirm-env-var override"
```

---

## Task 8: README

**Files:**
- Create: `scripts/prompt-tuning/README.md`

- [ ] **Step 1: Write the README**

Create `scripts/prompt-tuning/README.md`:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add scripts/prompt-tuning/README.md
git commit -m "docs(prompt-tuning): add workflow README"
```

---

## Task 9: Architecture + features.md follow-up notes

**Files:**
- Modify: `docs/architecture.md`
- Modify: `features.md`

- [ ] **Step 1: Add the architecture follow-up note**

In `docs/architecture.md`, find the `## Open architectural follow-ups` section (near the end). Append a new bullet:

```markdown
- **Voice-profile regen-pipeline hardening.** The local prompt-tuning tool at `scripts/prompt-tuning/` (see [`scripts/prompt-tuning/README.md`](../scripts/prompt-tuning/README.md)) lets you iterate on the `personalities/channel-voice.js` template offline and commit when satisfied. The longer-term regen-pipeline improvements (synthesis prompt tightening, topic-bleed filter on the auto-generated voice profile, eval-gated rotation) are still outstanding — addressed when we want continuous quality rather than periodic manual tuning.
```

- [ ] **Step 2: Add the features.md backlog entry**

In `features.md`, find the `### Architectural follow-ups` section (under "Backlog / planned"). Append a new bullet:

```markdown
- [ ] **Voice-profile regen-pipeline hardening.** The local prompt-tuning tool at `scripts/prompt-tuning/` ships for offline iteration on `personalities/channel-voice.js`. Pipeline-side improvements (synthesis prompt updates, topic-bleed filter, eval-gated rotation) remain TODO — addressed when we want continuous quality rather than periodic manual tuning.
```

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md features.md
git commit -m "docs: cross-reference prompt-tuning tool from architecture + features"
```

---

## Task 10: Push branch and open PR

**Files:** none

- [ ] **Step 1: Confirm full state**

```bash
git log --oneline main..HEAD
git status --short
```

Expected: ~10 commits on the branch, working tree clean.

- [ ] **Step 2: Push**

```bash
git push -u origin feat/prompt-tuning-tool
```

- [ ] **Step 3: Open PR**

```bash
gh pr create --title "feat(prompt-tuning): local tool for iterating on channel-voice systemPrompt" --body "$(cat <<'EOF'
## Summary
New local dev tool under `scripts/prompt-tuning/` that lets the developer iterate on the `personalities/channel-voice.js` `systemPrompt` template offline. Pulls recent user messages from MongoDB, replays each against a candidate AND the current production baseline, emits a markdown side-by-side report. No production code is touched; no runtime feature; no deploy.

## Why
Chat responses have been over-indexing on developer topics (github, .net) when the conversation hasn't mentioned them. Likely root cause: the auto-generated `voice_instructions` field bakes dev-flavored vocabulary into the system prompt. Short-term fix: tighten the static personality template by hand. This tool makes the short-term iteration loop fast and reproducible.

The longer-term plan is to harden the voice-profile *regeneration* pipeline itself. That's tracked separately in `docs/architecture.md` and `features.md` and is out of scope here.

## Spec + plan
- Spec: `docs/superpowers/specs/2026-05-16-prompt-tuning-tool-design.md`
- Plan: `docs/superpowers/plans/2026-05-16-prompt-tuning-tool.md`

## What ships
- `scripts/prompt-tuning/run.js` — CLI tool (arg parsing, MongoDB sampling, OpenAI replay with concurrency 4, markdown report)
- `scripts/prompt-tuning/README.md` — workflow guide
- `scripts/prompt-tuning/candidates/.gitkeep` + `runs/.gitkeep` — directory scaffolding (contents gitignored)
- `.gitignore` — ignore drafts and reports
- `docs/architecture.md` + `features.md` — one-line cross-references each

## Workflow
```bash
cp personalities/channel-voice.js scripts/prompt-tuning/candidates/no-tech-bias-v1.js
$EDITOR scripts/prompt-tuning/candidates/no-tech-bias-v1.js
node scripts/prompt-tuning/run.js --candidate scripts/prompt-tuning/candidates/no-tech-bias-v1.js --n 20 --label no-tech-bias-v1
$EDITOR scripts/prompt-tuning/runs/<timestamp>-no-tech-bias-v1.md
# If happy → copy candidate's systemPrompt value into personalities/channel-voice.js, commit, ship normally
```

## Test plan
- [x] Argument parsing covers all flags + error paths
- [x] Voice profile snapshot loads from MongoDB `voice_profiles` collection
- [x] Recent user messages sampled (excludes bot replies + slash commands)
- [x] Parallel OpenAI calls capped at 4 concurrent
- [x] Markdown report written to `scripts/prompt-tuning/runs/<timestamp>-<label>.md`
- [x] Cost guardrail rejects runs estimated >$1 unless env override set
- [x] End-to-end smoke run produced a sensible report
- [ ] No production code modified — verified by diff
- [ ] No deploy needed

## Out of scope (follow-ups)
- Tuning `VoiceProfileService`'s `ANALYSIS_PROMPT` and `SYNTHESIS_PROMPT`
- Automated scoring of candidate vs. baseline
- Including the full `ChatService` chain in the replay (mem0, channel context, agent)
- Continuous integration / CI gate
- Slash-command or admin-UI exposure

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the implementer

- **No production code touched.** If any task tempts you to modify `services/`, `personalities/`, `commands/`, `bot.js`, or `config/config.js`, STOP — that's out of scope.
- **No new npm dependencies.** Everything the script needs (`openai`, `mongodb` via `MongoService`) is already in `package.json`.
- **MongoDB field-name verification.** Task 4 includes a "verify field names" note. If `messages` collection uses different keys than the plan assumes (e.g., `userId` vs `author`, `text` vs `content`), adjust the projection + filter accordingly. The plan favors the common names — verify with `mongoService.db.collection('messages').findOne()` if uncertain.
- **No tests.** The tool calls real OpenAI; mocking it would mostly test the mocks. Manual smoke verification is the gate.
- **No deploy.** This is dev-console tooling. No version bump, no image build, no kubectl. After PR merge, `git pull origin main` is the entire "deploy."
