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

  // options: { lyrics?, negativePrompt?, imageUrls? } — fields are read by future tasks.
  async generateMusic(prompt, options = {}, user = null) {
    if (!this.isEnabled()) {
      return { success: false, error: 'Music generation is not enabled on this bot.' };
    }

    const { lyrics, negativePrompt } = options;

    // Lyria 3 has no structured negative_prompt API field — compose it into the prompt text.
    let promptText = prompt;
    if (negativePrompt && negativePrompt.trim().length > 0) {
      promptText = `${prompt}\n\nAvoid: ${negativePrompt.trim()}`;
    }

    const contents = [{ text: promptText }];
    if (lyrics && lyrics.trim().length > 0) {
      contents.push({ text: `Lyrics:\n${lyrics}` });
    }

    let response;
    try {
      response = await this.client.models.generateContent({
        model: this.config.lyria.model,
        contents
      });
    } catch (err) {
      logger.error('Lyria generateContent failed', { error: err });
      return { success: false, error: `Music generation failed: ${err.message}` };
    }

    const parts = response?.candidates?.[0]?.content?.parts || [];
    const audioPart = parts.find((p) =>
      p.inlineData &&
      typeof p.inlineData.data === 'string' &&
      p.inlineData.data.length > 0 &&
      (p.inlineData.mimeType || '').startsWith('audio/')
    );
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
}

module.exports = LyriaService;
