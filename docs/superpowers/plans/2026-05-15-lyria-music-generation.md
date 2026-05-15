# Lyria 3 Music Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/musicgen` slash command backed by a new `LyriaService` that calls Google's `lyria-3-pro-preview` to generate music, mirroring the existing `/imagine` and `/videogen` patterns.

**Architecture:** New `services/LyriaService.js` (modeled on `ImagenService`/`VeoService`) + `commands/slash/MusicgenCommand.js` (modeled on `VideogenCommand.js`). Service uses the new `@google/genai` SDK because the older `@google/generative-ai` used by Imagen does not expose Lyria. Service returns `{success, buffer, mimeType, generatedLyrics?, error?}` and is wired into `bot.js` next to Imagen/Veo. `CostService` gains a `recordMediaGen(modelKey, user)` method so flat-fee media generation can be rolled into `/stats`.

**Tech Stack:** Node.js, discord.js v14, Jest v30, `@google/genai` SDK (new dependency), existing axios/logger/tracing utilities.

**Spec:** `docs/superpowers/specs/2026-05-15-lyria-music-generation-design.md`

---

## File map

**New files:**
- `services/LyriaService.js`
- `commands/slash/MusicgenCommand.js`
- `__tests__/services/LyriaService.test.js`

**Modified files:**
- `package.json` (add `@google/genai` dep)
- `config/config.js` (add `lyria` block)
- `services/CostService.js` (add `recordMediaGen()`)
- `__tests__/services/CostService.test.js` *(create if missing)*
- `bot.js` (instantiate LyriaService; register MusicgenSlashCommand)
- `commands/slash/index.js` (export `MusicgenSlashCommand`)
- `k8s/overlays/deployed/configmap.yaml` (add `MUSICGEN_ENABLED`, `LYRIA_MODEL`, `LYRIA_PER_CALL_COST_USD`)
- `features.md` (new section + Approach B refactor TODO)
- `README.md` (mention `/musicgen` under media generation)
- `package.json` (version bump — done in final task)

---

## Task 0: Branch + SDK spike

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Create feature branch**

```bash
git checkout main && git pull origin main
git checkout -b feat/lyria-music-generation
```

- [ ] **Step 2: Install `@google/genai`**

The Lyria docs use the new unified Gemini SDK (`@google/genai`). The project currently has `@google/generative-ai` (older SDK) which does not expose Lyria models. Add the new SDK without removing the old one — Imagen still depends on it.

```bash
npm install @google/genai
```

Expected: `@google/genai` appears in `dependencies` of `package.json`; `package-lock.json` updated.

- [ ] **Step 3: SDK spike — confirm the JS call shape**

Write a one-off scratch file to validate the response shape. Run it manually with `GEMINI_API_KEY=... node scripts/lyria-spike.js`. Do NOT commit the spike.

```bash
mkdir -p scripts
cat > scripts/lyria-spike.js <<'EOF'
const { GoogleGenAI } = require('@google/genai');

async function main() {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await client.models.generateContent({
    model: 'lyria-3-pro-preview',
    contents: 'a 20-second cheerful acoustic folk loop with light guitar'
  });
  // Print structure so we can see how audio bytes are returned
  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  for (const p of parts) {
    if (p.inlineData) {
      console.log('inlineData mimeType:', p.inlineData.mimeType, 'bytes(b64):', p.inlineData.data?.length);
    } else if (p.text) {
      console.log('text part:', p.text.slice(0, 200));
    } else {
      console.log('other part:', Object.keys(p));
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
EOF
```

Run: `GEMINI_API_KEY=$GEMINI_API_KEY node scripts/lyria-spike.js`
Expected: At least one `inlineData` part with `mimeType` starting `audio/` and a non-zero base64 length. Optionally a `text` part with structure/lyrics.

If the SDK exposes a different surface (e.g., dedicated `generateMusic` method, long-running operation), pause here and update this plan before continuing.

- [ ] **Step 4: Remove the spike and commit**

```bash
rm scripts/lyria-spike.js
git add package.json package-lock.json
git commit -m "chore: add @google/genai SDK for Lyria music generation"
```

---

## Task 1: Extend CostService with `recordMediaGen()`

**Files:**
- Modify: `services/CostService.js`
- Create: `__tests__/services/CostService.test.js` *(if it does not exist)*

- [ ] **Step 1: Write the failing tests**

Create `__tests__/services/CostService.test.js`:

```js
const CostService = require('../../services/CostService');

describe('CostService.recordMediaGen', () => {
  let svc;
  beforeEach(() => {
    svc = new CostService();
  });

  test('records a known model and updates cumulative.media', () => {
    const result = svc.recordMediaGen('lyria-3-pro-preview', { id: 'u1', tag: 'alice' });
    expect(result.success).toBe(true);
    expect(result.cost).toBeCloseTo(0.06, 5);
    expect(svc.cumulative.media.total).toBeCloseTo(0.06, 5);
    expect(svc.cumulative.media.calls).toBe(1);
    expect(svc.cumulative.media.byModel['lyria-3-pro-preview']).toBeCloseTo(0.06, 5);
  });

  test('multiple records accumulate', () => {
    svc.recordMediaGen('lyria-3-pro-preview', { id: 'u1' });
    svc.recordMediaGen('lyria-3-pro-preview', { id: 'u2' });
    expect(svc.cumulative.media.total).toBeCloseTo(0.12, 5);
    expect(svc.cumulative.media.calls).toBe(2);
  });

  test('unknown model returns success:false and does not update cumulative', () => {
    const result = svc.recordMediaGen('not-a-real-model', { id: 'u1' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unknown model/i);
    expect(svc.cumulative.media.total).toBe(0);
    expect(svc.cumulative.media.calls).toBe(0);
  });

  test('null user is tolerated', () => {
    const result = svc.recordMediaGen('lyria-3-pro-preview', null);
    expect(result.success).toBe(true);
    expect(svc.cumulative.media.calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm test -- --testPathPatterns="CostService"
```

Expected: FAIL — `recordMediaGen` is not a function / `cumulative.media` is undefined.

- [ ] **Step 3: Implement `recordMediaGen()`**

Edit `services/CostService.js`. Add a `mediaPricing` map in the constructor, initialize `cumulative.media`, and add the method.

In the constructor, after `this.pricing`:

```js
    // Flat per-call pricing for media generation models (USD per call).
    // Placeholders pending finalized Google pricing — override via env if needed.
    this.mediaPricing = {
      'lyria-3-pro-preview': 0.06
    };
```

In the constructor, after `this.cumulative = { ... }`:

```js
    this.cumulative.media = {
      total: 0,
      calls: 0,
      byModel: {}
    };
```

Below `updateCumulative()`, add:

```js
  recordMediaGen(modelKey, user) {
    const cost = this.mediaPricing[modelKey];
    if (typeof cost !== 'number') {
      const error = `Unknown model for media generation cost: ${modelKey}`;
      logger.warn(error);
      return { success: false, error };
    }

    this.cumulative.media.total += cost;
    this.cumulative.media.calls += 1;
    this.cumulative.media.byModel[modelKey] = (this.cumulative.media.byModel[modelKey] || 0) + cost;

    const userLabel = user?.tag || user?.id || 'unknown';
    logger.info(`Media gen recorded - model: ${modelKey}, user: ${userLabel}, cost: ${this.formatCost(cost)}, cumulative: ${this.formatCost(this.cumulative.media.total)} over ${this.cumulative.media.calls} calls`);

    return { success: true, cost, modelKey };
  }
```

Also, extend `logCumulative()` so the media totals are visible:

Old line:
```js
      `Total: ${this.formatCost(this.cumulative.total)}`
```
New line:
```js
      `Total: ${this.formatCost(this.cumulative.total)}` +
      (this.cumulative.media.calls > 0
        ? `, Media gen: ${this.formatCost(this.cumulative.media.total)} (${this.cumulative.media.calls} calls)`
        : '')
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test -- --testPathPatterns="CostService"
```

Expected: PASS — all four tests green.

- [ ] **Step 5: Run the full suite to confirm no regression**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add services/CostService.js __tests__/services/CostService.test.js
git commit -m "feat(cost): add recordMediaGen for flat-fee media generation tracking"
```

---

## Task 2: Add `lyria` config block

**Files:**
- Modify: `config/config.js`

- [ ] **Step 1: Add the config block**

In `config/config.js`, immediately after the `veo: { ... }` block, add:

```js
  // Lyria 3 - Google Gemini music generation
  lyria: {
    // Enable/disable music generation
    enabled: process.env.MUSICGEN_ENABLED === 'true',
    // Gemini API key (falls back to GEMINI_API_KEY since they are the same credential)
    apiKey: process.env.LYRIA_API_KEY || process.env.GEMINI_API_KEY || '',
    // Model to use. Pro is the only supported option today.
    model: process.env.LYRIA_MODEL || 'lyria-3-pro-preview',
    // Max reference images per request (Discord slash command exposes 3 slots)
    maxImagesPerRequest: 3,
    // Max prompt / lyrics / negative-prompt lengths
    maxPromptLength: parseInt(process.env.LYRIA_MAX_PROMPT_LENGTH || '1000', 10),
    maxLyricsLength: parseInt(process.env.LYRIA_MAX_LYRICS_LENGTH || '2000', 10),
    maxNegativePromptLength: parseInt(process.env.LYRIA_MAX_NEGATIVE_PROMPT_LENGTH || '500', 10),
    // Cooldown between music generations per user (in seconds)
    cooldownSeconds: parseInt(process.env.LYRIA_COOLDOWN_SECONDS || '60', 10),
    // Per-call flat cost (USD) used to seed CostService.mediaPricing override at runtime
    perCallCostUsd: parseFloat(process.env.LYRIA_PER_CALL_COST_USD || '0.06')
  },
```

- [ ] **Step 2: Verify config loads without errors**

```bash
node -e "console.log(require('./config/config').lyria)"
```

Expected: object printed with `enabled: false` (because `MUSICGEN_ENABLED` is unset locally) and the sane defaults.

- [ ] **Step 3: Commit**

```bash
git add config/config.js
git commit -m "feat(config): add lyria block for music generation"
```

---

## Task 3: LyriaService — constructor + enabled check (TDD)

**Files:**
- Create: `services/LyriaService.js`
- Create: `__tests__/services/LyriaService.test.js`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/services/LyriaService.test.js`:

