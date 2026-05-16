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
