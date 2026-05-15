# Lyria 3 Music Generation — Design Spec

**Date:** 2026-05-15
**Status:** Draft, awaiting review
**Author:** Michael Villiger (with Claude)

## Goal

Add AI music generation to the Discord bot via Google's Lyria 3 Pro model (`lyria-3-pro-preview`), exposed as a `/musicgen` slash command. Mirrors the existing `/imagine` (Imagen) and `/videogen` (Veo) feature shape.

## Non-goals

- Lyria RealTime streaming. Out of scope; this is single-turn batch generation only.
- The Clip model (`lyria-3-clip-preview`). Pro-only for now.
- Iterative refinement / edit-on-prior-output. Lyria 3 is single-turn by design.
- Channel-voice / agent-sandbox integration. Slash command only.
- Format selection (MP3/WAV). Default MP3.

## Approach

**Approach A (selected): Mirror `VeoService`.** A new `LyriaService` + `MusicgenCommand` pair that follows the same shape as Veo/Imagen. Fastest path; zero refactor risk to working features.

**Approach B (deferred, documented as TODO):** Extract a shared `MediaGenBase` covering the common plumbing in Imagen/Veo/Lyria (deferReply progress edits, attachment building, enabled-check, user/error shaping). Worth doing once Lyria lands and there are three concrete implementations to compare. Tracked as a follow-up note in `features.md` and a header comment in `LyriaService.js`.

**Approach C (rejected):** Routing through the agent sandbox. Lyria returns binary audio synchronously; the sandbox's stdout/exit-code contract is a poor fit.

## File layout

```
services/LyriaService.js
commands/slash/MusicgenCommand.js
__tests__/services/LyriaService.test.js
__tests__/services/CostService.test.js          # new cases for recordMediaGen()
config/config.js                                # adds `lyria: { ... }` block
k8s/overlays/deployed/configmap.yaml            # MUSICGEN_ENABLED, LYRIA_MODEL, LYRIA_PER_CALL_COST_USD
features.md                                     # new section
README.md                                       # /musicgen mention
```

No NetworkPolicy change needed — Google's public AI API egress is already permitted (Imagen/Veo use it).

## Command surface

| Option | Type | Required | Notes |
|---|---|---|---|
| `prompt` | string (≤1000) | yes | Description of music to generate |
| `lyrics` | string (≤2000) | no | Supports `[Verse]`/`[Chorus]`/`[Bridge]` tags; passed verbatim |
| `negative_prompt` | string (≤500) | no | Things to avoid; composed into the prompt text as "Avoid: <neg>" because Lyria 3 has no structured negative_prompt API field |
| `image1` / `image2` / `image3` | attachment | no | PNG/JPEG/GIF/WebP; same MIME validation as VideogenCommand |

- `cooldown: 60` seconds (matches `/videogen`)
- `deferReply: true` (Pro takes 1–3 minutes)
- Initial reply: "Generating music... This may take a few minutes."

## Data flow

```
User → /musicgen prompt:"..." lyrics:"..." image1:foo.png
   ↓
MusicgenCommand.execute:
   ├─ validate attachment MIME types → sendError on bad MIME
   ├─ interaction.editReply("Generating music...")
   └─ lyriaService.generateMusic(prompt, {lyrics, negativePrompt, imageUrls}, user, onProgress)
        ↓
   LyriaService.generateMusic:
   ├─ if (!enabled) return {success:false, error:"Music generation is not enabled."}
   ├─ fetch each imageUrl → base64 inlineData parts (drop failures, log warning)
   ├─ build contents: [prompt text, optional lyrics block, image parts]
   ├─ genaiClient.models.generateContent({
   │      model: 'lyria-3-pro-preview',
   │      contents
   │   })
   │   (negativePrompt is composed into the prompt text, not a structured API field)
   ├─ extract audio bytes from inlineData parts where mimeType ~ 'audio/'
   ├─ extract generated-lyrics text part if present
   ├─ costService.recordMediaGen('lyria-3-pro-preview', user)
   └─ return {success:true, buffer, mimeType, generatedLyrics?}
        ↓
   MusicgenCommand:
   ├─ on success → editReply with AttachmentBuilder + generated-lyrics text/embed
   └─ on failure → sendError(result.error)
```

### Public service signature

```js
async generateMusic(prompt, options = {}, user, onProgress)
// options: { lyrics?: string, negativePrompt?: string, imageUrls?: string[] }
// returns: { success, buffer?, mimeType?, generatedLyrics?, error? }
```

## Error handling

All failures return `{success:false, error}` — never throw to the command layer.

| Failure | Surfaced as |
|---|---|
| `MUSICGEN_ENABLED !== 'true'` | "Music generation is not enabled on this bot." |
| Missing/invalid `GEMINI_API_KEY` at construct time | Service marks itself disabled; startup warning logged |
| One of N image fetches fails | Log warning, drop that image, continue |
| All requested image fetches fail | "Could not fetch reference images." |
| Image >10MB | "Reference image too large (max 10MB)." (pre-flight, per-image) |
| Bad MIME | "Reference images must be PNG, JPEG, GIF, or WebP." (command layer) |
| Lyria 4xx (rejection / safety block) | "Music generation rejected: \<API message verbatim\>" |
| Lyria 5xx / timeout | "Music generation failed: \<message\>" + full payload logged |
| No audio bytes in response | "Music generation completed but no audio data was returned." |

Errors are logged in full — no truncation (project preference).

## CostService extension

