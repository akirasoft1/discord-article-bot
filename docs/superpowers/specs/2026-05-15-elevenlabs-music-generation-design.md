# ElevenLabs Music Generation — Design Spec

**Date:** 2026-05-15
**Status:** Draft, awaiting review
**Author:** Michael Villiger (with Claude)

## Goal

Add an A/B-comparison music-generation surface for the Discord bot using ElevenLabs' `POST /v1/music` (Compose Music) endpoint, exposed as a `/elevenmusic` slash command alongside the existing `/musicgen` (Lyria) command. The user finds Lyria's output unsatisfying and wants a parallel option to evaluate.

## Non-goals

- Replace Lyria. Both providers ship side by side; the user picks per call.
- Surface ElevenLabs voice cloning, TTS, sound effects, or conversational agents. Music only.
- Implement ElevenLabs' inpainting / store-for-inpainting feature (`store_for_inpainting=true`).
- Implement multi-section `composition_plan` authoring as a first-class surface. Lyrics use a single-section composition plan transparently behind the scenes; multi-section authoring is a future enhancement if useful.
- A combined `/musicgen-compare` command that fires both providers with the same prompt. Useful, but a follow-up.
- Reference images (ElevenLabs Music doesn't support them).

## Approach

**Approach A (selected): Mirror `LyriaService`.** New `ElevenLabsMusicService` + `ElevenmusicSlashCommand` pair, same shape as Lyria. Wired into `bot.js` and `scripts/registerCommands.js` next to the existing media-gen services.

**Approach B (deferred, still tracked):** Extract a shared `MediaGenBase` covering the common plumbing now duplicated across Imagen, Veo, Lyria, and (post-this-spec) ElevenLabs. The argument for this gets stronger every time we ship a media gen service. Tracked as a follow-up note in `features.md` and the existing header comment in `LyriaService.js`.

**Approach C (rejected):** Stuff ElevenLabs into `LyriaService` as a provider backend. Breaks isolation and makes both services harder to test.

## File layout

```
services/ElevenLabsMusicService.js          (new)
commands/slash/ElevenmusicCommand.js        (new)
__tests__/services/ElevenLabsMusicService.test.js (new)
config/config.js                            (modified — adds `elevenlabs` block)
services/CostService.js                     (modified — adds 'elevenlabs-music-v1' to mediaPricing map)
__tests__/services/CostService.test.js      (modified — 1 new test for the new pricing entry)
commands/slash/index.js                     (modified — exports ElevenmusicSlashCommand)
bot.js                                      (modified — instantiates service + registers slash command)
scripts/registerCommands.js                 (modified — includes ElevenmusicSlashCommand under config.elevenlabs?.enabled)
k8s/overlays/deployed/configmap.yaml        (modified, gitignored — ELEVENMUSIC_ENABLED, ELEVENLABS_MUSIC_MODEL, ELEVENLABS_PER_CALL_COST_USD)
k8s/overlays/deployed/secret.yaml           (modified, gitignored — ELEVENLABS_API_KEY)
features.md                                 (modified — new section)
README.md                                   (modified — /elevenmusic mention)
package.json                                (modified — adds @elevenlabs/elevenlabs-js dep)
```

No NetworkPolicy change needed — `api.elevenlabs.io` is public-internet HTTPS and the existing policy already allows outbound to public Google APIs / OpenAI / etc. via the same egress rule.

## Dependency on in-flight PR #78

PR #78 (the `scripts/registerCommands.js` global-and-guild fix) was open at the time of writing. This work assumes PR #78 lands first, or rebases on top of it. If PR #78 is still open when implementation begins, the implementer either waits or pulls the fix in as part of this change (the conflict resolution is trivial — both PRs touch the same import block).

## Command surface

| Option | Type | Required | Notes |
|---|---|---|---|
| `prompt` | string (≤6000) | yes | Description of music to generate |
| `duration` | integer (3–600) | no | Seconds. Default `90` (matches Lyria Pro for apples-to-apples comparison). Forwarded as `music_length_ms = duration * 1000` |
| `instrumental` | boolean | no | `true` → `force_instrumental: true`. Default false |
| `lyrics` | string (≤6000) | no | If non-empty, the service switches to ElevenLabs' `composition_plan` mode under the hood (the only API path that accepts lyrics). Note: `instrumental:true` is silently ignored when lyrics are provided (the two are contradictory and ElevenLabs' `force_instrumental` is prompt-mode-only) |

- `cooldown: 60` seconds (matches `/musicgen`)
- `deferReply: true` (ElevenLabs Music returns in ~10–60s depending on length)
- Initial reply: `"Generating music with ElevenLabs... (this may take 10–60 seconds)\n**Prompt:** {prompt}"`

## Data flow

