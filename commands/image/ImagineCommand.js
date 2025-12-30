// commands/image/ImagineCommand.js
const BaseCommand = require('../base/BaseCommand');
const logger = require('../../logger');

class ImagineCommand extends BaseCommand {
  constructor(imagenService, imageRetryHandler = null) {
    super({
      name: 'imagine',
      aliases: ['img', 'generate', 'image'],
      description: 'Generate an image from a text prompt using AI',
      category: 'image',
      usage: '!imagine <prompt> [image_url] [--ratio <aspect_ratio>]',
      examples: [
        '!imagine A sunset over mountains with purple clouds',
        '!imagine A cyberpunk city at night --ratio 16:9',
        '!img A cute robot making coffee -r 1:1',
        '!imagine https://example.com/photo.jpg Make this look like a painting',
        '!img Turn this into anime style https://example.com/image.png --ratio 16:9'
      ],
      args: [
        { name: 'prompt', required: true, type: 'string' }
      ]
    });
    this.imagenService = imagenService;
    this.imageRetryHandler = imageRetryHandler;
  }

  /**
   * Parse command arguments to extract prompt, reference image URL, and options
   * @param {string[]} args - Command arguments
   * @param {Object} imagenService - ImagenService instance for URL detection
   * @returns {{prompt: string, aspectRatio: string|null, referenceImageUrl: string|null}}
   */
  parseArgs(args, imagenService = null) {
    let prompt = [];
    let aspectRatio = null;
    let referenceImageUrl = null;
    let i = 0;

    while (i < args.length) {
      const arg = args[i];

      if (arg === '--ratio' || arg === '-r') {
        // Next arg is the aspect ratio value
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          aspectRatio = args[i + 1];
          i += 2;
        } else {
          i++;
        }
      } else if (imagenService && imagenService.isImageUrl && imagenService.isImageUrl(arg)) {
        // This is an image URL - extract it for reference
        referenceImageUrl = arg;
        i++;
      } else if (imagenService && imagenService.extractDiscordAssetUrl) {
        // Try to extract Discord emoji/sticker URL
        const discordUrl = imagenService.extractDiscordAssetUrl(arg);
        if (discordUrl) {
          referenceImageUrl = discordUrl;
          i++;
        } else {
          prompt.push(arg);
          i++;
        }
      } else {
        prompt.push(arg);
        i++;
      }
    }

    return {
      prompt: prompt.join(' '),
      aspectRatio,
      referenceImageUrl
    };
  }

  /**
   * Get file extension from MIME type
   * @param {string} mimeType - The MIME type
   * @returns {string} File extension
   */
  getFileExtension(mimeType) {
    const extensions = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp'
    };
    return extensions[mimeType] || 'png';
  }

  /**
   * Generate a unique filename for the image
   * @param {string} extension - File extension
   * @returns {string} Filename
   */
  generateFilename(extension) {
    return `imagine_${Date.now()}.${extension}`;
  }

  async execute(message, args, context) {
    // Check if ImagenService is available
    const imagenService = this.imagenService || context.bot?.imagenService;
    if (!imagenService) {
      return message.reply({
        content: 'Image generation is not available. Please contact the bot administrator.',
        allowedMentions: { repliedUser: false }
      });
    }

    // Parse arguments
    const { prompt, aspectRatio, referenceImageUrl } = this.parseArgs(args, imagenService);

    // Show usage if no prompt
    if (!prompt) {
      const validRatios = imagenService.getValidAspectRatios().join(', ');
      return message.reply({
        content: `**Usage:** \`!imagine <prompt> [image_url] [--ratio <aspect_ratio>]\`\n\n` +
                 `**Examples:**\n` +
                 `• \`!imagine A sunset over mountains\`\n` +
                 `• \`!imagine A cyberpunk city --ratio 16:9\`\n` +
                 `• \`!imagine https://example.com/photo.jpg Make this a painting\`\n\n` +
                 `**Valid aspect ratios:** ${validRatios}`,
        allowedMentions: { repliedUser: false }
      });
    }

    // Check cooldown
    if (imagenService.isOnCooldown(message.author.id)) {
      const remaining = imagenService.getRemainingCooldown(message.author.id);
      return message.reply({
        content: `You're on cooldown! Please wait ${remaining} seconds before generating another image.`,
        allowedMentions: { repliedUser: false }
      });
    }

    // Show typing indicator
    await message.channel.sendTyping();

    // Generate image
    const logMessage = referenceImageUrl
      ? `Image generation (with reference) requested by ${message.author.tag}: "${prompt.substring(0, 50)}..."`
      : `Image generation requested by ${message.author.tag}: "${prompt.substring(0, 50)}..."`;
    logger.info(logMessage);

    const result = await imagenService.generateImage(
      prompt,
      { aspectRatio, referenceImageUrl },
      message.author
    );

    if (!result.success) {
      // Send basic error message first
      await message.reply({
        content: `Failed to generate image: ${result.error}`,
        allowedMentions: { repliedUser: false }
      });

      // If we have a retry handler and failure context, offer intelligent retry options
      if (this.imageRetryHandler && result.failureContext) {
        try {
          await this.imageRetryHandler.handleFailedGeneration(
            message,
            prompt,
            result.failureContext,
            message.author
          );
        } catch (retryError) {
          logger.error(`Failed to offer retry options: ${retryError.message}`);
        }
      }
      return;
    }

    // Create attachment and send
    const extension = this.getFileExtension(result.mimeType);
    const filename = this.generateFilename(extension);

    await message.reply({
      files: [{
        attachment: result.buffer,
        name: filename
      }],
      allowedMentions: { repliedUser: false }
    });

    logger.info(`Image generated successfully for ${message.author.tag}`);
  }
}

module.exports = ImagineCommand;
