// services/VeoService.js
const { VertexAI } = require('@google-cloud/vertexai');
const { Storage } = require('@google-cloud/storage');
const axios = require('axios');
const logger = require('../logger');
const { withSpan } = require('../tracing');

// Valid aspect ratios for Veo video generation
const VALID_ASPECT_RATIOS = ['16:9', '9:16'];

// Valid durations in seconds for Veo 3
const VALID_DURATIONS = [4, 6, 8];

// Supported image extensions for frame images (Veo only supports JPEG and PNG)
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg'];

// Map file extensions to MIME types
const EXTENSION_TO_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

// Discord CDN base URL
const DISCORD_EMOJI_CDN = 'https://cdn.discordapp.com/emojis';

// Discord media CDN hosts (for uploaded attachments)
const DISCORD_MEDIA_HOSTS = ['media.discordapp.net', 'cdn.discordapp.com'];

// Regex patterns for Discord custom emojis
const DISCORD_EMOJI_REGEX = /^<(a)?:(\w+):(\d+)>$/;
const DISCORD_SNOWFLAKE_REGEX = /^\d{17,19}$/;

class VeoService {
  constructor(config, mongoService = null) {
    this.config = config;
    this.mongoService = mongoService;

    // Validate configuration
    if (!config.veo.enabled) {
      throw new Error('Video generation is disabled');
    }

    if (!config.veo.projectId) {
      throw new Error('GOOGLE_CLOUD_PROJECT is required for video generation');
    }

    if (!config.veo.gcsBucket) {
      throw new Error('VEO_GCS_BUCKET is required for video generation');
    }

    // Initialize Vertex AI client
    this.vertexAI = new VertexAI({
      project: config.veo.projectId,
      location: config.veo.location
    });

    // Initialize GCS client for downloading generated videos
    this.storage = new Storage({
      projectId: config.veo.projectId
    });

    // Cooldown tracking: Map of userId -> timestamp when cooldown expires
    this.cooldowns = new Map();

    logger.info(`VeoService initialized with model: ${config.veo.model}, bucket: ${config.veo.gcsBucket}`);
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
    const maxLength = this.config.veo.maxPromptLength;

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
    if (!aspectRatio || !VALID_ASPECT_RATIOS.includes(aspectRatio)) {
      return {
        valid: false,
        error: `Invalid aspect ratio: ${aspectRatio}. Valid options: ${VALID_ASPECT_RATIOS.join(', ')}`
      };
    }

    return { valid: true };
  }

  /**
   * Validate video duration
   * @param {number|string} duration - Duration in seconds
   * @returns {{valid: boolean, error?: string}}
   */
  validateDuration(duration) {
    const durationNum = parseInt(duration, 10);
    if (!VALID_DURATIONS.includes(durationNum)) {
      return {
        valid: false,
        error: `Invalid duration: ${duration}. Valid options: ${VALID_DURATIONS.join(', ')} seconds`
      };
    }

    return { valid: true };
  }

  /**
   * Get list of valid aspect ratios
   * @returns {string[]}
   */
  getValidAspectRatios() {
    return [...VALID_ASPECT_RATIOS];
  }

  /**
   * Get list of valid durations
   * @returns {number[]}
   */
  getValidDurations() {
    return [...VALID_DURATIONS];
  }

  // ==================== IMAGE URL SUPPORT ====================

  /**
   * Check if a string is a URL pointing to a supported image (PNG/JPEG only for Veo)
   * @param {string} str - String to check
   * @returns {boolean} True if it's a supported image URL
   */
  isImageUrl(str) {
    if (!str || typeof str !== 'string') return false;

    try {
      const url = new URL(str);
      const pathname = url.pathname.toLowerCase();
      return IMAGE_EXTENSIONS.some(ext => pathname.endsWith(ext));
    } catch {
      return false;
    }
  }