```js
// Mock @google/genai before requiring the service
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: jest.fn() }
  }))
}));

const { GoogleGenAI } = require('@google/genai');
const LyriaService = require('../../services/LyriaService');

function makeConfig(overrides = {}) {
  return {
    lyria: {
      enabled: true,
      apiKey: 'test-key',
      model: 'lyria-3-pro-preview',
      maxImagesPerRequest: 3,
      maxPromptLength: 1000,
      maxLyricsLength: 2000,
      maxNegativePromptLength: 500,
      cooldownSeconds: 60,
      perCallCostUsd: 0.06,
      ...overrides
    }
  };
}

describe('LyriaService constructor', () => {
  beforeEach(() => {
    GoogleGenAI.mockClear();
  });

  test('initializes the genai client when enabled', () => {
    const svc = new LyriaService(makeConfig(), { recordMediaGen: jest.fn() });
    expect(svc.isEnabled()).toBe(true);
    expect(GoogleGenAI).toHaveBeenCalledWith({ apiKey: 'test-key' });
  });

  test('is disabled when config.lyria.enabled is false', () => {
    const svc = new LyriaService(makeConfig({ enabled: false }), { recordMediaGen: jest.fn() });
    expect(svc.isEnabled()).toBe(false);
    expect(GoogleGenAI).not.toHaveBeenCalled();
  });

  test('is disabled when apiKey is missing', () => {
    const svc = new LyriaService(makeConfig({ apiKey: '' }), { recordMediaGen: jest.fn() });
    expect(svc.isEnabled()).toBe(false);
    expect(GoogleGenAI).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm test -- --testPathPatterns="LyriaService"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the service skeleton**

Create `services/LyriaService.js`:

```js
// services/LyriaService.js
// TODO(media-gen-refactor): Imagen/Veo/Lyria duplicate noticeable plumbing
// (enabled checks, image fetching, error shaping, attachment handling).
// Consider extracting a MediaGenBase once all three are stable.
// See docs/superpowers/specs/2026-05-15-lyria-music-generation-design.md ("Approach B").

const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');
const logger = require('../logger');

class LyriaService {
  constructor(config, costService) {
    this.config = config;
    this.costService = costService;
    this.client = null;

    const cfg = config?.lyria || {};
    if (!cfg.enabled) {
      logger.info('LyriaService disabled by config');
      return;
    }
    if (!cfg.apiKey) {
      logger.warn('LyriaService disabled: missing GEMINI_API_KEY / LYRIA_API_KEY');
      return;
    }

    this.client = new GoogleGenAI({ apiKey: cfg.apiKey });
    logger.info(`LyriaService enabled - model: ${cfg.model}`);
  }

  isEnabled() {
    return this.client !== null;
  }
}

module.exports = LyriaService;
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test -- --testPathPatterns="LyriaService"
```

Expected: PASS — all three tests green.

- [ ] **Step 5: Commit**

```bash
git add services/LyriaService.js __tests__/services/LyriaService.test.js
git commit -m "feat(lyria): scaffold LyriaService with enabled/disabled checks"
```

---

## Task 4: `generateMusic()` happy path (TDD)

**Files:**
- Modify: `services/LyriaService.js`
- Modify: `__tests__/services/LyriaService.test.js`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/services/LyriaService.test.js`:

```js
describe('LyriaService.generateMusic - happy path', () => {
  let svc;
  let generateContent;
  let costService;

  beforeEach(() => {
    GoogleGenAI.mockClear();
    generateContent = jest.fn().mockResolvedValue({
      candidates: [{
        content: {
          parts: [
            { inlineData: { mimeType: 'audio/mpeg', data: Buffer.from('FAKE_MP3').toString('base64') } }
          ]
        }
      }]
    });
    GoogleGenAI.mockImplementation(() => ({ models: { generateContent } }));
    costService = { recordMediaGen: jest.fn().mockReturnValue({ success: true, cost: 0.06 }) };
    svc = new LyriaService(makeConfig(), costService);
  });

  test('returns audio buffer on success and records cost', async () => {
    const result = await svc.generateMusic('upbeat lo-fi', {}, { id: 'u1', tag: 'alice' });

    expect(result.success).toBe(true);
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.toString()).toBe('FAKE_MP3');
    expect(result.mimeType).toBe('audio/mpeg');
    expect(costService.recordMediaGen).toHaveBeenCalledWith('lyria-3-pro-preview', { id: 'u1', tag: 'alice' });
  });

  test('passes prompt as the first content part', async () => {
    await svc.generateMusic('a slow piano ballad', {}, { id: 'u1' });

    expect(generateContent).toHaveBeenCalledTimes(1);
    const call = generateContent.mock.calls[0][0];
    expect(call.model).toBe('lyria-3-pro-preview');
    expect(call.contents).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('a slow piano ballad') })])
    );
  });

  test('returns success:false when service is disabled', async () => {
    const disabled = new LyriaService(makeConfig({ enabled: false }), costService);
    const result = await disabled.generateMusic('foo', {}, { id: 'u1' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not enabled/i);
    expect(costService.recordMediaGen).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm test -- --testPathPatterns="LyriaService"
```

