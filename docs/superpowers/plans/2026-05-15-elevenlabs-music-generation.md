# ElevenLabs Music Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a parallel A/B-comparison music-generation surface via ElevenLabs' `POST /v1/music` (Compose Music), exposed as `/elevenmusic` alongside the existing `/musicgen` (Lyria) command.

**Architecture:** New `services/ElevenLabsMusicService.js` (modeled on `LyriaService.js`) + `commands/slash/ElevenmusicCommand.js`. Service wraps the `@elevenlabs/elevenlabs-js` SDK's `.music.compose()` method, transparently switching between `prompt` mode and `composition_plan` mode when lyrics are provided. Returns `{success, buffer, mimeType, error}` matching Lyria's contract for swappability. Wired into `bot.js` and `scripts/registerCommands.js` next to the existing media-gen services.

**Tech Stack:** Node.js, discord.js v14, Jest v30, `@elevenlabs/elevenlabs-js` SDK (new dependency), existing logger/tracing utilities.

**Spec:** `docs/superpowers/specs/2026-05-15-elevenlabs-music-generation-design.md`

---

## File map

**New files:**
- `services/ElevenLabsMusicService.js`
- `commands/slash/ElevenmusicCommand.js`
- `__tests__/services/ElevenLabsMusicService.test.js`

**Modified files:**
- `package.json` (add `@elevenlabs/elevenlabs-js`)
- `config/config.js` (add `elevenlabs` block)
- `services/CostService.js` (add `'elevenlabs-music-v1'` to `mediaPricing` map)
- `__tests__/services/CostService.test.js` (one new test for the new pricing entry)
- `commands/slash/index.js` (export `ElevenmusicSlashCommand`)
- `bot.js` (instantiate `ElevenLabsMusicService`; register `ElevenmusicSlashCommand`)
- `scripts/registerCommands.js` (conditionally include `ElevenmusicSlashCommand`)
- `k8s/overlays/deployed/configmap.yaml` (gitignored — local edit only)
- `k8s/overlays/deployed/secret.yaml` (gitignored — local edit only)
- `features.md`, `README.md`

---

## PR #78 dependency check

This plan depends on the `scripts/registerCommands.js` global-and-guild fix from PR #78. Before Task 0:

```bash
gh pr view 78 --json state -q '.state'
```

- If `MERGED`: branch off main as normal; Task 10 just adds the `MusicgenSlashCommand`-style block.
- If still `OPEN`: branch off `main` anyway. Task 10's `scripts/registerCommands.js` change MUST also include the dual-target (global + test guild) registration logic that PR #78 introduces. Task 10 has an explicit note on the merge scenario.

---

## Task 0: Branch + SDK install + shape spike

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1: Create feature branch**

```bash
git checkout main && git pull origin main
git checkout -b feat/elevenlabs-music-generation
```

- [ ] **Step 2: Install `@elevenlabs/elevenlabs-js`**

```bash
npm install @elevenlabs/elevenlabs-js
```