```
User → /elevenmusic prompt:"..." duration:30 instrumental:true
   ↓
ElevenmusicCommand.execute:
   ├─ if (!service || !service.isEnabled()) → sendError("Music generation is not enabled.")
   ├─ read prompt, duration (default 90), instrumental (default false), lyrics (optional)
   ├─ interaction.editReply("Generating music with ElevenLabs...")
   └─ elevenLabsMusicService.generateMusic(prompt, {durationSeconds, instrumental, lyrics}, user)
        ↓
   ElevenLabsMusicService.generateMusic:
   ├─ if (!isEnabled()) return {success:false, error:"…not enabled."}
   ├─ if (lyrics provided and non-empty):
   │     // ElevenLabs' `forceInstrumental` is prompt-mode-only and contradicts having lyrics anyway.
   │     // If the user also set `instrumental:true`, log a warning and drop it; lyrics imply vocals.
   │     if (instrumental) logger.warn('elevenmusic: ignoring instrumental=true because lyrics were provided')
   │     compositionPlan = {
   │       sections: [{
   │         sectionName: "main",
   │         positiveLocalStyles: [prompt],
   │         negativeLocalStyles: [],
   │         durationMs: durationSeconds * 1000,
   │         lines: splitLyricsIntoMaxLines(lyrics, 200)
   │       }]
   │     }
   │     // SDK uses camelCase for all request fields, NOT the snake_case shown in the
   │     // REST docs. composeDetailed() returns { audio: Buffer } directly.
   │     response = await client.music.composeDetailed({
   │       compositionPlan,
   │       modelId: config.elevenlabs.model
   │     })
   │ else:
   │     response = await client.music.composeDetailed({
   │       prompt,
   │       musicLengthMs: durationSeconds * 1000,
   │       modelId: config.elevenlabs.model,
   │       forceInstrumental: instrumental
   │     })
   ├─ collect raw audio bytes (SDK returns a Buffer or Readable; concat as needed)
   ├─ costService?.recordMediaGen('elevenlabs-music-v1', user)
   └─ return {success:true, buffer, mimeType:"audio/mpeg"}
        ↓
   ElevenmusicCommand:
   ├─ on success → editReply with AttachmentBuilder(buffer, name:"generated-music-<ts>.mp3")
   └─ on failure → sendError(result.error)
```

### Public service signature

```js
async generateMusic(prompt, options = {}, user = null)
// options: { lyrics?: string, durationSeconds?: number, instrumental?: boolean }
// returns: { success, buffer?, mimeType?, error? }
```

### Lyrics line-splitting helper

ElevenLabs caps each `lines[i]` at 200 characters. The service splits internally:

1. Split on `\n` first (preserves the user's intended line breaks).
2. For any resulting line over 200 chars, word-wrap at the nearest space ≤200 chars.
3. Drop empty lines.

Keeps the slash command surface free of "your line is too long" errors and matches the user-friendly approach Lyria uses.

## Error handling

All failures return `{success:false, error}` — never throw to the command layer.

| Failure | Surfaced as |
|---|---|
| `ELEVENMUSIC_ENABLED !== 'true'` | "Music generation is not enabled on this bot." |
| Missing `ELEVENLABS_API_KEY` at construct time | Service marks itself disabled; startup warning logged |
| `duration` < 3 or > 600 | Slash-command validation catches at Discord's option layer (`setMinValue(3).setMaxValue(600)`). Should never reach the service. |
| ElevenLabs 4xx (validation / safety block) | "Music generation rejected: \<API message verbatim\>" |
| ElevenLabs 5xx / timeout | "Music generation failed: \<message\>" + full payload logged |
| Empty audio body in response | "Music generation completed but no audio data was returned." |
| SDK throws synchronously | Caught, surfaced as success-false with the error message |

Errors are logged in full — no truncation (project preference).

## CostService extension

`CostService.mediaPricing` already exists. Add one entry:

```js
this.mediaPricing = {
  'lyria-3-pro-preview': 0.06,
  'elevenlabs-music-v1': 0.10,   // placeholder pending finalized pricing
};
```

`ElevenLabsMusicService` instantiates its own `CostService` instance (matching the existing per-consumer pattern; the Approach B refactor will hoist this).

`LYRIA_PER_CALL_COST_USD` pattern is repeated: `ELEVENLABS_PER_CALL_COST_USD` env var override is applied into `mediaPricing` during service construction.

## Config additions

### `config/config.js`

```js
elevenlabs: {
  enabled: process.env.ELEVENMUSIC_ENABLED === 'true',
  apiKey: process.env.ELEVENLABS_API_KEY || '',
  model: process.env.ELEVENLABS_MUSIC_MODEL || 'music_v1',
  defaultDurationSeconds: parseInt(process.env.ELEVENLABS_DEFAULT_DURATION_SECONDS || '90', 10),
  cooldownSeconds: parseInt(process.env.ELEVENLABS_COOLDOWN_SECONDS || '60', 10),
  perCallCostUsd: parseFloat(process.env.ELEVENLABS_PER_CALL_COST_USD || '0.10')
}
```

### `k8s/overlays/deployed/configmap.yaml`

```yaml
ELEVENMUSIC_ENABLED: "true"
ELEVENLABS_MUSIC_MODEL: "music_v1"
ELEVENLABS_PER_CALL_COST_USD: "0.10"
```

### `k8s/overlays/deployed/secret.yaml`

```yaml
ELEVENLABS_API_KEY: "<base64-encoded key>"
```

(File is gitignored; the user has the key value to paste in.)

## Testing strategy

### `__tests__/services/ElevenLabsMusicService.test.js` (new)

Modeled on `LyriaService.test.js`. Covers:

- **Constructor**: enabled / disabled by config; missing API key → disabled, warning logged; correct ElevenLabsClient instantiation; per-call cost override applied to CostService.
- **`generateMusic()` happy path (prompt mode)**: returns `{success:true, buffer, mimeType:'audio/mpeg'}` and forwards prompt, `music_length_ms`, `model_id`, `force_instrumental`.
- **`generateMusic()` lyrics path (composition_plan mode)**: switches to composition_plan, builds the correct single-section structure, forwards lyrics as `lines` after splitting.
- **Default duration**: `durationSeconds` defaults to `config.elevenlabs.defaultDurationSeconds` (90) when not provided.
- **Lyrics line splitting**: long single-line input is word-wrapped at 200 chars; pre-broken input preserves user's `\n` boundaries; empty lines dropped.
- **`force_instrumental: false` by default**, `true` when option set.
- **Disabled service**: returns success-false without calling the SDK or recording cost.
- **4xx / 5xx SDK errors**: returns success-false with the API message verbatim; cost NOT recorded.
- **Empty audio body**: returns success-false; cost NOT recorded.
- **CostService.recordMediaGen** called with `'elevenlabs-music-v1'` on success.
- **`isEnabled()` reflects `config.elevenlabs.enabled`.**

### `__tests__/services/CostService.test.js` (extended)

One additional test asserting `recordMediaGen('elevenlabs-music-v1', user)` works against the seeded `mediaPricing` entry.

### Slash command unit tests

Still no slash-command unit test pattern in the project. `ElevenmusicCommand` is verified via manual smoke test post-deploy. **TODO**: introduce slash-command unit tests as a separate cleanup.

### Manual smoke test (post-deploy)

1. `/elevenmusic prompt:"upbeat lo-fi study beat, 90 BPM"` — MP3 attachment within ~30s.
2. `/elevenmusic prompt:"jazz trio" duration:15 instrumental:true` — short, instrumental result.
3. `/elevenmusic prompt:"folk ballad" lyrics:"[Verse]\nFirst line\nSecond line\n[Chorus]\nRefrain"` — verify composition_plan path; lyrics appear in audio.
4. `/elevenmusic prompt:"..."` with `ELEVENMUSIC_ENABLED=false` — clean error.
5. Pod logs after a generation show `Media gen recorded - model: elevenlabs-music-v1, ...`.
6. Side-by-side: run the same `prompt` against `/musicgen` (Lyria) and `/elevenmusic` (ElevenLabs). Subjective compare is the whole point of this feature.

## Open questions / risks

- **SDK shape**: `@elevenlabs/elevenlabs-js` exposes a `.music.compose()` method per the docs. Implementation step 1 confirms the exact response shape (Buffer vs Readable, MIME type field, error envelope). If it diverges from this spec, the implementer pauses and updates Task 4 before continuing.
- **Pricing placeholder**: `ELEVENLABS_PER_CALL_COST_USD=0.10` is a guess. ElevenLabs charges per generation duration; verify against billing before relying on the number.
- **Music model evolution**: `model_id` is configurable via env so we can switch to future ElevenLabs models without a code change.
- **PR #78 dependency**: ensure `scripts/registerCommands.js` has the dual-target (global + test guild) registration fix in place before merging this. Otherwise `/elevenmusic` registers only to the test guild.

## Approach B (deferred follow-up, still tracked)

The case for `MediaGenBase` is now even stronger — four services share the same plumbing (`ImagenService`, `VeoService`, `LyriaService`, `ElevenLabsMusicService`). After this PR, lift:
- Common `deferReply` + progress-edit handling
- Shared attachment construction
- Unified `isEnabled()` and `recordMediaGen()` wiring
- Hoist a single `CostService` instance into `bot.js` and inject into every consumer

Update `features.md` to list all four services and the deferral. Update the existing `// TODO(media-gen-refactor):` header comment in `LyriaService.js` to reference the now-four-service redundancy. Add a similar comment to the new `ElevenLabsMusicService.js`.
