// services/LyriaService.js
// TODO(media-gen-refactor): Imagen/Veo/Lyria duplicate noticeable plumbing
// (enabled checks, image fetching, error shaping, attachment handling).
// Consider extracting a MediaGenBase once all three are stable.
// See docs/superpowers/specs/2026-05-15-lyria-music-generation-design.md ("Approach B").

const { GoogleGenAI } = require('@google/genai');
const logger = require('../logger');

class LyriaService {
  // Unlike ImagenService (which throws on disabled state), LyriaService
  // constructs successfully when disabled and exposes isEnabled() so callers
  // can check runtime availability without try/catch. Future MediaGenBase
  // refactor (Approach B in the spec) will reconcile the two patterns.
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
