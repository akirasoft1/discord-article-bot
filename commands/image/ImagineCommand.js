// commands/image/ImagineCommand.js
const BaseCommand = require('../base/BaseCommand');
const logger = require('../../logger');

class ImagineCommand extends BaseCommand {
  constructor(imagenService) {
    super({
      name: 'imagine',
      aliases: ['img', 'generate', 'image'],
      description: 'Generate an image from a text prompt using AI',
      category: 'image',
      usage: '!imagine <prompt> [--ratio <aspect_ratio>]',
      examples: [
        '!imagine A sunset over mountains with purple clouds',
        '!imagine A cyberpunk city at night --ratio 16:9',
        '!img A cute robot making coffee -r 1:1'
      ],
      args: [
        { name: 'prompt', required: true, type: 'string' }
      ]
    });
    this.imagenService = imagenService;
  }

  /**
   * Parse command arguments to extract prompt and options
   * @param {string[]} args - Command arguments
   * @returns {{prompt: string, aspectRatio: string|null}}
   */
  parseArgs(args) {
    let prompt = [];
    let aspectRatio = null;
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
      } else {
        prompt.push(arg);
        i++;
      }
    }

    return {
      prompt: prompt.join(' '),
      aspectRatio
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
      'image/webp': 'webp',
      'image/gif': 'gif'
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
    const { prompt, aspectRatio } = this.parseArgs(args);

    // Show usage if no prompt
    if (!prompt) {
      const validRatios = imagenService.getValidAspectRatios().join(', ');
      return message.reply({
        content: `**Usage:** \`!imagine <prompt> [--ratio <aspect_ratio>]\`\n\n` +
                 `**Examples:**\n` +
                 `• \`!imagine A sunset over mountains\`\n` +
                 `• \`!imagine A cyberpunk city --ratio 16:9\`\n\n` +
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
    logger.info(`Image generation requested by ${message.author.tag}: "${prompt.substring(0, 50)}..."`);

    const result = await imagenService.generateImage(
      prompt,
      { aspectRatio },
      message.author
    );

    if (!result.success) {
      return message.reply({
        content: `Failed to generate image: ${result.error}`,
        allowedMentions: { repliedUser: false }
      });
    }

    // Create attachment and send
    const extension = this.getFileExtension(result.mimeType);
    const filename = this.generateFilename(extension);

    await message.reply({
      content: `**Prompt:** ${result.prompt}`,
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