  /**
   * Get MIME type from URL extension
   * @param {string} url - Image URL
   * @returns {string} MIME type
   */
  getMimeTypeFromUrl(url) {
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      for (const [ext, mime] of Object.entries(EXTENSION_TO_MIME)) {
        if (pathname.endsWith(ext)) {
          return mime;
        }
      }
    } catch {
      // Ignore URL parsing errors
    }
    return 'image/png'; // Default fallback
  }

  /**
   * Fetch an image from a URL and return it as base64
   * @param {string} imageUrl - URL of the image to fetch
   * @returns {Promise<{success: boolean, data?: string, mimeType?: string, error?: string}>}
   */
  async fetchImageAsBase64(imageUrl) {
    try {
      // Normalize Discord URLs to use PNG format instead of WebP
      const normalizedUrl = this.normalizeDiscordImageUrl(imageUrl);
      logger.debug(`Fetching frame image from: ${normalizedUrl}`);

      const response = await axios.get(normalizedUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: 10 * 1024 * 1024, // 10MB max
        headers: {
          'User-Agent': 'Discord-Article-Bot/1.0'
        }
      });

      // Get MIME type from headers or infer from URL
      let mimeType = response.headers['content-type'];

      if (!mimeType || !mimeType.startsWith('image/')) {
        if (this.isImageUrl(normalizedUrl)) {
          mimeType = this.getMimeTypeFromUrl(normalizedUrl);
        }
      }

      // Validate it's a supported image type (PNG or JPEG only)
      if (!mimeType || !['image/png', 'image/jpeg'].includes(mimeType)) {
        return {
          success: false,
          error: `URL does not point to a valid image. Veo only supports PNG and JPEG (got: ${mimeType || 'unknown'})`
        };
      }

      const buffer = Buffer.from(response.data);
      const base64Data = buffer.toString('base64');

      logger.debug(`Successfully fetched frame image: ${mimeType}, ${buffer.length} bytes`);

      return {
        success: true,
        data: base64Data,
        mimeType
      };

    } catch (error) {
      logger.error(`Failed to fetch frame image: ${error.message}`);
      return {
        success: false,
        error: `Failed to fetch image: ${error.message}`
      };
    }
  }

  // ==================== DISCORD EMOJI SUPPORT ====================

  /**
   * Parse a Discord custom emoji string
   * @param {string} str - String to parse
   * @returns {{name: string, id: string, animated: boolean}|null}
   */
  parseDiscordEmoji(str) {
    if (!str || typeof str !== 'string') return null;

    const match = str.match(DISCORD_EMOJI_REGEX);
    if (!match) return null;

    return {
      name: match[2],
      id: match[3],
      animated: match[1] === 'a'
    };
  }

  /**
   * Check if a string is a valid Discord snowflake ID
   * @param {string} str - String to check
   * @returns {boolean}
   */
  isDiscordEmojiId(str) {
    if (!str || typeof str !== 'string') return false;
    return DISCORD_SNOWFLAKE_REGEX.test(str);
  }

  /**
   * Generate Discord CDN URL for an emoji (PNG only for Veo)
   * @param {string} emojiId - Discord emoji ID
   * @returns {string}
   */
  getDiscordEmojiUrl(emojiId) {
    return `${DISCORD_EMOJI_CDN}/${emojiId}.png?size=256`;
  }

  /**
   * Extract Discord CDN URL from emoji format or raw ID
   * @param {string} str - Emoji string or raw ID
   * @returns {string|null} CDN URL or null if not valid/supported
   */
  extractDiscordAssetUrl(str) {
    if (!str || typeof str !== 'string') return null;

    // Try parsing as custom emoji format first
    const emoji = this.parseDiscordEmoji(str);
    if (emoji) {
      // Skip animated emojis - GIF not supported by Veo
      if (emoji.animated) {
        return null;
      }
      return this.getDiscordEmojiUrl(emoji.id);
    }

    // Try as raw snowflake ID (assume PNG)
    if (this.isDiscordEmojiId(str)) {
      return this.getDiscordEmojiUrl(str);
    }

    return null;
  }

  // ==================== DISCORD URL NORMALIZATION ====================

  /**
   * Normalize Discord CDN URLs to use PNG format instead of WebP
   * Discord's CDN returns WebP by default which is not supported by Veo
   * @param {string} url - Image URL to normalize
   * @returns {string} Normalized URL with format=png if applicable
   */
  normalizeDiscordImageUrl(url) {
    // Return unchanged for null/undefined
    if (!url) return url;

    try {
      const parsedUrl = new URL(url);

      // Check if this is a Discord media URL
      if (!DISCORD_MEDIA_HOSTS.includes(parsedUrl.hostname)) {
        return url;
      }

      // Check if URL has format=webp parameter
      if (parsedUrl.searchParams.get('format') === 'webp') {
        parsedUrl.searchParams.set('format', 'png');
        logger.debug(`Converted Discord URL format from webp to png: ${url.substring(0, 80)}...`);
        return parsedUrl.toString();
      }

      // No conversion needed
      return url;

    } catch (error) {
      // Invalid URL, return unchanged
      logger.debug(`Could not parse URL for normalization: ${url}`);
      return url;
    }
  }

  // ==================== COOLDOWN MANAGEMENT ====================

  /**
   * Set cooldown for a user
   * @param {string} userId - The user's ID
   */
  setCooldown(userId) {
    const cooldownMs = this.config.veo.cooldownSeconds * 1000;
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
   * @returns {number} Remaining seconds
   */
  getRemainingCooldown(userId) {
    const expiresAt = this.cooldowns.get(userId);
    if (!expiresAt) return 0;

    const remaining = Math.ceil((expiresAt - Date.now()) / 1000);
    return Math.max(0, remaining);
  }

  // ==================== GCS OPERATIONS ====================

  /**
   * Build GCS output URI for video storage
   * @returns {string} GCS URI
   */
  buildGcsOutputUri() {
    const timestamp = Date.now();
    return `gs://${this.config.veo.gcsBucket}/veo-output/${timestamp}/`;
  }

  /**
   * Download video from GCS to buffer
   * @param {string} gcsUri - GCS URI (gs://bucket/path/file.mp4)
   * @returns {Promise<{success: boolean, buffer?: Buffer, error?: string}>}
   */
  async downloadVideoFromGcs(gcsUri) {
    try {
      // Parse GCS URI: gs://bucket/path/to/file.mp4
      const match = gcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
      if (!match) {
        return { success: false, error: `Invalid GCS URI: ${gcsUri}` };
      }

      const bucketName = match[1];
      const filePath = match[2];

      logger.debug(`Downloading video from GCS: ${bucketName}/${filePath}`);

      const bucket = this.storage.bucket(bucketName);
      const file = bucket.file(filePath);

      const [buffer] = await file.download();

      logger.info(`Downloaded video: ${buffer.length} bytes`);

      return { success: true, buffer };

    } catch (error) {
      logger.error(`Failed to download video from GCS: ${error.message}`);
      return { success: false, error: `Failed to download video: ${error.message}` };
    }
  }

  // ==================== VIDEO GENERATION ====================

  /**
   * Generate a video from a text prompt only (text-to-video)
   * @param {string} prompt - Text description of the video
   * @param {Object} options - Generation options
   * @param {string} options.aspectRatio - Aspect ratio (16:9 or 9:16)
   * @param {number} options.duration - Duration in seconds (4, 6, or 8)
   * @param {Object} user - Discord user object for tracking
   * @param {Function} onProgress - Optional callback for progress updates
   * @returns {Promise<{success: boolean, buffer?: Buffer, error?: string, prompt?: string}>}
   */
  async generateVideoFromText(prompt, options = {}, user = null, onProgress = null) {
    // Validate prompt
    const promptValidation = this.validatePrompt(prompt);
    if (!promptValidation.valid) {
      return { success: false, error: promptValidation.error };
    }

    // Validate and set aspect ratio
    const aspectRatio = options.aspectRatio || this.config.veo.defaultAspectRatio;
    const ratioValidation = this.validateAspectRatio(aspectRatio);
    if (!ratioValidation.valid) {
      return { success: false, error: ratioValidation.error };
    }

    // Validate and set duration
    const duration = options.duration || this.config.veo.defaultDuration;
    const durationValidation = this.validateDuration(duration);
    if (!durationValidation.valid) {
      return { success: false, error: durationValidation.error };
    }

    const trimmedPrompt = prompt.trim();

    try {
      logger.info(`Generating video from text for prompt: "${trimmedPrompt.substring(0, 50)}..." with duration: ${duration}s, ratio: ${aspectRatio}`);

      if (onProgress) onProgress('Starting video generation...');

      // Build the output GCS URI
      const outputUri = this.buildGcsOutputUri();
      const model = this.config.veo.model;

      // Wrap the entire generation process in a span
      const result = await withSpan('vertexai.veo.generateVideo', {
        // GenAI semantic conventions
        'gen_ai.system': 'google_vertex',
        'gen_ai.operation.name': 'video_generation',
        'gen_ai.request.model': model,
        // Video generation context
        'video_gen.mode': 'text_to_video',
        'video_gen.duration_seconds': duration,
        'video_gen.aspect_ratio': aspectRatio,
        'video_gen.prompt_length': trimmedPrompt.length,
        // Discord context
        'discord.user.id': user?.id || '',
      }, async (span) => {
        // Make the API request to Vertex AI (text-only mode - no image)
        const endpoint = `https://${this.config.veo.location}-aiplatform.googleapis.com/v1/projects/${this.config.veo.projectId}/locations/${this.config.veo.location}/publishers/google/models/${model}:predictLongRunning`;

        const requestBody = {
          instances: [{
            prompt: trimmedPrompt
          }],
          parameters: {
            storageUri: outputUri,
            sampleCount: 1,
            aspectRatio: aspectRatio,
            durationSeconds: parseInt(duration, 10)
          }
        };

        // Get access token for authentication
        const { GoogleAuth } = require('google-auth-library');
        const auth = new GoogleAuth({
          scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });
        const client = await auth.getClient();
        const accessToken = await client.getAccessToken();

        // Start the long-running operation
        const startResponse = await axios.post(endpoint, requestBody, {
          headers: {
            'Authorization': `Bearer ${accessToken.token}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        });

        const operationName = startResponse.data.name;
        logger.info(`Video generation operation started: ${operationName}`);
        span.setAttributes({ 'video_gen.operation_name': operationName });

        // Poll for completion
        if (onProgress) onProgress('Generating video (this may take a few minutes)...');
        const pollResult = await this.pollOperation(operationName, accessToken.token, onProgress);

        // Add response attributes
        span.setAttributes({
          'gen_ai.response.success': pollResult.success,
        });

        return pollResult;
      });

      if (!result.success) {
        // Record failed generation
        if (this.mongoService && user) {
          await this.mongoService.recordVideoGeneration(
            user.id,
            user.tag || user.username,
            trimmedPrompt,
            duration,
            aspectRatio,
            this.config.veo.model,
            false,
            result.error,
            0
          );
        }
        return result;
      }

      // Download the generated video from GCS
      if (onProgress) onProgress('Downloading generated video...');
      const videoGcsUri = result.videoUri;
      const downloadResult = await this.downloadVideoFromGcs(videoGcsUri);

      if (!downloadResult.success) {
        return downloadResult;
      }

      // Set cooldown for user
      if (user) {
        this.setCooldown(user.id);
      }

      // Record successful generation
      if (this.mongoService && user) {
        await this.mongoService.recordVideoGeneration(
          user.id,
          user.tag || user.username,
          trimmedPrompt,
          duration,
          aspectRatio,
          this.config.veo.model,
          true,
          null,
          downloadResult.buffer.length
        );
      }

      logger.info(`Video generated successfully from text: ${downloadResult.buffer.length} bytes`);

      return {
        success: true,
        buffer: downloadResult.buffer,
        prompt: trimmedPrompt,
        duration,
        aspectRatio
      };

    } catch (error) {
      logger.error(`Video generation error: ${error.message}`);

      let errorMessage;
      if (error.response?.data?.error?.message) {
        errorMessage = error.response.data.error.message;
      } else if (error.message.includes('rate limit') || error.message.includes('quota')) {
        errorMessage = 'API rate limit exceeded. Please try again later.';
      } else if (error.message.includes('safety') || error.message.includes('blocked')) {
        errorMessage = 'Your prompt was blocked by safety filters. Please try a different prompt.';
      } else {
        errorMessage = `Video generation failed: ${error.message}`;
      }

      // Record failed generation
      if (this.mongoService && user) {
        await this.mongoService.recordVideoGeneration(
          user.id,
          user.tag || user.username,
          trimmedPrompt,
          duration,
          aspectRatio,
          this.config.veo.model,
          false,
          errorMessage,
          0
        );
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Generate a video from a single image with a prompt (image-to-video)
   * @param {string} prompt - Text description of the video
   * @param {string} imageUrl - URL of the source image
   * @param {Object} options - Generation options
   * @param {string} options.aspectRatio - Aspect ratio (16:9 or 9:16)
   * @param {number} options.duration - Duration in seconds (4, 6, or 8)
   * @param {Object} user - Discord user object for tracking
   * @param {Function} onProgress - Optional callback for progress updates
   * @returns {Promise<{success: boolean, buffer?: Buffer, error?: string, prompt?: string}>}
   */
  async generateVideoFromImage(prompt, imageUrl, options = {}, user = null, onProgress = null) {
    // Validate prompt
    const promptValidation = this.validatePrompt(prompt);
    if (!promptValidation.valid) {
      return { success: false, error: promptValidation.error };
    }

    // Validate and set aspect ratio
    const aspectRatio = options.aspectRatio || this.config.veo.defaultAspectRatio;
    const ratioValidation = this.validateAspectRatio(aspectRatio);
    if (!ratioValidation.valid) {
      return { success: false, error: ratioValidation.error };
    }

    // Validate and set duration
    const duration = options.duration || this.config.veo.defaultDuration;
    const durationValidation = this.validateDuration(duration);
    if (!durationValidation.valid) {
      return { success: false, error: durationValidation.error };
    }

    const trimmedPrompt = prompt.trim();

    // Fetch the source image
    if (onProgress) onProgress('Fetching image...');
    const sourceImage = await this.fetchImageAsBase64(imageUrl);
    if (!sourceImage.success) {
      return { success: false, error: sourceImage.error };
    }

    try {
      logger.info(`Generating video from image for prompt: "${trimmedPrompt.substring(0, 50)}..." with duration: ${duration}s, ratio: ${aspectRatio}`);

      if (onProgress) onProgress('Starting video generation...');

      // Build the output GCS URI
      const outputUri = this.buildGcsOutputUri();
      const model = this.config.veo.model;

      // Wrap the entire generation process in a span
      const result = await withSpan('vertexai.veo.generateVideo', {
        // GenAI semantic conventions
        'gen_ai.system': 'google_vertex',
        'gen_ai.operation.name': 'video_generation',
        'gen_ai.request.model': model,
        // Video generation context
        'video_gen.mode': 'image_to_video',
        'video_gen.duration_seconds': duration,
        'video_gen.aspect_ratio': aspectRatio,
        'video_gen.prompt_length': trimmedPrompt.length,
        'video_gen.source_image_mime': sourceImage.mimeType,
        // Discord context
        'discord.user.id': user?.id || '',
      }, async (span) => {
        // Make the API request to Vertex AI (single image mode - no lastFrame)
        const endpoint = `https://${this.config.veo.location}-aiplatform.googleapis.com/v1/projects/${this.config.veo.projectId}/locations/${this.config.veo.location}/publishers/google/models/${model}:predictLongRunning`;

        const requestBody = {
          instances: [{
            prompt: trimmedPrompt,
            image: {
              bytesBase64Encoded: sourceImage.data,
              mimeType: sourceImage.mimeType
            }
          }],
          parameters: {
            storageUri: outputUri,
            sampleCount: 1,
            aspectRatio: aspectRatio,
            durationSeconds: parseInt(duration, 10)
          }
        };

        // Get access token for authentication
        const { GoogleAuth } = require('google-auth-library');
        const auth = new GoogleAuth({
          scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });
        const client = await auth.getClient();
        const accessToken = await client.getAccessToken();

        // Start the long-running operation
        const startResponse = await axios.post(endpoint, requestBody, {
          headers: {
            'Authorization': `Bearer ${accessToken.token}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        });

        const operationName = startResponse.data.name;
        logger.info(`Video generation operation started: ${operationName}`);
        span.setAttributes({ 'video_gen.operation_name': operationName });

        // Poll for completion
        if (onProgress) onProgress('Generating video (this may take a few minutes)...');
        const pollResult = await this.pollOperation(operationName, accessToken.token, onProgress);

        // Add response attributes
        span.setAttributes({
          'gen_ai.response.success': pollResult.success,
        });

        return pollResult;
      });

      if (!result.success) {
        // Record failed generation
        if (this.mongoService && user) {
          await this.mongoService.recordVideoGeneration(
            user.id,
            user.tag || user.username,
            trimmedPrompt,
            duration,
            aspectRatio,
            this.config.veo.model,
            false,
            result.error,
            0
          );
        }
        return result;
      }

      // Download the generated video from GCS
      if (onProgress) onProgress('Downloading generated video...');
      const videoGcsUri = result.videoUri;
      const downloadResult = await this.downloadVideoFromGcs(videoGcsUri);

      if (!downloadResult.success) {
        return downloadResult;
      }

      // Set cooldown for user
      if (user) {
        this.setCooldown(user.id);
      }

      // Record successful generation
      if (this.mongoService && user) {
        await this.mongoService.recordVideoGeneration(
          user.id,
          user.tag || user.username,
          trimmedPrompt,
          duration,
          aspectRatio,
          this.config.veo.model,
          true,
          null,
          downloadResult.buffer.length
        );
      }

      logger.info(`Video generated successfully from single image: ${downloadResult.buffer.length} bytes`);

      return {
        success: true,
        buffer: downloadResult.buffer,
        prompt: trimmedPrompt,
        duration,
        aspectRatio
      };

    } catch (error) {
      logger.error(`Video generation error: ${error.message}`);

      let errorMessage;
      if (error.response?.data?.error?.message) {
        errorMessage = error.response.data.error.message;
      } else if (error.message.includes('rate limit') || error.message.includes('quota')) {
        errorMessage = 'API rate limit exceeded. Please try again later.';
      } else if (error.message.includes('safety') || error.message.includes('blocked')) {
        errorMessage = 'Your prompt was blocked by safety filters. Please try a different prompt.';
      } else {
        errorMessage = `Video generation failed: ${error.message}`;
      }

      // Record failed generation
      if (this.mongoService && user) {
        await this.mongoService.recordVideoGeneration(
          user.id,
          user.tag || user.username,
          trimmedPrompt,
          duration,
          aspectRatio,
          this.config.veo.model,
          false,
          errorMessage,
          0
        );
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Generate a video from first and last frame images with a prompt
   * Routes to appropriate mode based on provided URLs:
   * - No URLs: text-to-video mode (generateVideoFromText)
   * - One URL: single-image mode (generateVideoFromImage)
   * - Two URLs: first/last frame mode (this method)
   * @param {string} prompt - Text description of the video transition
   * @param {string|null} firstFrameUrl - URL of the first frame image (null for text-only mode)
   * @param {string|null} lastFrameUrl - URL of the last frame image (null for single-image or text-only mode)
   * @param {Object} options - Generation options
   * @param {string} options.aspectRatio - Aspect ratio (16:9 or 9:16)
   * @param {number} options.duration - Duration in seconds (4, 6, or 8)
   * @param {Object} user - Discord user object for tracking
   * @param {Function} onProgress - Optional callback for progress updates
   * @returns {Promise<{success: boolean, buffer?: Buffer, error?: string, prompt?: string}>}
   */
  async generateVideo(prompt, firstFrameUrl, lastFrameUrl, options = {}, user = null, onProgress = null) {
    // Route to text-only mode if no images provided
    if (!firstFrameUrl && !lastFrameUrl) {
      return this.generateVideoFromText(prompt, options, user, onProgress);
    }

    // Route to single-image mode if only first frame provided
    if (!lastFrameUrl) {
      return this.generateVideoFromImage(prompt, firstFrameUrl, options, user, onProgress);
    }
    // Validate prompt
    const promptValidation = this.validatePrompt(prompt);
    if (!promptValidation.valid) {
      return { success: false, error: promptValidation.error };
    }

    // Validate and set aspect ratio
    const aspectRatio = options.aspectRatio || this.config.veo.defaultAspectRatio;
    const ratioValidation = this.validateAspectRatio(aspectRatio);
    if (!ratioValidation.valid) {
      return { success: false, error: ratioValidation.error };
    }

    // Validate and set duration
    const duration = options.duration || this.config.veo.defaultDuration;
    const durationValidation = this.validateDuration(duration);
    if (!durationValidation.valid) {
      return { success: false, error: durationValidation.error };
    }

    const trimmedPrompt = prompt.trim();

    // Fetch first frame
    if (onProgress) onProgress('Fetching first frame...');
    const firstFrame = await this.fetchImageAsBase64(firstFrameUrl);
    if (!firstFrame.success) {
      return { success: false, error: `Failed to fetch first frame: ${firstFrame.error}` };
    }

    // Fetch last frame
    if (onProgress) onProgress('Fetching last frame...');
    const lastFrame = await this.fetchImageAsBase64(lastFrameUrl);
    if (!lastFrame.success) {
      return { success: false, error: `Failed to fetch last frame: ${lastFrame.error}` };
    }

    try {
      logger.info(`Generating video for prompt: "${trimmedPrompt.substring(0, 50)}..." with duration: ${duration}s, ratio: ${aspectRatio}`);

      if (onProgress) onProgress('Starting video generation...');

      // Build the output GCS URI
      const outputUri = this.buildGcsOutputUri();
      const model = this.config.veo.model;

      // Wrap the entire generation process in a span
      const result = await withSpan('vertexai.veo.generateVideo', {
        // GenAI semantic conventions
        'gen_ai.system': 'google_vertex',
        'gen_ai.operation.name': 'video_generation',
        'gen_ai.request.model': model,
        // Video generation context
        'video_gen.mode': 'first_last_frame',
        'video_gen.duration_seconds': duration,
        'video_gen.aspect_ratio': aspectRatio,
        'video_gen.prompt_length': trimmedPrompt.length,
        'video_gen.first_frame_mime': firstFrame.mimeType,
        'video_gen.last_frame_mime': lastFrame.mimeType,
        // Discord context
        'discord.user.id': user?.id || '',
      }, async (span) => {
        // Make the API request to Vertex AI
        const endpoint = `https://${this.config.veo.location}-aiplatform.googleapis.com/v1/projects/${this.config.veo.projectId}/locations/${this.config.veo.location}/publishers/google/models/${model}:predictLongRunning`;

        const requestBody = {
          instances: [{
            prompt: trimmedPrompt,
            image: {
              bytesBase64Encoded: firstFrame.data,
              mimeType: firstFrame.mimeType
            },
            lastFrame: {
              bytesBase64Encoded: lastFrame.data,
              mimeType: lastFrame.mimeType
            }
          }],
          parameters: {
            storageUri: outputUri,
            sampleCount: 1,
            aspectRatio: aspectRatio,
            durationSeconds: parseInt(duration, 10)
          }
        };

        // Get access token for authentication
        const { GoogleAuth } = require('google-auth-library');
        const auth = new GoogleAuth({
          scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });
        const client = await auth.getClient();
        const accessToken = await client.getAccessToken();

        // Start the long-running operation
        const startResponse = await axios.post(endpoint, requestBody, {
          headers: {
            'Authorization': `Bearer ${accessToken.token}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000
        });

        const operationName = startResponse.data.name;
        logger.info(`Video generation operation started: ${operationName}`);
        span.setAttributes({ 'video_gen.operation_name': operationName });

        // Poll for completion
        if (onProgress) onProgress('Generating video (this may take a few minutes)...');
        const pollResult = await this.pollOperation(operationName, accessToken.token, onProgress);

        // Add response attributes
        span.setAttributes({
          'gen_ai.response.success': pollResult.success,
        });

        return pollResult;
      });

      if (!result.success) {
        // Record failed generation
        if (this.mongoService && user) {
          await this.mongoService.recordVideoGeneration(
            user.id,
            user.tag || user.username,
            trimmedPrompt,
            duration,
            aspectRatio,
            this.config.veo.model,
            false,
            result.error,
            0
          );
        }
        return result;
      }

      // Download the generated video from GCS
      if (onProgress) onProgress('Downloading generated video...');
      const videoGcsUri = result.videoUri;
      const downloadResult = await this.downloadVideoFromGcs(videoGcsUri);

      if (!downloadResult.success) {
        return downloadResult;
      }

      // Set cooldown for user
      if (user) {
        this.setCooldown(user.id);
      }

      // Record successful generation
      if (this.mongoService && user) {
        await this.mongoService.recordVideoGeneration(
          user.id,
          user.tag || user.username,
          trimmedPrompt,
          duration,
          aspectRatio,
          this.config.veo.model,
          true,
          null,
          downloadResult.buffer.length
        );
      }

      logger.info(`Video generated successfully: ${downloadResult.buffer.length} bytes`);

      return {
        success: true,
        buffer: downloadResult.buffer,
        prompt: trimmedPrompt,
        duration,
        aspectRatio
      };

    } catch (error) {
      logger.error(`Video generation error: ${error.message}`);

      let errorMessage;
      if (error.response?.data?.error?.message) {
        errorMessage = error.response.data.error.message;
      } else if (error.message.includes('rate limit') || error.message.includes('quota')) {
        errorMessage = 'API rate limit exceeded. Please try again later.';
      } else if (error.message.includes('safety') || error.message.includes('blocked')) {
        errorMessage = 'Your prompt was blocked by safety filters. Please try a different prompt.';
      } else {
        errorMessage = `Video generation failed: ${error.message}`;
      }

      // Record failed generation
      if (this.mongoService && user) {
        await this.mongoService.recordVideoGeneration(
          user.id,
          user.tag || user.username,
          trimmedPrompt,
          duration,
          aspectRatio,
          this.config.veo.model,
          false,
          errorMessage,
          0
        );
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Poll a long-running operation until completion
   * @param {string} operationName - The operation name/ID
   * @param {string} accessToken - OAuth access token
   * @param {Function} onProgress - Optional progress callback
   * @returns {Promise<{success: boolean, videoUri?: string, error?: string}>}
   */
  async pollOperation(operationName, accessToken, onProgress = null) {
    const maxWaitMs = this.config.veo.maxWaitSeconds * 1000;
    const pollIntervalMs = this.config.veo.pollIntervalMs;
    const startTime = Date.now();

    // Use fetchPredictOperation endpoint for Veo video generation
    const fetchOperationUrl = `https://${this.config.veo.location}-aiplatform.googleapis.com/v1/projects/${this.config.veo.projectId}/locations/${this.config.veo.location}/publishers/google/models/${this.config.veo.model}:fetchPredictOperation`;

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const response = await axios.post(fetchOperationUrl, {
          operationName: operationName
        }, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        });

        const operation = response.data;

        if (operation.done) {
          if (operation.error) {
            logger.error(`Video generation failed: ${JSON.stringify(operation.error)}`);
            return {
              success: false,
              error: operation.error.message || 'Video generation failed'
            };
          }

          // Extract video URI from response
          const videos = operation.response?.videos;
          if (!videos || videos.length === 0) {
            return { success: false, error: 'No video was generated' };
          }

          const videoUri = videos[0].gcsUri;
          logger.info(`Video generation complete: ${videoUri}`);

          return { success: true, videoUri };
        }

        // Still processing
        const elapsedSec = Math.round((Date.now() - startTime) / 1000);
        if (onProgress) {
          onProgress(`Generating video... (${elapsedSec}s elapsed)`);
        }
        logger.debug(`Video generation in progress (${elapsedSec}s elapsed)...`);

        // Wait before polling again
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

      } catch (error) {
        logger.error(`Error polling operation: ${error.message}`);
        // Continue polling unless it's a fatal error
        if (error.response?.status === 404) {
          return { success: false, error: 'Operation not found' };
        }
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      }
    }

    return { success: false, error: `Video generation timed out after ${this.config.veo.maxWaitSeconds} seconds` };
  }
}

module.exports = VeoService;