Expected: FAIL — `generateMusic is not a function`.

- [ ] **Step 3: Implement `generateMusic` (minimal)**

Add to `services/LyriaService.js`, inside the class after `isEnabled()`:

```js
  async generateMusic(prompt, options = {}, user = null) {
    if (!this.isEnabled()) {
      return { success: false, error: 'Music generation is not enabled on this bot.' };
    }

    const contents = [{ text: prompt }];

    let response;
    try {
      response = await this.client.models.generateContent({
        model: this.config.lyria.model,
        contents
      });
    } catch (err) {
      logger.error(`Lyria generateContent failed: ${err.message}`, { error: err });
      return { success: false, error: `Music generation failed: ${err.message}` };
    }

    const parts = response?.candidates?.[0]?.content?.parts || [];
    const audioPart = parts.find((p) => p.inlineData && (p.inlineData.mimeType || '').startsWith('audio/'));
    if (!audioPart) {
      return { success: false, error: 'Music generation completed but no audio data was returned.' };
    }

    const buffer = Buffer.from(audioPart.inlineData.data, 'base64');
    const mimeType = audioPart.inlineData.mimeType;

    const textPart = parts.find((p) => typeof p.text === 'string' && p.text.length > 0);
    const generatedLyrics = textPart ? textPart.text : null;

    this.costService?.recordMediaGen(this.config.lyria.model, user);

    return { success: true, buffer, mimeType, generatedLyrics };
  }
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test -- --testPathPatterns="LyriaService"
```

Expected: PASS — happy-path tests green.

- [ ] **Step 5: Commit**

```bash
git add services/LyriaService.js __tests__/services/LyriaService.test.js
git commit -m "feat(lyria): implement generateMusic happy path"
```

---

## Task 5: `generateMusic()` lyrics + negative prompt (TDD)

**Files:**
- Modify: `services/LyriaService.js`
- Modify: `__tests__/services/LyriaService.test.js`

- [ ] **Step 1: Write the failing tests**

Append:

```js
describe('LyriaService.generateMusic - lyrics + negative prompt', () => {
  let svc;
  let generateContent;

  beforeEach(() => {
    GoogleGenAI.mockClear();
    generateContent = jest.fn().mockResolvedValue({
      candidates: [{
        content: { parts: [{ inlineData: { mimeType: 'audio/mpeg', data: Buffer.from('ok').toString('base64') } }] }
      }]
    });
    GoogleGenAI.mockImplementation(() => ({ models: { generateContent } }));
    svc = new LyriaService(makeConfig(), { recordMediaGen: jest.fn() });
  });

  test('includes lyrics text part when provided', async () => {
    await svc.generateMusic('prompt', { lyrics: '[Verse]\nhello world' }, { id: 'u1' });
    const call = generateContent.mock.calls[0][0];
    const textParts = call.contents.filter((p) => typeof p.text === 'string').map((p) => p.text);
    expect(textParts.some((t) => t.includes('[Verse]'))).toBe(true);
    expect(textParts.some((t) => t.includes('hello world'))).toBe(true);
  });

  test('omits lyrics part when empty', async () => {
    await svc.generateMusic('prompt', { lyrics: '' }, { id: 'u1' });
    const call = generateContent.mock.calls[0][0];
    const textParts = call.contents.filter((p) => typeof p.text === 'string');
    expect(textParts).toHaveLength(1); // only the prompt
  });

  test('forwards negativePrompt into config.negativePrompt', async () => {
    await svc.generateMusic('prompt', { negativePrompt: 'no vocals' }, { id: 'u1' });
    const call = generateContent.mock.calls[0][0];
    expect(call.config).toEqual(expect.objectContaining({ negativePrompt: 'no vocals' }));
  });

  test('omits config.negativePrompt when not provided', async () => {
    await svc.generateMusic('prompt', {}, { id: 'u1' });
    const call = generateContent.mock.calls[0][0];
    expect(call.config?.negativePrompt).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm test -- --testPathPatterns="LyriaService"
```

Expected: FAIL — lyrics not propagated; `config.negativePrompt` not set.

- [ ] **Step 3: Extend the implementation**

Replace the body of `generateMusic` from the `const contents = [{ text: prompt }];` line down through the `generateContent` call:

```js
    const { lyrics, negativePrompt } = options;

    const contents = [{ text: prompt }];
    if (lyrics && lyrics.trim().length > 0) {
      contents.push({ text: `Lyrics:\n${lyrics}` });
    }

    const apiConfig = {};
    if (negativePrompt && negativePrompt.trim().length > 0) {
      apiConfig.negativePrompt = negativePrompt;
    }

    let response;
    try {
      response = await this.client.models.generateContent({
        model: this.config.lyria.model,
        contents,
        ...(Object.keys(apiConfig).length > 0 ? { config: apiConfig } : {})
      });
    } catch (err) {
      logger.error(`Lyria generateContent failed: ${err.message}`, { error: err });
      return { success: false, error: `Music generation failed: ${err.message}` };
    }
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test -- --testPathPatterns="LyriaService"
```

Expected: PASS — all lyrics/negative-prompt tests green; previous tests still green.

