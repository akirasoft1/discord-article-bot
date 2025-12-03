// services/ImagenService.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../logger');

// Valid aspect ratios supported by Gemini image generation
const VALID_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

class ImagenService {
  constructor(config) {
    this.config = config;

    // Validate configuration
    if (!config.imagen.enabled) {
      throw new Error('Image generation is disabled');
    }

    if (!config.imagen.apiKey) {
      throw new Error('GEMINI_API_KEY is required for image generation');
    }

    // Initialize Google Generative AI client
    this.genAI = new GoogleGenerativeAI(config.imagen.apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: config.imagen.model,
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE']
      }
    });

    // Cooldown tracking: Map of userId -> timestamp when cooldown expires
    this.cooldowns = new Map();

    logger.info(`ImagenService initialized with model: ${config.imagen.model}`);
  }

  /**
   * Validate a prompt before generation
   * @param {string} prompt - The prompt to validate
   * @returns {{valid: boolean, error?: string}}
   */
  validatePrompt(prompt) {
    if (!prompt || prompt.trim().length === 0) {
      return { valid: false, error: 'Prompt cannot be empty' };
    }

    const trimmedPrompt = prompt.trim();
    const maxLength = this.config.imagen.maxPromptLength;

    if (trimmedPrompt.length > maxLength) {
      return {
        valid: false,
        error: `Prompt exceeds maximum length of ${maxLength} characters (current: ${trimmedPrompt.length})`
      };
    }

    return { valid: true };
  }

  /**
   * Validate an aspect ratio
   * @param {string} aspectRatio - The aspect ratio to validate
   * @returns {{valid: boolean, error?: string}}
   */
  validateAspectRatio(aspectRatio) {
    if (!VALID_ASPECT_RATIOS.includes(aspectRatio)) {
      return {
        valid: false,
        error: `Invalid aspect ratio: ${aspectRatio}. Valid options: ${VALID_ASPECT_RATIOS.join(', ')}`
      };
    }

    return { valid: true };
  }

  /**
   * Generate an image from a text prompt
   * @param {string} prompt - Text description of the desired image
   * @param {Object} options - Generation options
   * @param {string} options.aspectRatio - Aspect ratio (default: config default)
   * @param {Object} user - Discord user object for tracking
   * @returns {Promise<{success: boolean, buffer?: Buffer, mimeType?: string, error?: string, prompt?: string}>}
   */
  async generateImage(prompt, options = {}, user = null) {
    // Validate prompt
    const promptValidation = this.validatePrompt(prompt);
    if (!promptValidation.valid) {
      return { success: false, error: promptValidation.error };
    }

    // Validate and set aspect ratio
    const aspectRatio = options.aspectRatio || this.config.imagen.defaultAspectRatio;
    const ratioValidation = this.validateAspectRatio(aspectRatio);
    if (!ratioValidation.valid) {
      return { success: false, error: ratioValidation.error };
    }

    const trimmedPrompt = prompt.trim();

    try {
      logger.info(`Generating image for prompt: "${trimmedPrompt.substring(0, 50)}..." with aspect ratio: ${aspectRatio}`);

      // Build the request with aspect ratio hint in the prompt
      const enhancedPrompt = `${trimmedPrompt}\n\nAspect ratio: ${aspectRatio}`;

      const result = await this.model.generateContent({
        contents: [{
          role: 'user',
          parts: [{ text: enhancedPrompt }]
        }]
      });

      const response = result.response;

      // Check for empty response
      if (!response.candidates || response.candidates.length === 0) {
        logger.warn('No candidates in image generation response');
        return { success: false, error: 'No image was generated. Please try a different prompt.' };
      }

      const candidate = response.candidates[0];

      // Check for safety filter rejection
      if (candidate.finishReason === 'SAFETY') {
        logger.warn(`Image generation blocked by safety filter for prompt: "${trimmedPrompt.substring(0, 50)}..."`);
        return {
          success: false,
          error: 'Your prompt was blocked by safety filters. Please try a different prompt.'
        };
      }

      // Extract image data from response
      const content = candidate.content;
      if (!content || !content.parts) {
        logger.warn('No content parts in image generation response');
        return { success: false, error: 'No image was generated. Please try a different prompt.' };
      }

      // Find the image part in the response
      const imagePart = content.parts.find(part => part.inlineData);
      if (!imagePart) {
        // Check if there's a text response explaining why no image was generated
        const textPart = content.parts.find(part => part.text);
        if (textPart) {
          logger.warn(`Image generation returned text instead of image: ${textPart.text}`);
        }
        return { success: false, error: 'No image was generated. Please try a different prompt.' };
      }

      // Decode base64 image data
      const { mimeType, data } = imagePart.inlineData;
      const buffer = Buffer.from(data, 'base64');

      logger.info(`Image generated successfully: ${mimeType}, ${buffer.length} bytes`);

      // Set cooldown for user if provided
      if (user) {
        this.setCooldown(user.id);
      }

      return {
        success: true,
        buffer,
        mimeType,
        prompt: trimmedPrompt
      };

    } catch (error) {
      logger.error(`Image generation error: ${error.message}`);

      // Handle specific error types
      if (error.message.includes('rate limit') || error.message.includes('quota')) {
        return { success: false, error: 'API rate limit exceeded. Please try again later.' };
      }

      if (error.message.includes('safety') || error.message.includes('blocked')) {
        return { success: false, error: 'Your prompt was blocked by safety filters. Please try a different prompt.' };
      }

      return { success: false, error: `Image generation failed: ${error.message}` };
    }
  }

  /**
   * Set cooldown for a user
   * @param {string} userId - The user's ID
   */
  setCooldown(userId) {
    const cooldownMs = this.config.imagen.cooldownSeconds * 1000;
    this.cooldowns.set(userId, Date.now() + cooldownMs);
  }

  /**
   * Check if a user is on cooldown
   * @param {string} userId - The user's ID
   * @returns {boolean}
   */
  isOnCooldown(userId) {
    const expiresAt = this.cooldowns.get(userId);
    if (!expiresAt) return false;

    if (Date.now() >= expiresAt) {
      this.cooldowns.delete(userId);
      return false;
    }

    return true;
  }

  /**
   * Get remaining cooldown time for a user
   * @param {string} userId - The user's ID
   * @returns {number} Remaining seconds, or 0 if not on cooldown
   */
  getRemainingCooldown(userId) {
    const expiresAt = this.cooldowns.get(userId);
    if (!expiresAt) return 0;

    const remaining = Math.ceil((expiresAt - Date.now()) / 1000);
    return Math.max(0, remaining);
  }

  /**
   * Get list of valid aspect ratios
   * @returns {string[]}
   */
  getValidAspectRatios() {
    return [...VALID_ASPECT_RATIOS];
  }
}

module.exports = ImagenService;