Expected: `@elevenlabs/elevenlabs-js` appears in `dependencies` of `package.json`. The install must succeed WITHOUT `--legacy-peer-deps`. If npm warns about peer-dep conflicts, STOP and report — do not mask the conflict with the global flag (see CVE PR #76 for the rationale).

- [ ] **Step 3: Confirm SDK shape from type declarations**

The local environment does NOT have `ELEVENLABS_API_KEY` set, so don't run a live spike. Verify the SDK exposes the expected surface statically:

```bash
node -e "const e = require('@elevenlabs/elevenlabs-js'); console.log(Object.keys(e))"
grep -rn "class ElevenLabsClient\|interface .*Options" node_modules/@elevenlabs/elevenlabs-js/dist/*.d.ts 2>/dev/null | head -10
grep -rn "music\b\|compose" node_modules/@elevenlabs/elevenlabs-js/dist/**/music*.d.ts 2>/dev/null | head -15
grep -rn "MusicCompositionPlan\|composition_plan\|music_length_ms" node_modules/@elevenlabs/elevenlabs-js/dist/**/*.d.ts 2>/dev/null | head -15
```

Report what the type declarations show for:
- `ElevenLabsClient` constructor signature (does it take `{ apiKey }`?)
- `.music.compose()` signature — request body fields, return type (Buffer / Readable / Response wrapper?)
- Whether `music_length_ms`, `composition_plan`, and `force_instrumental` are declared as request fields
- Field-name casing in the SDK (some SDKs use camelCase: `musicLengthMs` / `compositionPlan` / `forceInstrumental` even though the docs show snake_case)

**If the SDK shape differs materially** (e.g. `.music.compose` doesn't exist, or response is a job-handle requiring polling), STOP and report BLOCKED — the controller needs to revise Tasks 4–5 before continuing.

The spec's data flow uses snake_case field names from the HTTP docs. If the SDK uses camelCase, Tasks 4 and 5 will need that translation — note it in the report so the controller can adjust the plan inline before Task 4.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @elevenlabs/elevenlabs-js SDK for ElevenLabs music generation"
```

---

## Task 1: Extend CostService with the new model entry

**Files:** `services/CostService.js`, `__tests__/services/CostService.test.js`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/services/CostService.test.js`:

```js
describe('CostService.recordMediaGen - ElevenLabs', () => {
  let svc;
  beforeEach(() => {
    svc = new CostService();
  });

  test('records elevenlabs-music-v1 successfully', () => {
    const result = svc.recordMediaGen('elevenlabs-music-v1', { id: 'u1', tag: 'alice' });
    expect(result.success).toBe(true);
    expect(result.cost).toBeCloseTo(0.10, 5);
    expect(svc.cumulative.media.byModel['elevenlabs-music-v1']).toBeCloseTo(0.10, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPatterns="CostService"
```

Expected: FAIL — `"Unknown model for media generation cost: elevenlabs-music-v1"`.

- [ ] **Step 3: Add the new entry to `mediaPricing`**

Edit `services/CostService.js`. Find the existing `mediaPricing` map (currently a single entry for `'lyria-3-pro-preview'`) and add a sibling entry:

```js
    this.mediaPricing = {
      'lyria-3-pro-preview': 0.06,
      'elevenlabs-music-v1': 0.10
    };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPatterns="CostService"
```

Expected: PASS — all CostService tests green including the new one.

- [ ] **Step 5: Run the full suite**

```bash
npm test 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add services/CostService.js __tests__/services/CostService.test.js
git commit -m "feat(cost): add elevenlabs-music-v1 to mediaPricing"
```

---

## Task 2: Add `elevenlabs` config block

**Files:** `config/config.js`

- [ ] **Step 1: Add the config block**

In `config/config.js`, immediately after the `lyria: { ... }` block (added in the Lyria PR), add:

```js
  // ElevenLabs - music generation via @elevenlabs/elevenlabs-js
  elevenlabs: {
    enabled: process.env.ELEVENMUSIC_ENABLED === 'true',
    apiKey: process.env.ELEVENLABS_API_KEY || '',
    model: process.env.ELEVENLABS_MUSIC_MODEL || 'music_v1',
    defaultDurationSeconds: parseInt(process.env.ELEVENLABS_DEFAULT_DURATION_SECONDS || '90', 10),
    cooldownSeconds: parseInt(process.env.ELEVENLABS_COOLDOWN_SECONDS || '60', 10),
    perCallCostUsd: parseFloat(process.env.ELEVENLABS_PER_CALL_COST_USD || '0.10')
  },
```

Match the existing 2-space indentation and trailing-comma style.

- [ ] **Step 2: Verify config loads**

```bash
node -e "console.log(require('./config/config').elevenlabs)"
```

Expected: object printed with `enabled: false` (no env vars set locally) and the documented defaults.

- [ ] **Step 3: Commit**

```bash
git add config/config.js
git commit -m "feat(config): add elevenlabs block for music generation"
```

---

## Task 3: ElevenLabsMusicService — constructor + enabled check (TDD)

**Files:** `services/ElevenLabsMusicService.js`, `__tests__/services/ElevenLabsMusicService.test.js`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/services/ElevenLabsMusicService.test.js`:

```js
// Mock @elevenlabs/elevenlabs-js before requiring the service
jest.mock('@elevenlabs/elevenlabs-js', () => ({
  ElevenLabsClient: jest.fn().mockImplementation(() => ({
    music: { compose: jest.fn() }
  }))
}));

const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const ElevenLabsMusicService = require('../../services/ElevenLabsMusicService');

function makeConfig(overrides = {}) {
  return {
    elevenlabs: {
      enabled: true,
      apiKey: 'test-key',
      model: 'music_v1',
      defaultDurationSeconds: 90,
      cooldownSeconds: 60,
      perCallCostUsd: 0.10,
      ...overrides
    }
  };
}

describe('ElevenLabsMusicService constructor', () => {
  beforeEach(() => {
    ElevenLabsClient.mockReset();
    ElevenLabsClient.mockImplementation(() => ({
      music: { composeDetailed: jest.fn() }
    }));
  });

  test('initializes the ElevenLabs client when enabled', () => {
    const svc = new ElevenLabsMusicService(makeConfig(), { recordMediaGen: jest.fn(), mediaPricing: {} });
    expect(svc.isEnabled()).toBe(true);
    expect(ElevenLabsClient).toHaveBeenCalledWith({ apiKey: 'test-key' });
  });

  test('is disabled when config.elevenlabs.enabled is false', () => {
    const svc = new ElevenLabsMusicService(makeConfig({ enabled: false }), { recordMediaGen: jest.fn() });
    expect(svc.isEnabled()).toBe(false);
    expect(ElevenLabsClient).not.toHaveBeenCalled();
  });

  test('is disabled when apiKey is missing', () => {
    const svc = new ElevenLabsMusicService(makeConfig({ apiKey: '' }), { recordMediaGen: jest.fn() });
    expect(svc.isEnabled()).toBe(false);
    expect(ElevenLabsClient).not.toHaveBeenCalled();
  });

  test('applies perCallCostUsd override into costService.mediaPricing', () => {
    const costService = { recordMediaGen: jest.fn(), mediaPricing: { 'elevenlabs-music-v1': 0.10 } };
    new ElevenLabsMusicService(makeConfig({ perCallCostUsd: 0.25 }), costService);
    expect(costService.mediaPricing['elevenlabs-music-v1']).toBeCloseTo(0.25, 5);
  });

  test('does not crash when costService has no mediaPricing (defensive)', () => {
    const noPricing = { recordMediaGen: jest.fn() };
    expect(() => new ElevenLabsMusicService(makeConfig({ perCallCostUsd: 0.5 }), noPricing)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm test -- --testPathPatterns="ElevenLabsMusicService"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the service skeleton**

Create `services/ElevenLabsMusicService.js`:

```js
// services/ElevenLabsMusicService.js
// TODO(media-gen-refactor): Imagen/Veo/Lyria/ElevenLabs duplicate noticeable
// plumbing (enabled checks, error shaping, attachment handling, per-call cost
// override). Consider extracting a MediaGenBase once these four are stable.
// See docs/superpowers/specs/2026-05-15-elevenlabs-music-generation-design.md ("Approach B").

const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const logger = require('../logger');

class ElevenLabsMusicService {
  // Unlike ImagenService (which throws on disabled state), ElevenLabsMusicService
  // constructs successfully when disabled and exposes isEnabled() so callers
  // can check runtime availability without try/catch. Mirrors LyriaService.
  constructor(config, costService) {
    this.config = config;
    this.costService = costService;
    this.client = null;

    const cfg = config?.elevenlabs || {};
    if (!cfg.enabled) {
      logger.info('ElevenLabsMusicService disabled by config');
      return;
    }
    if (!cfg.apiKey) {
      logger.warn('ElevenLabsMusicService disabled: missing ELEVENLABS_API_KEY');
      return;
    }

    this.client = new ElevenLabsClient({ apiKey: cfg.apiKey });
    logger.info(`ElevenLabsMusicService enabled - model: ${cfg.model}`);

    // Apply the env-driven per-call cost override into this CostService instance's
    // pricing map so ELEVENLABS_PER_CALL_COST_USD actually takes effect at runtime.
    // The Approach B refactor will hoist CostService into bot.js and expose a
    // proper setter API.
    if (this.costService?.mediaPricing && typeof cfg.perCallCostUsd === 'number' && !isNaN(cfg.perCallCostUsd)) {
      this.costService.mediaPricing['elevenlabs-music-v1'] = cfg.perCallCostUsd;
    }
  }

  isEnabled() {
    return this.client !== null;
  }
}

module.exports = ElevenLabsMusicService;
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test -- --testPathPatterns="ElevenLabsMusicService"
```

Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add services/ElevenLabsMusicService.js __tests__/services/ElevenLabsMusicService.test.js
git commit -m "feat(elevenlabs): scaffold ElevenLabsMusicService with enabled/disabled checks"
```

---

## Task 4: `generateMusic()` happy path — prompt mode (TDD)

**Files:** `services/ElevenLabsMusicService.js`, `__tests__/services/ElevenLabsMusicService.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/services/ElevenLabsMusicService.test.js`:

```js
describe('ElevenLabsMusicService.generateMusic - prompt mode happy path', () => {
  let svc;
  let composeDetailed;
  let costService;

  beforeEach(() => {
    ElevenLabsClient.mockReset();
    composeDetailed = jest.fn().mockResolvedValue({ audio: Buffer.from('FAKE_MP3') });
    ElevenLabsClient.mockImplementation(() => ({ music: { composeDetailed } }));
    costService = { recordMediaGen: jest.fn().mockReturnValue({ success: true, cost: 0.10 }), mediaPricing: {} };
    svc = new ElevenLabsMusicService(makeConfig(), costService);
  });

  test('returns audio buffer on success and records cost', async () => {
    const result = await svc.generateMusic('upbeat lo-fi', {}, { id: 'u1', tag: 'alice' });
    expect(result.success).toBe(true);
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.toString()).toBe('FAKE_MP3');
    expect(result.mimeType).toBe('audio/mpeg');
    expect(costService.recordMediaGen).toHaveBeenCalledWith('elevenlabs-music-v1', { id: 'u1', tag: 'alice' });
  });

  test('forwards prompt, musicLengthMs, modelId, forceInstrumental (SDK uses camelCase)', async () => {
    await svc.generateMusic('a slow piano ballad', { durationSeconds: 30, instrumental: true }, { id: 'u1' });
    expect(composeDetailed).toHaveBeenCalledTimes(1);
    const call = composeDetailed.mock.calls[0][0];
    expect(call.prompt).toBe('a slow piano ballad');
    expect(call.musicLengthMs).toBe(30000);
    expect(call.modelId).toBe('music_v1');
    expect(call.forceInstrumental).toBe(true);
    expect(call.compositionPlan).toBeUndefined();
  });

  test('defaults durationSeconds to config.elevenlabs.defaultDurationSeconds (90)', async () => {
    await svc.generateMusic('jazz', {}, { id: 'u1' });
    const call = composeDetailed.mock.calls[0][0];
    expect(call.musicLengthMs).toBe(90000);
  });

  test('defaults forceInstrumental to false', async () => {
    await svc.generateMusic('jazz', {}, { id: 'u1' });
    const call = composeDetailed.mock.calls[0][0];
    expect(call.forceInstrumental).toBe(false);
  });

  test('returns success:false when service is disabled', async () => {
    const disabled = new ElevenLabsMusicService(makeConfig({ enabled: false }), costService);
    const result = await disabled.generateMusic('foo', {}, { id: 'u1' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not enabled/i);
    expect(costService.recordMediaGen).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm test -- --testPathPatterns="ElevenLabsMusicService"
```

Expected: FAIL — `generateMusic is not a function`.

- [ ] **Step 3: Implement `generateMusic` (prompt-mode minimal)**

Add to `services/ElevenLabsMusicService.js`, inside the class after `isEnabled()`:

```js
  // options: { lyrics?, durationSeconds?, instrumental? }
  // Uses composeDetailed() (not compose()) because composeDetailed returns
  // { audio: Buffer, json, filename } directly. The raw compose() returns a
  // ReadableStream<Uint8Array> that would need a coercion helper. The SDK's
  // detailed variant does the buffering for us.
  async generateMusic(prompt, options = {}, user = null) {
    if (!this.isEnabled()) {
      return { success: false, error: 'Music generation is not enabled on this bot.' };
    }

    const durationSeconds = options.durationSeconds || this.config.elevenlabs.defaultDurationSeconds;
    const forceInstrumental = options.instrumental === true;

    // NOTE: The @elevenlabs/elevenlabs-js SDK uses camelCase for all request
    // fields, NOT the snake_case shown in the REST docs.
    const request = {
      prompt,
      musicLengthMs: durationSeconds * 1000,
      modelId: this.config.elevenlabs.model,
      forceInstrumental: forceInstrumental
    };

    let response;
    try {
      response = await this.client.music.composeDetailed(request);
    } catch (err) {
      logger.error('ElevenLabs composeDetailed failed', { error: err });
      return { success: false, error: `Music generation failed: ${err.message}` };
    }

    const buffer = response?.audio;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      return { success: false, error: 'Music generation completed but no audio data was returned.' };
    }

    this.costService?.recordMediaGen('elevenlabs-music-v1', user);

    return { success: true, buffer, mimeType: 'audio/mpeg' };
  }
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test -- --testPathPatterns="ElevenLabsMusicService"
```

Expected: PASS — all 10 tests green (5 constructor + 5 prompt-mode).

- [ ] **Step 5: Commit**

```bash
git add services/ElevenLabsMusicService.js __tests__/services/ElevenLabsMusicService.test.js
git commit -m "feat(elevenlabs): implement generateMusic prompt-mode happy path"
```

---

## Task 5: `generateMusic()` composition_plan mode for lyrics (TDD)

**Files:** `services/ElevenLabsMusicService.js`, `__tests__/services/ElevenLabsMusicService.test.js`

- [ ] **Step 1: Write the failing tests**

Append:

```js
describe('ElevenLabsMusicService.generateMusic - compositionPlan mode (lyrics)', () => {
  let svc;
  let composeDetailed;

  beforeEach(() => {
    ElevenLabsClient.mockReset();
    composeDetailed = jest.fn().mockResolvedValue({ audio: Buffer.from('FAKE_MP3') });
    ElevenLabsClient.mockImplementation(() => ({ music: { composeDetailed } }));
    svc = new ElevenLabsMusicService(makeConfig(), { recordMediaGen: jest.fn(), mediaPricing: {} });
  });

  test('switches to compositionPlan when lyrics provided', async () => {
    await svc.generateMusic('upbeat jazz', { lyrics: 'first line\nsecond line', durationSeconds: 30 }, { id: 'u1' });
    const call = composeDetailed.mock.calls[0][0];
    expect(call.prompt).toBeUndefined();
    expect(call.musicLengthMs).toBeUndefined();
    expect(call.compositionPlan).toBeDefined();
    expect(call.compositionPlan.sections).toHaveLength(1);
    expect(call.compositionPlan.sections[0]).toMatchObject({
      sectionName: 'main',
      positiveLocalStyles: ['upbeat jazz'],
      negativeLocalStyles: [],
      durationMs: 30000
    });
    expect(call.compositionPlan.sections[0].lines).toEqual(['first line', 'second line']);
    expect(call.modelId).toBe('music_v1');
  });

  test('does not pass forceInstrumental in compositionPlan mode (API contradiction)', async () => {
    await svc.generateMusic('jazz', { lyrics: 'hello', instrumental: true }, { id: 'u1' });
    const call = composeDetailed.mock.calls[0][0];
    expect(call.forceInstrumental).toBeUndefined();
  });

  test('logs warning when instrumental=true is combined with lyrics', async () => {
    const warnSpy = jest.spyOn(require('../../logger'), 'warn');
    await svc.generateMusic('jazz', { lyrics: 'hello', instrumental: true }, { id: 'u1' });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/ignoring instrumental=true/i));
    warnSpy.mockRestore();
  });

  test('uses default duration in compositionPlan mode too', async () => {
    await svc.generateMusic('jazz', { lyrics: 'hello' }, { id: 'u1' });
    const call = composeDetailed.mock.calls[0][0];
    expect(call.compositionPlan.sections[0].durationMs).toBe(90000);
  });

  test('empty lyrics string falls back to prompt mode', async () => {
    await svc.generateMusic('jazz', { lyrics: '' }, { id: 'u1' });
    const call = composeDetailed.mock.calls[0][0];
    expect(call.prompt).toBe('jazz');
    expect(call.compositionPlan).toBeUndefined();
  });

  test('whitespace-only lyrics falls back to prompt mode', async () => {
    await svc.generateMusic('jazz', { lyrics: '   \n  ' }, { id: 'u1' });
    const call = composeDetailed.mock.calls[0][0];
    expect(call.prompt).toBe('jazz');
    expect(call.compositionPlan).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm test -- --testPathPatterns="ElevenLabsMusicService"
```

Expected: FAIL — lyrics path not implemented; composition_plan not built.

- [ ] **Step 3: Extend `generateMusic` with the composition_plan branch**

Replace the body of `generateMusic` between the disabled-guard and the try/catch with this expanded version:

```js
    if (!this.isEnabled()) {
      return { success: false, error: 'Music generation is not enabled on this bot.' };
    }

    const durationSeconds = options.durationSeconds || this.config.elevenlabs.defaultDurationSeconds;
    const forceInstrumental = options.instrumental === true;
    const lyrics = (typeof options.lyrics === 'string') ? options.lyrics.trim() : '';

    let request;
    if (lyrics.length > 0) {
      // ElevenLabs' `forceInstrumental` is prompt-mode-only and would contradict the
      // presence of lyrics anyway. Drop it with a warn-log when both are provided.
      if (forceInstrumental) {
        logger.warn('elevenmusic: ignoring instrumental=true because lyrics were provided');
      }
      request = {
        compositionPlan: {
          sections: [{
            sectionName: 'main',
            positiveLocalStyles: [prompt],
            negativeLocalStyles: [],
            durationMs: durationSeconds * 1000,
            lines: this._splitLyricsIntoMaxLines(lyrics, 200)
          }]
        },
        modelId: this.config.elevenlabs.model
      };
    } else {
      request = {
        prompt,
        musicLengthMs: durationSeconds * 1000,
        modelId: this.config.elevenlabs.model,
        forceInstrumental: forceInstrumental
      };
    }

    let response;
    try {
      response = await this.client.music.composeDetailed(request);
    } catch (err) {
      logger.error('ElevenLabs composeDetailed failed', { error: err });
      return { success: false, error: `Music generation failed: ${err.message}` };
    }
```

Add a stub for `_splitLyricsIntoMaxLines` (Task 6 implements the real one):

```js
  _splitLyricsIntoMaxLines(lyrics, maxLen) {
    return lyrics.split('\n').filter((l) => l.length > 0);
  }
```

(Task 6's tests will exercise the wrapping behavior properly; this stub passes the Task 5 tests because the test inputs all use short lines.)

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test -- --testPathPatterns="ElevenLabsMusicService"
```

Expected: PASS — 16 tests green (5 constructor + 5 prompt + 6 composition_plan).

- [ ] **Step 5: Commit**

```bash
git add services/ElevenLabsMusicService.js __tests__/services/ElevenLabsMusicService.test.js
git commit -m "feat(elevenlabs): switch to composition_plan mode when lyrics provided"
```

---

## Task 6: Lyrics line-splitting helper (TDD)

**Files:** `services/ElevenLabsMusicService.js`, `__tests__/services/ElevenLabsMusicService.test.js`

- [ ] **Step 1: Write the failing tests**

Append:

```js
describe('ElevenLabsMusicService._splitLyricsIntoMaxLines', () => {
  let svc;

  beforeEach(() => {
    ElevenLabsClient.mockReset();
    ElevenLabsClient.mockImplementation(() => ({ music: { compose: jest.fn() } }));
    svc = new ElevenLabsMusicService(makeConfig(), { recordMediaGen: jest.fn(), mediaPricing: {} });
  });

  test('preserves user-supplied \\n line breaks under the cap', () => {
    const out = svc._splitLyricsIntoMaxLines('line one\nline two\nline three', 200);
    expect(out).toEqual(['line one', 'line two', 'line three']);
  });

  test('drops empty lines', () => {
    const out = svc._splitLyricsIntoMaxLines('one\n\n\ntwo', 200);
    expect(out).toEqual(['one', 'two']);
  });

  test('drops whitespace-only lines', () => {
    const out = svc._splitLyricsIntoMaxLines('one\n   \n\t\ntwo', 200);
    expect(out).toEqual(['one', 'two']);
  });

  test('word-wraps a line longer than maxLen at the nearest space', () => {
    // 11 words of 10 chars + 10 spaces ~ 120 chars; cap 50 should split into ~3 lines
    const long = 'aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd eeeeeeeeee ffffffffff';
    const out = svc._splitLyricsIntoMaxLines(long, 50);
    out.forEach((line) => expect(line.length).toBeLessThanOrEqual(50));
    // Re-joined content (modulo whitespace) should match the input
    expect(out.join(' ')).toBe(long);
  });

  test('falls back to hard split when a single word exceeds maxLen', () => {
    const huge = 'a'.repeat(250);
    const out = svc._splitLyricsIntoMaxLines(huge, 200);
    out.forEach((line) => expect(line.length).toBeLessThanOrEqual(200));
    expect(out.join('')).toBe(huge);
  });

  test('handles a single short line', () => {
    const out = svc._splitLyricsIntoMaxLines('hello', 200);
    expect(out).toEqual(['hello']);
  });

  test('handles empty input', () => {
    const out = svc._splitLyricsIntoMaxLines('', 200);
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm test -- --testPathPatterns="ElevenLabsMusicService"
```

Expected: FAIL — the long-line / huge-word / whitespace cases all fail against the Task 5 stub.

- [ ] **Step 3: Replace the stub with the real implementation**

In `services/ElevenLabsMusicService.js`, replace the `_splitLyricsIntoMaxLines` stub with:

```js
  // ElevenLabs caps each composition_plan section's `lines[i]` at 200 characters.
  // Split on user-supplied \n first, then word-wrap any over-long lines at the
  // nearest space ≤maxLen. Fall back to hard slicing if a single word exceeds
  // maxLen.
  _splitLyricsIntoMaxLines(lyrics, maxLen) {
    const out = [];
    const rawLines = lyrics.split('\n');
    for (const raw of rawLines) {
      const line = raw.trim();
      if (line.length === 0) continue;

      if (line.length <= maxLen) {
        out.push(line);
        continue;
      }

      // Word-wrap
      let remaining = line;
      while (remaining.length > maxLen) {
        // Find the last space ≤maxLen
        let splitAt = remaining.lastIndexOf(' ', maxLen);
        if (splitAt <= 0) {
          // No usable space — hard split
          splitAt = maxLen;
          out.push(remaining.slice(0, splitAt));
          remaining = remaining.slice(splitAt);
        } else {
          out.push(remaining.slice(0, splitAt));
          remaining = remaining.slice(splitAt + 1); // skip the space
        }
      }
      if (remaining.length > 0) {
        out.push(remaining);
      }
    }
    return out;
  }
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test -- --testPathPatterns="ElevenLabsMusicService"
```

Expected: PASS — 23 tests green (5 + 5 + 6 + 7).

- [ ] **Step 5: Commit**

```bash
git add services/ElevenLabsMusicService.js __tests__/services/ElevenLabsMusicService.test.js
git commit -m "feat(elevenlabs): word-wrap lyrics lines at ElevenLabs' 200-char cap"
```

---

## Task 7: Error paths (TDD)

**Files:** `services/ElevenLabsMusicService.js`, `__tests__/services/ElevenLabsMusicService.test.js`

- [ ] **Step 1: Write the failing tests**

Append:

```js
describe('ElevenLabsMusicService.generateMusic - error paths', () => {
  let svc;
  let composeDetailed;
  let costService;

  beforeEach(() => {
    ElevenLabsClient.mockReset();
    composeDetailed = jest.fn();
    ElevenLabsClient.mockImplementation(() => ({ music: { composeDetailed } }));
    costService = { recordMediaGen: jest.fn(), mediaPricing: {} };
    svc = new ElevenLabsMusicService(makeConfig(), costService);
  });

  test('returns success:false when SDK throws (5xx / network)', async () => {
    composeDetailed.mockRejectedValueOnce(new Error('upstream 503'));
    const result = await svc.generateMusic('prompt', {}, { id: 'u1' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/upstream 503/);
    expect(costService.recordMediaGen).not.toHaveBeenCalled();
  });

  test('returns API message verbatim on 4xx-style rejection', async () => {
    composeDetailed.mockRejectedValueOnce(new Error('Music generation rejected: prompt violates policy'));
    const result = await svc.generateMusic('prompt', {}, { id: 'u1' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('prompt violates policy');
    expect(costService.recordMediaGen).not.toHaveBeenCalled();
  });

  test('returns success:false when response.audio is empty/zero-length buffer', async () => {
    composeDetailed.mockResolvedValueOnce({ audio: Buffer.alloc(0) });
    const result = await svc.generateMusic('prompt', {}, { id: 'u1' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no audio data/i);
    expect(costService.recordMediaGen).not.toHaveBeenCalled();
  });

  test('returns success:false when response.audio is missing', async () => {
    composeDetailed.mockResolvedValueOnce({});
    const result = await svc.generateMusic('prompt', {}, { id: 'u1' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no audio data/i);
    expect(costService.recordMediaGen).not.toHaveBeenCalled();
  });

  test('returns success:false when response is null', async () => {
    composeDetailed.mockResolvedValueOnce(null);
    const result = await svc.generateMusic('prompt', {}, { id: 'u1' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no audio data/i);
    expect(costService.recordMediaGen).not.toHaveBeenCalled();
  });

  test('does not record cost on any failure path', async () => {
    composeDetailed.mockRejectedValueOnce(new Error('boom'));
    await svc.generateMusic('prompt', {}, { id: 'u1' });
    expect(costService.recordMediaGen).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests, verify they pass (or fail)**

```bash
npm test -- --testPathPatterns="ElevenLabsMusicService"
```

The Task 4/5 implementation already places `recordMediaGen` AFTER the audio buffer check, so these are mostly characterization tests. If any fail, fix the service so cost is only recorded after a non-empty buffer is confirmed.

- [ ] **Step 3: If needed, tighten the implementation**

Verify in `services/ElevenLabsMusicService.js` that `this.costService?.recordMediaGen(...)` runs only after the `buffer && buffer.length > 0` check. No other change should be necessary.

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test -- --testPathPatterns="ElevenLabsMusicService"
```

Expected: PASS — 28 tests green.

- [ ] **Step 5: Run the full suite**

```bash
npm test 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add services/ElevenLabsMusicService.js __tests__/services/ElevenLabsMusicService.test.js
git commit -m "test(elevenlabs): cover SDK error, empty body, and cost-on-failure paths"
```

---

## Task 8: ElevenmusicCommand slash command

**Files:** `commands/slash/ElevenmusicCommand.js`, `commands/slash/index.js`

- [ ] **Step 1: Create the slash command**

Create `commands/slash/ElevenmusicCommand.js`:

```js
// commands/slash/ElevenmusicCommand.js
// Slash command for AI music generation via ElevenLabs music_v1

const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');

class ElevenmusicSlashCommand extends BaseSlashCommand {
  constructor(elevenLabsMusicService) {
    super({
      data: new SlashCommandBuilder()
        .setName('elevenmusic')
        .setDescription('Generate music with ElevenLabs')
        .addStringOption((o) => o.setName('prompt').setDescription('What to generate').setRequired(true).setMaxLength(6000))
        .addIntegerOption((o) => o.setName('duration').setDescription('Length in seconds (3-600, default 90)').setRequired(false).setMinValue(3).setMaxValue(600))
        .addBooleanOption((o) => o.setName('instrumental').setDescription('Force instrumental (no vocals). Ignored if lyrics are provided.').setRequired(false))
        .addStringOption((o) => o.setName('lyrics').setDescription('Custom lyrics. Triggers ElevenLabs composition_plan mode.').setRequired(false).setMaxLength(6000)),
      deferReply: true,
      cooldown: 60
    });

    this.elevenLabsMusicService = elevenLabsMusicService;
  }

  async execute(interaction) {
    if (!this.elevenLabsMusicService || !this.elevenLabsMusicService.isEnabled()) {
      await this.sendError(interaction, 'Music generation is not enabled on this bot.');
      return;
    }

    const prompt = interaction.options.getString('prompt');
    const duration = interaction.options.getInteger('duration') || undefined;
    const instrumental = interaction.options.getBoolean('instrumental') ?? false;
    const lyrics = interaction.options.getString('lyrics') || undefined;

    this.logExecution(interaction, `prompt="${prompt.substring(0, 50)}...", duration=${duration || 'default'}, instrumental=${instrumental}, lyrics=${lyrics ? 'yes' : 'no'}`);

    await interaction.editReply({
      content: `Generating music with ElevenLabs... (this may take 10–60 seconds)\n**Prompt:** ${prompt}`
    });

    const result = await this.elevenLabsMusicService.generateMusic(
      prompt,
      { durationSeconds: duration, instrumental, lyrics },
      { id: interaction.user.id, tag: interaction.user.tag }
    );

    if (!result.success) {
      await this.sendError(interaction, result.error || 'Failed to generate music.');
      return;
    }

    if (!result.buffer) {
      await this.sendError(interaction, 'Music generation completed but no audio data was returned.');
      return;
    }

    const attachment = new AttachmentBuilder(result.buffer, {
      name: `generated-music-${Date.now()}.mp3`,
      description: prompt.substring(0, 100)
    });

    await interaction.editReply({
      content: `**Prompt:** ${prompt}`,
      files: [attachment]
    });
  }
}

module.exports = ElevenmusicSlashCommand;
```

- [ ] **Step 2: Export from `commands/slash/index.js`**

In `commands/slash/index.js`, under the `// Media generation commands` block, add:

```js
  ElevenmusicSlashCommand: require('./ElevenmusicCommand'),
```

So the block reads:

```js
  // Media generation commands
  ImagineSlashCommand: require('./ImagineCommand'),
  VideogenSlashCommand: require('./VideogenCommand'),
  MusicgenSlashCommand: require('./MusicgenCommand'),
  ElevenmusicSlashCommand: require('./ElevenmusicCommand'),
```

- [ ] **Step 3: Smoke-load the command in Node**

```bash
node -e "const C = require('./commands/slash/ElevenmusicCommand'); const c = new C({ isEnabled: () => false }); const j = c.data.toJSON(); console.log(j.name, j.options.length); j.options.forEach(o => console.log(' ', o.name, 'type:', o.type, 'required:', !!o.required))"
```

Expected output:
```
elevenmusic 4
  prompt type: 3 required: true
  duration type: 4 required: false
  instrumental type: 5 required: false
  lyrics type: 3 required: false
```

(Discord option types: STRING=3, INTEGER=4, BOOLEAN=5.)

- [ ] **Step 4: Run the full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: All tests pass (no regressions).

- [ ] **Step 5: Commit**

```bash
git add commands/slash/ElevenmusicCommand.js commands/slash/index.js
git commit -m "feat(slash): add /elevenmusic command backed by ElevenLabsMusicService"
```

---

## Task 9: Wire ElevenLabsMusicService into bot.js

**Files:** `bot.js`

- [ ] **Step 1: Require the service near the existing media-gen requires**

In `bot.js`, near the `LyriaService` require (around line 26), add:

```js
const ElevenLabsMusicService = require('./services/ElevenLabsMusicService');
```

- [ ] **Step 2: Add the slash command to the destructured import**

Find the destructured import from `./commands/slash` (around line 54). Add `ElevenmusicSlashCommand` to the list:

```js
const {
  ...
  MusicgenSlashCommand,
  ElevenmusicSlashCommand,
  ...
} = require('./commands/slash');
```

(Match the existing destructure style; if it's already on multiple lines, append; if all on one line, follow that.)

- [ ] **Step 3: Instantiate the service**

In `bot.js`, immediately after the `LyriaService` instantiation block, add:

```js
    this.elevenLabsMusicService = null;
    try {
      if (config.elevenlabs && config.elevenlabs.enabled) {
        this.elevenLabsMusicService = new ElevenLabsMusicService(config, new CostService());
      }
    } catch (err) {
      logger.error(`Failed to initialize ElevenLabsMusicService: ${err.message}`);
    }
```

(LyriaService also instantiates its own `CostService` — same pattern. `CostService` is already imported in `bot.js` for that reason.)

- [ ] **Step 4: Register the slash command**

In `bot.js`, immediately after the `MusicgenSlashCommand` registration block, add:

```js
    if (this.elevenLabsMusicService && this.elevenLabsMusicService.isEnabled()) {
      this.slashCommandHandler.register(new ElevenmusicSlashCommand(this.elevenLabsMusicService));
    }
```

- [ ] **Step 5: Verify bot.js parses**

```bash
node --check bot.js
```

Expected: no output.

- [ ] **Step 6: Run the full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add bot.js
git commit -m "feat(bot): wire ElevenLabsMusicService and /elevenmusic into the bot"
```

---

## Task 10: Update scripts/registerCommands.js

**Files:** `scripts/registerCommands.js`

**Important — read this before editing:** check the current state of the registration logic before editing:

```bash
grep -n "applicationCommands\|applicationGuildCommands" scripts/registerCommands.js
```

If you see BOTH `Routes.applicationCommands` AND `Routes.applicationGuildCommands` in distinct `await rest.put(...)` blocks (separated by an `if (testGuildId)`), PR #78's dual-target fix has merged. Just add the `ElevenmusicSlashCommand` import and registration block — that's it.

If you only see ONE `await rest.put(...)` block (either the global one OR the guild one, depending on `testGuildId`), PR #78 has NOT merged. This task MUST also include the dual-target fix as documented in `docs/superpowers/plans/2026-05-15-lyria-music-generation.md` (or look at the merged registration script in production at git short-SHA `b42990d`).

- [ ] **Step 1: Add the import**

In `scripts/registerCommands.js`, find the destructured import from `../commands/slash` (around line 10-32). Add `ElevenmusicSlashCommand`:

```js
const {
  ...
  MusicgenSlashCommand,
  ElevenmusicSlashCommand,
  ...
} = require('../commands/slash');
```

- [ ] **Step 2: Add the conditional registration**

Find the `if (config.lyria?.enabled)` block (around line 75) and add a sibling block right after it:

```js
  if (config.elevenlabs?.enabled) {
    commands.push(new ElevenmusicSlashCommand(null));
    console.log('Including /elevenmusic command (elevenlabs enabled)');
  }
```

- [ ] **Step 3: If PR #78 NOT merged: also include the dual-target fix**

Only if the pre-check above showed the old either/or logic. Replace the existing `try { ... } catch` block with:

```js
  try {
    // Always register globally so commands appear in every guild the bot is in.
    console.log('\nRegistering globally (may take up to 1 hour to propagate to all guilds)...');

    await rest.put(
      Routes.applicationCommands(config.discord.clientId),
      { body: commandData }
    );

    console.log(`Successfully registered ${commandData.length} global commands`);

    // If a test guild is configured, ALSO register there for instant feedback.
    const testGuildId = config.discord.testGuildId;
    if (testGuildId) {
      console.log(`\nAlso registering to test guild ${testGuildId} (instant)...`);

      await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, testGuildId),
        { body: commandData }
      );

      console.log(`Successfully registered ${commandData.length} commands to test guild ${testGuildId}`);
      console.log('Note: Guild commands update instantly and override the global definitions in that guild.');
    }

    console.log('\nDone!');

  } catch (error) {
    console.error('Error registering commands:', error);
    process.exit(1);
  }
```

- [ ] **Step 4: Verify the script parses**

```bash
node --check scripts/registerCommands.js
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add scripts/registerCommands.js
git commit -m "feat(scripts): include /elevenmusic when ELEVENMUSIC_ENABLED is set"
```

(If you had to also apply the dual-target fix in Step 3, the commit message body should note that PR #78's fix was folded in to keep this branch standalone.)

---

## Task 11: Update local Kubernetes manifests

**Files (gitignored — local edits only):**
- `k8s/overlays/deployed/configmap.yaml`
- `k8s/overlays/deployed/secret.yaml`

- [ ] **Step 1: Confirm both files are gitignored**

```bash
git check-ignore k8s/overlays/deployed/configmap.yaml k8s/overlays/deployed/secret.yaml
```

Expected: both paths printed. If either is NOT printed, STOP and report.

- [ ] **Step 2: Add the configmap env vars**

In `k8s/overlays/deployed/configmap.yaml`, near other media-gen flags (`MUSICGEN_ENABLED`, `VEO_ENABLED`, `IMAGEGEN_ENABLED`), add:

```yaml
  # Music generation (ElevenLabs)
  ELEVENMUSIC_ENABLED: "true"
  ELEVENLABS_MUSIC_MODEL: "music_v1"
  ELEVENLABS_PER_CALL_COST_USD: "0.10"
```

- [ ] **Step 3: Add the API key to the secret**

The user (controller) has the actual `ELEVENLABS_API_KEY` value. The implementer should:

1. Read `k8s/overlays/deployed/secret.yaml` to confirm the format (likely base64-encoded values under `data:` OR plain values under `stringData:`).
2. Add an entry mirroring the existing `GEMINI_API_KEY` line, using a placeholder value `__SET_ELEVENLABS_API_KEY_HERE__`.
3. Report back with the placeholder in place — the controller will paste the real key value before the kubectl apply step in Task 12.

```yaml
# Example (placeholder; controller will fill the actual value):
stringData:
  ELEVENLABS_API_KEY: "__SET_ELEVENLABS_API_KEY_HERE__"
```

- [ ] **Step 4: Verify YAML parses**

```bash
python3 -c "import yaml; yaml.safe_load(open('k8s/overlays/deployed/configmap.yaml'))" && echo OK
python3 -c "import yaml; yaml.safe_load(open('k8s/overlays/deployed/secret.yaml'))" && echo OK
```

Expected: both print `OK`.

- [ ] **Step 5: Do NOT commit**

Both files are gitignored. `git status --short` after this task should show NO new staged changes from this task. Confirm:

```bash
git status --short
```

Expected: clean (nothing related to configmap.yaml or secret.yaml).

---

## Task 12: Documentation

**Files:** `features.md`, `README.md`

- [ ] **Step 1: Update `features.md`**

Add a new section under or alongside the existing Music Generation section:

```markdown
## ElevenLabs Music Generation (`/elevenmusic`)

Parallel music generation surface via ElevenLabs' `POST /v1/music` (Compose Music). Shipped alongside `/musicgen` (Lyria) for A/B comparison.

**Inputs**
- `prompt` (required) — description of the music
- `duration` (optional, 3–600s) — default 90 seconds (matches Lyria Pro for apples-to-apples comparison)
- `instrumental` (optional, boolean) — `force_instrumental: true` when no lyrics
- `lyrics` (optional) — triggers an under-the-hood switch to ElevenLabs' `composition_plan` mode (the only API path that accepts lyrics)

**Output**
- MP3 audio attachment, duration controlled by the `duration` option

**Config**
- `ELEVENMUSIC_ENABLED=true`
- `ELEVENLABS_MUSIC_MODEL` (default `music_v1`)
- `ELEVENLABS_DEFAULT_DURATION_SECONDS` (default `90`)
- `ELEVENLABS_PER_CALL_COST_USD` (default `0.10`, placeholder pending verified pricing)
- `ELEVENLABS_API_KEY` (secret)

**Cost tracking**
- Each call recorded through `CostService.recordMediaGen('elevenlabs-music-v1', user)` and surfaced in the bot's cumulative cost log lines. Not surfaced in `/stats` today (same gap as Lyria — needs MongoDB-backed media-gen records, part of Approach B).

**TODO: Approach B refactor (louder now).** `ImagenService` / `VeoService` / `LyriaService` / `ElevenLabsMusicService` duplicate noticeable plumbing. Worth extracting a `MediaGenBase` now that four services share the same shape. See `docs/superpowers/specs/2026-05-15-elevenlabs-music-generation-design.md` ("Approach B").
```

- [ ] **Step 2: Update `README.md`**

In the user-facing feature list, add a bullet next to the existing `/musicgen` entry:

```markdown
- `/elevenmusic` — AI music generation (ElevenLabs `music_v1`, parallel to `/musicgen`)
```

- [ ] **Step 3: Commit**

```bash
git add features.md README.md
git commit -m "docs: document /elevenmusic and ElevenLabs integration"
```

---

## Task 13: Version bump, build, deploy, register, smoke test, PR

**Files:** `package.json`, `package-lock.json` (auto); local-only `k8s/overlays/deployed/deployment.yaml`

- [ ] **Step 1: Confirm full test suite passes**

```bash
npm test 2>&1 | tail -10
```

Expected: All tests pass — 28 new (5+5+6+7+5) ElevenLabsMusicService tests + 1 new CostService test on top of the baseline.

- [ ] **Step 2: Bump minor version**

```bash
npm version minor --no-git-tag-version
```

This is a new user-facing feature, so a minor bump. From `2.14.x` to `2.15.0`.

- [ ] **Step 3: Commit the bump**

```bash
git add package.json package-lock.json
git commit -m "chore: bump version to 2.15.0"
```

- [ ] **Step 4: Build the Docker image (pinned tag)**

```bash
SHA=$(git rev-parse --short HEAD)
docker build -t mvilliger/discord-article-bot:$SHA .
```

If the build fails at `npm ci --only=production` with a peer-dep ERESOLVE or a native-build error, STOP and report. Do NOT add `--legacy-peer-deps` to the Dockerfile.

- [ ] **Step 5: Push the image**

```bash
docker push mvilliger/discord-article-bot:$SHA
```

- [ ] **Step 6: Ensure the controller has filled in `ELEVENLABS_API_KEY` in the secret**

Pause here and confirm with the user that the placeholder value in `k8s/overlays/deployed/secret.yaml` has been replaced with the real `ELEVENLABS_API_KEY`. The pod will start but `/elevenmusic` will return "not enabled" without it.

- [ ] **Step 7: Apply the secret + configmap**

```bash
kubectl apply -f k8s/overlays/deployed/secret.yaml -n discord-article-bot
kubectl apply -f k8s/overlays/deployed/configmap.yaml -n discord-article-bot
```

- [ ] **Step 8: Update local `deployment.yaml` + rollout**

Edit the `bot` container `image:` field in `k8s/overlays/deployed/deployment.yaml` to `mvilliger/discord-article-bot:<short-sha>`. Do NOT commit this file.

```bash
kubectl set image deployment/discord-article-bot bot=mvilliger/discord-article-bot:$SHA -n discord-article-bot
kubectl rollout status deployment/discord-article-bot -n discord-article-bot --timeout=180s
```

- [ ] **Step 9: Re-register slash commands inside the new pod**

```bash
POD=$(kubectl get pod -n discord-article-bot -l app.kubernetes.io/name=discord-article-bot -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n discord-article-bot $POD -c bot -- node scripts/registerCommands.js
```

Expected output includes both:
- `Successfully registered N global commands` (where N is now 21 — was 20)
- `Including /elevenmusic command (elevenlabs enabled)`

If only the test-guild registration succeeded (no global), PR #78's fix has not made it into this branch. Apply it now per Task 10 Step 3 and rebuild.

- [ ] **Step 10: Manual smoke test in Discord**

CTRL-R in Discord to force a slash command refresh. Then:

1. `/elevenmusic prompt:"upbeat lo-fi study beat, 90 BPM"` — verify MP3 attachment within ~30s.
2. `/elevenmusic prompt:"jazz trio" duration:15 instrumental:true` — verify short instrumental.
3. `/elevenmusic prompt:"folk ballad" lyrics:"[Verse]\nFirst line\nSecond line\n[Chorus]\nRefrain"` — verify composition_plan path; vocals should attempt the lyrics.
4. Pod logs: confirm a `Media gen recorded - model: elevenlabs-music-v1` line after a successful call.
5. Side-by-side: run the same prompt against `/musicgen` and `/elevenmusic`. Subjective compare is the whole point.

If any smoke test fails, capture pod logs:
```bash
kubectl logs -n discord-article-bot deployment/discord-article-bot --tail=200 -c bot
```

- [ ] **Step 11: Push branch and open PR**

```bash
git push -u origin feat/elevenlabs-music-generation
gh pr create --title "feat: /elevenmusic — ElevenLabs music generation (v2.15.0)" --body "$(cat <<'EOF'
## Summary
- New `/elevenmusic` slash command backed by `ElevenLabsMusicService` (`music_v1`)
- Inputs: `prompt` (required), `duration` (3–600s, default 90), `instrumental`, `lyrics`
- Lyrics trigger a transparent switch to ElevenLabs' `composition_plan` mode (the only API path that accepts lyrics)
- `force_instrumental` is silently dropped when lyrics are provided (contradiction; API field is prompt-mode-only)
- New `@elevenlabs/elevenlabs-js` dependency
- CostService.mediaPricing extended with `elevenlabs-music-v1` (default $0.10/call, env-overridable)
- Approach B refactor (shared `MediaGenBase` across the four media-gen services) called out as a follow-up

## Spec + plan
- Spec: docs/superpowers/specs/2026-05-15-elevenlabs-music-generation-design.md
- Plan: docs/superpowers/plans/2026-05-15-elevenlabs-music-generation.md

## Test plan
- [x] ElevenLabsMusicService unit tests (constructor, prompt mode, composition_plan mode, line-splitting, error paths) — 28 new tests
- [x] CostService.recordMediaGen for new model entry — 1 new test
- [x] Full `npm test` green
- [x] Manual smoke tests in production Discord (both prompt mode and lyrics mode)
- [x] Pod logs show Media gen recorded for elevenlabs-music-v1
- [x] Side-by-side A/B with /musicgen confirms parallel surface works

## Out of scope (follow-ups)
- Multi-section composition_plan authoring (single-section transparent switch is sufficient for v1)
- Inpainting (`store_for_inpainting=true`)
- A `/musicgen-compare` command that fires both providers
- The MediaGenBase refactor — Approach B in the spec

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the implementer

- **No `:latest` tags.** Pin Docker tags to the git short-SHA always.
- **No log truncation.** When logging error payloads, log them in full.
- **No `--legacy-peer-deps` and no `.npmrc` flag workarounds.** If a peer-dep conflict appears, escalate with details — don't mask.
- **TDD discipline.** Write the failing test, watch it fail, then implement.
- **Frequent commits.** Each task ends in a commit. No batching across tasks.
- **The deployed configmap and secret are gitignored** — never `git add` them.
- **SDK ambiguity (Task 0 spike).** If the `@elevenlabs/elevenlabs-js` SDK uses camelCase field names internally (e.g. `musicLengthMs` instead of `music_length_ms`), Tasks 4–5 need that translation. The Task 0 spike report should flag this so the controller can update the field names inline before Task 4.
- **Failure modes to watch:**
  - SDK rejects `composition_plan` for a model version it doesn't support → fall back to prompt mode with a warning (would require revising the spec; report first).
  - Response stream timing out for long durations (>5min) → may need a longer timeout on the SDK client.
  - 4xx with a specific safety-block reason → just surface verbatim per the spec error table.