- [ ] **Step 5: Commit**

```bash
git add services/LyriaService.js __tests__/services/LyriaService.test.js
git commit -m "feat(lyria): support lyrics and negative prompt"
```

---

## Task 6: `generateMusic()` reference images (TDD)

**Files:**
- Modify: `services/LyriaService.js`
- Modify: `__tests__/services/LyriaService.test.js`

- [ ] **Step 1: Write the failing tests**

Append:

```js
describe('LyriaService.generateMusic - reference images', () => {
  let svc;
  let generateContent;
  const axios = require('axios');

  beforeEach(() => {
    GoogleGenAI.mockClear();
    generateContent = jest.fn().mockResolvedValue({
      candidates: [{
        content: { parts: [{ inlineData: { mimeType: 'audio/mpeg', data: Buffer.from('ok').toString('base64') } }] }
      }]
    });
    GoogleGenAI.mockImplementation(() => ({ models: { generateContent } }));
    svc = new LyriaService(makeConfig(), { recordMediaGen: jest.fn() });
    jest.spyOn(axios, 'get').mockReset();
  });

  test('fetches and inlines a single reference image', async () => {
    axios.get.mockResolvedValueOnce({
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), // PNG magic
      headers: { 'content-type': 'image/png' }
    });

    await svc.generateMusic('prompt', { imageUrls: ['https://x/1.png'] }, { id: 'u1' });
    const call = generateContent.mock.calls[0][0];
    const imageParts = call.contents.filter((p) => p.inlineData && (p.inlineData.mimeType || '').startsWith('image/'));
    expect(imageParts).toHaveLength(1);
    expect(imageParts[0].inlineData.mimeType).toBe('image/png');
    expect(imageParts[0].inlineData.data.length).toBeGreaterThan(0);
  });

  test('drops a failed image fetch and continues with the rest', async () => {
    axios.get
      .mockResolvedValueOnce({ data: Buffer.from('a'), headers: { 'content-type': 'image/png' } })
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValueOnce({ data: Buffer.from('b'), headers: { 'content-type': 'image/jpeg' } });

    const result = await svc.generateMusic('prompt', { imageUrls: ['u1', 'u2', 'u3'] }, { id: 'u1' });
    expect(result.success).toBe(true);
    const call = generateContent.mock.calls[0][0];
    const imageParts = call.contents.filter((p) => p.inlineData && (p.inlineData.mimeType || '').startsWith('image/'));
    expect(imageParts).toHaveLength(2);
  });

  test('returns success:false when all image fetches fail', async () => {
    axios.get.mockRejectedValue(new Error('boom'));
    const result = await svc.generateMusic('prompt', { imageUrls: ['u1', 'u2'] }, { id: 'u1' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/reference images/i);
    expect(generateContent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm test -- --testPathPatterns="LyriaService"
```

Expected: FAIL — image parts not present in `contents`.

- [ ] **Step 3: Extend the implementation**

Inside `generateMusic`, immediately after the `if (lyrics && lyrics.trim().length > 0)` block and before `apiConfig` is built, add:

```js
    const { imageUrls = [] } = options;
    if (imageUrls.length > 0) {
      const fetched = await Promise.all(imageUrls.map(async (url) => {
        try {
          const resp = await axios.get(url, { responseType: 'arraybuffer' });
          const mimeType = resp.headers['content-type'] || 'image/png';
          const data = Buffer.from(resp.data).toString('base64');
          return { inlineData: { mimeType, data } };
        } catch (err) {
          logger.warn(`Lyria: failed to fetch reference image ${url}: ${err.message}`);
          return null;
        }
      }));
      const okImages = fetched.filter(Boolean);
      if (okImages.length === 0) {
        return { success: false, error: 'Could not fetch reference images.' };
      }
      contents.push(...okImages);
    }
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test -- --testPathPatterns="LyriaService"
```

Expected: PASS — image tests green; all prior tests still green.

- [ ] **Step 5: Commit**

```bash
git add services/LyriaService.js __tests__/services/LyriaService.test.js
git commit -m "feat(lyria): inline reference images via base64"
```

---

## Task 7: `generateMusic()` error paths (TDD)

**Files:**
- Modify: `services/LyriaService.js`
- Modify: `__tests__/services/LyriaService.test.js`

- [ ] **Step 1: Write the failing tests**

Append:

```js
describe('LyriaService.generateMusic - error paths', () => {
  let svc;
  let generateContent;
  let costService;

  beforeEach(() => {
    GoogleGenAI.mockClear();
    generateContent = jest.fn();
    GoogleGenAI.mockImplementation(() => ({ models: { generateContent } }));
    costService = { recordMediaGen: jest.fn() };
    svc = new LyriaService(makeConfig(), costService);
  });

  test('returns success:false when SDK throws (5xx / network)', async () => {
    generateContent.mockRejectedValueOnce(new Error('upstream 503'));
    const result = await svc.generateMusic('prompt', {}, { id: 'u1' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/upstream 503/);
    expect(costService.recordMediaGen).not.toHaveBeenCalled();
  });

  test('returns API message verbatim on 4xx-style rejection', async () => {
    generateContent.mockRejectedValueOnce(new Error('Music generation rejected: prompt violates policy'));
    const result = await svc.generateMusic('prompt', {}, { id: 'u1' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('prompt violates policy');
  });

  test('returns success:false when response has no audio part', async () => {
    generateContent.mockResolvedValueOnce({
      candidates: [{ content: { parts: [{ text: 'only text' }] } }]
    });
    const result = await svc.generateMusic('prompt', {}, { id: 'u1' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no audio data/i);
    expect(costService.recordMediaGen).not.toHaveBeenCalled();
  });

  test('does not record cost on any failure path', async () => {
    generateContent.mockRejectedValueOnce(new Error('boom'));
    await svc.generateMusic('prompt', {}, { id: 'u1' });
    expect(costService.recordMediaGen).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail (or pass — depends on Task 4 implementation)**

```bash
npm test -- --testPathPatterns="LyriaService"
```

Most error paths should already be covered by the Task 4 implementation. If any fail, adjust the service accordingly (e.g., ensure `recordMediaGen` is called *only* after a successful audio extract).

- [ ] **Step 3: If needed, tighten the implementation**

Verify in `services/LyriaService.js` that `this.costService?.recordMediaGen(...)` happens AFTER the audio extraction succeeds (it does in the Task 4 implementation, but confirm). No other change should be necessary.

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test -- --testPathPatterns="LyriaService"
```

Expected: PASS — all error-path tests green.

- [ ] **Step 5: Commit**

```bash
git add services/LyriaService.js __tests__/services/LyriaService.test.js
git commit -m "test(lyria): cover SDK error, missing audio, and cost-on-failure paths"
```

---

## Task 8: MusicgenCommand slash command

**Files:**
- Create: `commands/slash/MusicgenCommand.js`
- Modify: `commands/slash/index.js`

- [ ] **Step 1: Create the slash command**

Create `commands/slash/MusicgenCommand.js`:

```js
// commands/slash/MusicgenCommand.js
// Slash command for AI music generation via Lyria 3 Pro

const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const logger = require('../../logger');

const VALID_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB per image

class MusicgenSlashCommand extends BaseSlashCommand {
  constructor(lyriaService) {
    super({
      data: new SlashCommandBuilder()
        .setName('musicgen')
        .setDescription('Generate music with Lyria 3')
        .addStringOption((o) => o.setName('prompt').setDescription('What to generate').setRequired(true).setMaxLength(1000))
        .addStringOption((o) => o.setName('lyrics').setDescription('Custom lyrics. Supports [Verse] / [Chorus] / [Bridge] tags').setRequired(false).setMaxLength(2000))
        .addStringOption((o) => o.setName('negative_prompt').setDescription('Things to avoid (e.g. "no vocals", "no drums")').setRequired(false).setMaxLength(500))
        .addAttachmentOption((o) => o.setName('image1').setDescription('Reference image 1').setRequired(false))
        .addAttachmentOption((o) => o.setName('image2').setDescription('Reference image 2').setRequired(false))
        .addAttachmentOption((o) => o.setName('image3').setDescription('Reference image 3').setRequired(false)),
      deferReply: true,
      cooldown: 60
    });

    this.lyriaService = lyriaService;
  }

  async execute(interaction) {
    if (!this.lyriaService || !this.lyriaService.isEnabled()) {
      await this.sendError(interaction, 'Music generation is not enabled on this bot.');
      return;
    }

    const prompt = interaction.options.getString('prompt');
    const lyrics = interaction.options.getString('lyrics') || undefined;
    const negativePrompt = interaction.options.getString('negative_prompt') || undefined;

    const imageOpts = ['image1', 'image2', 'image3']
      .map((n) => interaction.options.getAttachment(n))
      .filter(Boolean);

    for (const img of imageOpts) {
      if (!VALID_IMAGE_TYPES.includes(img.contentType)) {
        await this.sendError(interaction, 'Reference images must be PNG, JPEG, GIF, or WebP.');
        return;
      }
      if (typeof img.size === 'number' && img.size > MAX_IMAGE_BYTES) {
        await this.sendError(interaction, `Reference image too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB).`);
        return;
      }
    }

    this.logExecution(interaction, `prompt="${prompt.substring(0, 50)}...", lyrics=${lyrics ? 'yes' : 'no'}, images=${imageOpts.length}`);

    await interaction.editReply({
      content: `Generating music... This may take 1–3 minutes.\n**Prompt:** ${prompt}`
    });

    const result = await this.lyriaService.generateMusic(
      prompt,
      {
        lyrics,
        negativePrompt,
        imageUrls: imageOpts.map((a) => a.url)
      },
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

    const ext = (result.mimeType || '').includes('wav') ? 'wav' : 'mp3';
    const attachment = new AttachmentBuilder(result.buffer, {
      name: `generated-music-${Date.now()}.${ext}`,
      description: prompt.substring(0, 100)
    });

    const replyPayload = { content: `**Prompt:** ${prompt}`, files: [attachment] };
    if (result.generatedLyrics) {
      const truncated = result.generatedLyrics.length > 4000
        ? result.generatedLyrics.slice(0, 3997) + '...'
        : result.generatedLyrics;
      replyPayload.embeds = [new EmbedBuilder().setTitle('Generated lyrics / structure').setDescription(truncated)];
    }

    await interaction.editReply(replyPayload);
  }
}

module.exports = MusicgenSlashCommand;
```

