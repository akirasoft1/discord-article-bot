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
      // NOTE: The @elevenlabs/elevenlabs-js SDK uses camelCase for all request
      // fields, NOT the snake_case shown in the REST docs.
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

    const buffer = response?.audio;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      return { success: false, error: 'Music generation completed but no audio data was returned.' };
    }

    this.costService?.recordMediaGen('elevenlabs-music-v1', user);

    return { success: true, buffer, mimeType: 'audio/mpeg' };
  }

  // ElevenLabs caps each compositionPlan section's `lines[i]` at 200 characters.
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
}

module.exports = ElevenLabsMusicService;