Today `CostService` is a log-helper: each consumer service (currently `SummarizationService`) instantiates its own copy and uses it to log per-call and cumulative costs. `/stats` does **not** read from CostService — it reads from MongoDB's token-usage records (`mongoService.getTokenUsageLeaderboard`).

For media gen:

- Add `recordMediaGen(modelKey, user)` method on `CostService`.
- Add a `MEDIA_GEN_COSTS` map: `{ 'lyria-3-pro-preview': 0.06, ... }` (placeholder pricing — TBD when Google publishes).
- Track in a new `cumulative.media = { total, calls, byModel }` accumulator.
- Surface the totals via the existing `logCumulative()` log line.
- `LyriaService` instantiates its own `CostService` (matching the existing per-consumer pattern). This keeps the change small and avoids touching `SummarizationService`'s constructor.
- New unit tests in `CostService.test.js`.

**Follow-up TODOs** (gated behind the Approach B refactor):
- Hoist a single `CostService` instance into `bot.js` and inject it into every consumer (SummarizationService, LyriaService, future Imagen/Veo wiring).
- Record media-gen rows in MongoDB so `/stats` can surface them alongside token usage.
- Wire `ImagenService` and `VeoService` through `recordMediaGen()` once pricing is confirmed.

## Config additions

### `config/config.js`

```js
lyria: {
  enabled: process.env.MUSICGEN_ENABLED === 'true',
  apiKey: process.env.LYRIA_API_KEY || process.env.GEMINI_API_KEY,
  model: process.env.LYRIA_MODEL || 'lyria-3-pro-preview',
  maxImagesPerRequest: 3,
  perCallCostUsd: parseFloat(process.env.LYRIA_PER_CALL_COST_USD || '0.06'),
}
```

### `k8s/overlays/deployed/configmap.yaml`

```yaml
MUSICGEN_ENABLED: "true"
LYRIA_MODEL: "lyria-3-pro-preview"
LYRIA_PER_CALL_COST_USD: "0.06"
```

`LYRIA_API_KEY` falls back to `GEMINI_API_KEY` (same Google AI Studio credential).

## Testing strategy

### `__tests__/services/LyriaService.test.js` (new)

Modeled on `VeoService.test.js`. Covers:

- Constructor: enabled / disabled by config; missing API key → disabled, warning logged.
- `generateMusic()` happy path: returns `{success:true, buffer, mimeType:'audio/mpeg'}`.
- With lyrics: lyrics string is included in `contents`.
- With negative prompt: composed into the prompt text.
- With reference images (0, 1, 3): URLs fetched, base64-encoded, included as `inlineData` parts.
- Image fetch failures: partial → continue with warning; all → success-false.
- API 4xx: returns `{success:false, error}` with verbatim API message.
- API 5xx / timeout: returns success-false, full payload logged.
- No audio in response: canned success-false message.
- Generated lyrics text returned: surfaced as `result.generatedLyrics`.
- CostService: `recordMediaGen('lyria-3-pro-preview', user)` called on success, not on failure.
- `isEnabled()` reflects `config.lyria.enabled`.

### `__tests__/services/CostService.test.js` (extended)

New cases for `recordMediaGen(modelKey, user)`: per-call cost lookup, cumulative update, unknown modelKey behavior.

### Slash command unit tests

No existing pattern under `__tests__/commands/slash/`. `MusicgenCommand` will not get unit tests in this iteration — service tests + manual smoke test below cover it. **TODO**: introduce slash-command unit tests as a separate cleanup.

### Manual smoke test (post-deploy)

1. `/musicgen prompt:"upbeat lo-fi study beat, 90 BPM"` — returns MP3 within 1–3 min.
2. `/musicgen prompt:"..." lyrics:"[Verse]..."` — generated-lyrics text appears in reply.
3. `/musicgen prompt:"..." image1:<png>` — reference image honored.
4. `/musicgen prompt:"..."` with `MUSICGEN_ENABLED=false` — clean error.
5. Check the bot pod logs (`kubectl logs deployment/discord-article-bot -n discord-article-bot --tail=200`) for a `Media gen recorded` line confirming the Lyria call landed in CostService.

   Note: `/stats` reads MongoDB token-usage records and will NOT show media-gen costs today. Surfacing media-gen in `/stats` is part of the Approach B refactor.

## Open questions / risks

- **Lyria 3 SDK shape**: docs example uses `client.models.generate_content` (Python). The JS `@google/genai` SDK should expose the same surface, but we haven't yet verified the exact JS signature for audio-returning models. Implementation step 1 is a 10-line spike confirming the response shape; design adjusts if the SDK exposes a different path (e.g., a dedicated `generateMusic` endpoint or a long-running operation).
- **Pricing placeholder**: `LYRIA_PER_CALL_COST_USD=0.06` is a guess. Confirm with Google AI Studio pricing before public rollout.
- **Long generation timeouts**: at 1–3 minutes, the Discord interaction token (15-minute window) is fine, but if Google ever returns a long-running operation we'll need polling like VeoService. Code defensively for both paths.

## Approach B (deferred follow-up)

After Lyria ships, refactor Imagen + Veo + Lyria to share a `MediaGenBase`:
- Common deferReply / progress-edit handling
- Shared attachment construction
- Unified `isEnabled()` and `recordMediaGen()` wiring
- Drives consistent error messages across all three commands

Track in `features.md` and as a `// TODO(media-gen-refactor):` header comment in `LyriaService.js`.