- [ ] **Step 2: Export from `commands/slash/index.js`**

In `commands/slash/index.js`, under the `// Media generation commands` block, add:

```js
  MusicgenSlashCommand: require('./MusicgenCommand'),
```

So the block reads:

```js
  // Media generation commands
  ImagineSlashCommand: require('./ImagineCommand'),
  VideogenSlashCommand: require('./VideogenCommand'),
  MusicgenSlashCommand: require('./MusicgenCommand'),
```

- [ ] **Step 3: Smoke-load the command in Node**

```bash
node -e "const C = require('./commands/slash/MusicgenCommand'); const c = new C({ isEnabled: () => false }); console.log(c.data.toJSON().name, c.data.toJSON().options.length);"
```

Expected: `musicgen 6` (1 prompt + 1 lyrics + 1 negative_prompt + 3 image slots).

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: All tests pass (no regressions).

- [ ] **Step 5: Commit**

```bash
git add commands/slash/MusicgenCommand.js commands/slash/index.js
git commit -m "feat(slash): add /musicgen command backed by LyriaService"
```

---

## Task 9: Wire LyriaService into bot.js

**Files:**
- Modify: `bot.js`

- [ ] **Step 1: Require LyriaService**

In `bot.js`, near the `VeoService` require (around line 25), add:

```js
const LyriaService = require('./services/LyriaService');
```

- [ ] **Step 2: Require the new slash command**

In `bot.js`, find the import block for slash commands (the same place `ImagineSlashCommand` / `VideogenSlashCommand` are imported). Add:

```js
const MusicgenSlashCommand = require('./commands/slash/MusicgenCommand');
```

(Use the same require path style as the existing slash command imports — match the file. If commands are imported from `./commands/slash` index, use that instead.)

- [ ] **Step 3: Instantiate the service**

In `bot.js`, immediately after the VeoService instantiation block (the `this.veoService = null; ... this.veoService = new VeoService(config, this.mongoService);` block around line 236), add:

```js
    this.lyriaService = null;
    try {
      if (config.lyria && config.lyria.enabled) {
        this.lyriaService = new LyriaService(config, this.costService);
      }
    } catch (err) {
      logger.error(`Failed to initialize LyriaService: ${err.message}`);
    }
```

- [ ] **Step 4: Register the slash command**

In `bot.js`, immediately after the VeoService slash registration (the `if (this.veoService) { ... }` block around line 398), add:

```js
    if (this.lyriaService && this.lyriaService.isEnabled()) {
      this.slashCommandHandler.register(new MusicgenSlashCommand(this.lyriaService));
    }
```

- [ ] **Step 5: Verify bot.js parses**

```bash
node --check bot.js
```

Expected: no output (syntactically valid).

- [ ] **Step 6: Run the full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add bot.js
git commit -m "feat(bot): wire LyriaService and /musicgen into the bot"
```

---

## Task 10: Update Kubernetes configmap

**Files:**
- Modify: `k8s/overlays/deployed/configmap.yaml`

- [ ] **Step 1: Add the env vars**

In `k8s/overlays/deployed/configmap.yaml`, append (near other media gen flags like `VEO_ENABLED` / `IMAGEGEN_ENABLED`):

```yaml
  # Music generation (Lyria 3 Pro)
  MUSICGEN_ENABLED: "true"
  LYRIA_MODEL: "lyria-3-pro-preview"
  LYRIA_PER_CALL_COST_USD: "0.06"
```

- [ ] **Step 2: Verify YAML parses**

```bash
python3 -c "import yaml; yaml.safe_load(open('k8s/overlays/deployed/configmap.yaml'))" && echo OK
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add k8s/overlays/deployed/configmap.yaml
git commit -m "k8s(config): enable MUSICGEN_ENABLED and Lyria pricing"
```

---

## Task 11: Documentation

**Files:**
- Modify: `features.md`
- Modify: `README.md`

- [ ] **Step 1: Update `features.md`**

Open `features.md` and add a new section at the appropriate point (alongside Imagen / Veo sections — match the file's existing ordering):

```markdown
## Music Generation (`/musicgen`)

Generate music with Google's Lyria 3 Pro (`lyria-3-pro-preview`).

**Inputs**
- `prompt` (required) — description of the music
- `lyrics` (optional) — supports `[Verse]` / `[Chorus]` / `[Bridge]` tags
- `negative_prompt` (optional) — things to avoid (e.g. "no vocals")
- `image1` / `image2` / `image3` (optional) — reference images for visual inspiration

**Output**
- MP3 audio attachment, multi-minute (duration controllable through the prompt)
- Generated lyrics / structure text rendered as an embed when the model returns it

**Config**
- `MUSICGEN_ENABLED=true`
- `LYRIA_MODEL` (default `lyria-3-pro-preview`)
- `LYRIA_PER_CALL_COST_USD` (default `0.06`, placeholder pending finalized Google pricing)
- `LYRIA_API_KEY` falls back to `GEMINI_API_KEY`

