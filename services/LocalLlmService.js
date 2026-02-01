// services/LocalLlmService.js
const OpenAI = require('openai');
const logger = require('../logger');
const config = require('../config/config');
const { withSpan } = require('../tracing');

/**
 * LocalLlmService - Handles local LLM inference via Ollama
 *
 * This service provides uncensored chat functionality by routing
 * requests to a locally-hosted Ollama instance instead of cloud providers.
 */
class LocalLlmService {
  constructor() {
    this.client = null;
    this.initialized = false;
  }

  /**
   * Initialize the local LLM service
   * @returns {Promise<boolean>} True if initialization succeeded
   */
  async initialize() {
    if (!config.localLlm.enabled) {
      logger.info('Local LLM service is disabled');
      return false;
    }

    try {
      this.client = new OpenAI({
        baseURL: config.localLlm.baseUrl,
        apiKey: config.localLlm.apiKey,
      });

      // Test connection with a health check
      await this.healthCheck();
      this.initialized = true;
      logger.info(`Local LLM service initialized with model: ${config.localLlm.model}`);
      return true;
    } catch (error) {
      logger.error('Failed to initialize Local LLM service:', error);
      this.initialized = false;
      return false;
    }
  }

  /**
   * Check if Ollama is running and the model is available
   * @returns {Promise<boolean>} True if healthy
   */
  async healthCheck() {
    try {
      // Ollama's API endpoint (remove /v1 suffix for native API)
      const ollamaBaseUrl = config.localLlm.baseUrl.replace('/v1', '');
      const response = await fetch(`${ollamaBaseUrl}/api/tags`);

      if (!response.ok) {
        throw new Error(`Ollama health check failed: ${response.status}`);
      }

      const data = await response.json();
      const modelName = config.localLlm.model.split(':')[0];
      const modelExists = data.models?.some(m => m.name.includes(modelName));

      if (!modelExists) {
        logger.warn(`Configured model ${config.localLlm.model} may not be available in Ollama. Available models: ${data.models?.map(m => m.name).join(', ') || 'none'}`);
      }

      return true;
    } catch (error) {
      logger.error('Local LLM health check failed:', error.message);
      throw error;
    }
  }

  /**
   * Check if the service is available for use
   * @returns {boolean}
   */
  isAvailable() {
    return this.initialized && config.localLlm.enabled;
  }

  /**
   * Check if uncensored mode is enabled globally
   * @returns {boolean}
   */
  isEnabled() {
    return this.isAvailable() && config.localLlm.uncensored.enabled;
  }

  /**
   * Check if uncensored mode is allowed for the given context
   * @param {string} channelId - Discord channel ID
   * @param {string} userId - Discord user ID
   * @param {boolean} isNsfwChannel - Whether the channel is marked NSFW
   * @returns {{allowed: boolean, reason: string|null}}
   */
  checkUncensoredAccess(channelId, userId, isNsfwChannel = false) {
    const uncensoredConfig = config.localLlm.uncensored;

    // Check if uncensored mode is enabled globally
    if (!uncensoredConfig.enabled) {
      return { allowed: false, reason: 'Uncensored mode is disabled by administrator' };
    }

    // Check if local LLM service is available
    if (!this.isAvailable()) {
      return { allowed: false, reason: 'Local LLM service is not available' };
    }

    // Check NSFW requirement
    if (uncensoredConfig.requireNsfw && !isNsfwChannel) {
      return { allowed: false, reason: 'Uncensored mode is only available in NSFW channels' };
    }

    // Check blocked channels (takes precedence)
    if (uncensoredConfig.blockedChannels.length > 0 &&
        uncensoredConfig.blockedChannels.includes(channelId)) {
      return { allowed: false, reason: 'Uncensored mode is not available in this channel' };
    }

    // Check allowed channels (if specified, channel must be in list)
    if (uncensoredConfig.allowedChannels.length > 0 &&
        !uncensoredConfig.allowedChannels.includes(channelId)) {
      return { allowed: false, reason: 'Uncensored mode is not enabled for this channel' };
    }

    // Check allowed users (if specified, user must be in list)
    if (uncensoredConfig.allowedUsers.length > 0 &&
        !uncensoredConfig.allowedUsers.includes(userId)) {
      return { allowed: false, reason: 'You do not have permission to use uncensored mode' };
    }

    return { allowed: true, reason: null };
  }

  /**
   * Generate a chat completion using the local LLM
   * @param {Array<{role: string, content: string}>} messages - Chat messages
   * @param {object} options - Optional overrides for model parameters
   * @returns {Promise<string>} The generated response
   */
  async generateCompletion(messages, options = {}) {
    if (!this.isAvailable()) {
      throw new Error('Local LLM service is not available');
    }

    const model = options.model || config.localLlm.model;
    const temperature = options.temperature ?? config.localLlm.temperature;
    const topP = options.topP ?? config.localLlm.topP;
    const maxTokens = options.maxTokens ?? config.localLlm.maxTokens;

    return withSpan('localLlm.generateCompletion', {
      'llm.model': model,
      'llm.messages.count': messages.length,
      'llm.temperature': temperature,
      'llm.maxTokens': maxTokens,
    }, async () => {
      try {
        logger.debug(`Local LLM request - Model: ${model}, Messages: ${messages.length}`);

        const completion = await this.client.chat.completions.create({
          model,
          messages,
          temperature,
          top_p: topP,
          max_tokens: maxTokens,
        });

        const response = completion.choices[0]?.message?.content?.trim();

        if (!response) {
          throw new Error('Empty response from local LLM');
        }

        logger.debug(`Local LLM response received - Length: ${response.length} chars`);
        return response;
      } catch (error) {
        logger.error('Local LLM generation error:', error.message);
        throw error;
      }
    });
  }

  /**
   * Generate with streaming (for future use with typing indicators)
   * @param {Array<{role: string, content: string}>} messages - Chat messages
   * @param {object} options - Optional overrides for model parameters
   * @yields {string} Chunks of the response
   */
  async *generateCompletionStream(messages, options = {}) {
    if (!this.isAvailable()) {
      throw new Error('Local LLM service is not available');
    }

    const model = options.model || config.localLlm.model;

    const stream = await this.client.chat.completions.create({
      model,
      messages,
      temperature: options.temperature ?? config.localLlm.temperature,
      top_p: options.topP ?? config.localLlm.topP,
      max_tokens: options.maxTokens ?? config.localLlm.maxTokens,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }
}

// Export singleton instance
module.exports = new LocalLlmService();