**Cost tracking**
- Each call is recorded through `CostService.recordMediaGen()` and rolled into `/stats`.

**TODO: Approach B refactor.** `ImagenService` / `VeoService` / `LyriaService` duplicate noticeable plumbing (enabled checks, image fetching, attachment construction, error shaping). Worth extracting a `MediaGenBase` once Lyria has soaked. See `docs/superpowers/specs/2026-05-15-lyria-music-generation-design.md` ("Approach B").
```

- [ ] **Step 2: Update `README.md`**

In the user-facing feature list, add a bullet next to the `/imagine` / `/videogen` entries:

```markdown
- `/musicgen` — AI music generation (Lyria 3 Pro)
```

- [ ] **Step 3: Commit**

```bash
git add features.md README.md
git commit -m "docs: document /musicgen and Lyria 3 integration"
```

---

## Task 12: Version bump, build, deploy, verify

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Confirm full test suite passes**

```bash
npm test
```

Expected: All tests green.

- [ ] **Step 2: Bump minor version**

```bash
npm version minor --no-git-tag-version
```

This is a new user-facing feature, so a minor bump. Note the new version (e.g. `2.13.0`).

- [ ] **Step 3: Commit the bump**

```bash
git add package.json package-lock.json
git commit -m "chore: bump version to <new-version>"
```

Replace `<new-version>` with the actual version.

- [ ] **Step 4: Build the Docker image (pinned tag — no `:latest`)**

The project pins images by git short-SHA per the no-latest-tags rule.

```bash
SHA=$(git rev-parse --short HEAD)
docker build -t mvilliger/discord-article-bot:$SHA .
```

- [ ] **Step 5: Push the image**

```bash
docker push mvilliger/discord-article-bot:$SHA
```

- [ ] **Step 6: Update `k8s/overlays/deployed/deployment.yaml`**

Edit the `bot` container `image:` field in `k8s/overlays/deployed/deployment.yaml` to `mvilliger/discord-article-bot:<short-sha>` (same SHA as Step 4).

- [ ] **Step 7: Apply configmap first, then deployment**

```bash
kubectl apply -f k8s/overlays/deployed/configmap.yaml -n discord-article-bot
kubectl set image deployment/discord-article-bot bot=mvilliger/discord-article-bot:$SHA -n discord-article-bot
kubectl rollout status deployment/discord-article-bot -n discord-article-bot --timeout=180s
```

Expected: rollout succeeds.

- [ ] **Step 8: Re-register slash commands so `/musicgen` shows up**

```bash
POD=$(kubectl get pod -n discord-article-bot -l app=discord-article-bot -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n discord-article-bot $POD -- node scripts/registerCommands.js
```

Expected: registration log lines including `musicgen`.

- [ ] **Step 9: Manual smoke test in Discord**

Press CTRL-R in Discord to force a slash-command refresh, then run:

1. `/musicgen prompt:"upbeat lo-fi study beat, 90 BPM"` — verify MP3 attachment within 1–3 min.
2. `/musicgen prompt:"a slow piano ballad" lyrics:"[Verse]\nfirst line\n[Chorus]\nrefrain"` — verify generated-lyrics embed.
3. `/musicgen prompt:"jazz trio" image1:<png>` — verify completion (visual influence is qualitative).
4. `/stats` — verify the Lyria call shows up in cumulative cost.

If any smoke test fails, capture pod logs:
```bash
kubectl logs -n discord-article-bot deployment/discord-article-bot --tail=200
```

- [ ] **Step 10: Push branch and open PR**

```bash
git push -u origin feat/lyria-music-generation
gh pr create --title "feat: add /musicgen Lyria 3 music generation" --body "$(cat <<'EOF'
## Summary
- New `/musicgen` slash command backed by `LyriaService` (`lyria-3-pro-preview`)
- Supports `prompt`, `lyrics`, `negative_prompt`, and up to 3 reference images
- `CostService.recordMediaGen()` tracks flat-fee media generation; rolled into `/stats`
- Approach B (shared `MediaGenBase` refactor) documented as a follow-up

## Spec
- docs/superpowers/specs/2026-05-15-lyria-music-generation-design.md

## Test plan
- [x] LyriaService unit tests (constructor, happy path, lyrics, negative prompt, reference images, error paths)
- [x] CostService.recordMediaGen unit tests
- [x] Full `npm test` green
- [x] Manual smoke tests in production Discord
- [x] `/stats` reflects Lyria cost

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Notes for the implementer

- **No `:latest` tags.** Always pin Docker tags to the git short-SHA (see project memory).
- **No log truncation.** When the Lyria API returns an error payload, log it in full.
- **TDD discipline.** Write the failing test, watch it fail, then implement. Do not skip the "watch it fail" step — that proves the test is actually exercising the new code.
- **Frequent commits.** Each task ends in a commit. Do not roll up multiple tasks into one commit.
- **Network egress.** Google's public Gemini API is already reachable from the cluster (Imagen uses it). No NetworkPolicy change needed.
- **SDK ambiguity.** Task 0's spike confirms the JS shape of `@google/genai` for Lyria. If the SDK surface differs from what's assumed in Task 4 (e.g., returns an operation handle requiring polling), pause and update Task 4 before proceeding.
