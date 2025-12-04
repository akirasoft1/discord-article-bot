// commands/video/VideogenCommand.js
const BaseCommand = require('../base/BaseCommand');
const logger = require('../../logger');

class VideogenCommand extends BaseCommand {
  constructor(veoService) {
    super({
      name: 'videogen',
      aliases: ['vg', 'veo', 'video'],
      description: 'Generate a video from text, one image, or two images using AI',
      category: 'video',
      usage: '!videogen [image_url] [last_image_url] <prompt> [--duration <4|6|8>] [--ratio <16:9|9:16>]',
      examples: [
        '!videogen A sunset over the ocean with waves crashing',
        '!videogen https://example.com/photo.jpg A camera panning across the scene',
        '!videogen https://example.com/morning.jpg https://example.com/night.jpg Day turning to night',
        '!vg A bird flying through clouds --duration 6',
        '!video <:emoji:123> The emoji spinning -r 9:16'
      ],
      args: [
        { name: 'image_url', required: false, type: 'string' },
        { name: 'last_image_url', required: false, type: 'string' },
        { name: 'prompt', required: true, type: 'string' }
      ]
    });
    this.veoService = veoService;
  }

  /**
   * Parse command arguments to extract URLs, prompt, and options
   * @param {string[]} args - Command arguments
   * @param {Object} veoService - VeoService instance for URL detection
   * @returns {{firstFrameUrl: string|null, lastFrameUrl: string|null, prompt: string, duration: string|null, aspectRatio: string|null}}
   */
  parseArgs(args, veoService = null) {
    const imageUrls = [];
    const promptParts = [];
    let duration = null;
    let aspectRatio = null;
    let i = 0;

    while (i < args.length) {
      const arg = args[i];

      if (arg === '--duration' || arg === '-d') {
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          duration = args[i + 1];
          i += 2;
        } else {
          i++;
        }
      } else if (arg === '--ratio' || arg === '-r') {
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          aspectRatio = args[i + 1];
          i += 2;
        } else {
          i++;
        }
      } else if (veoService && veoService.isImageUrl && veoService.isImageUrl(arg)) {
        // This is an image URL
        imageUrls.push(arg);
        i++;
      } else if (veoService && veoService.extractDiscordAssetUrl) {
        // Try to extract Discord emoji URL
        const discordUrl = veoService.extractDiscordAssetUrl(arg);
        if (discordUrl) {
          imageUrls.push(discordUrl);
          i++;
        } else {
          promptParts.push(arg);
          i++;
        }
      } else {
        promptParts.push(arg);
        i++;
      }
    }

    return {
      firstFrameUrl: imageUrls[0] || null,
      lastFrameUrl: imageUrls[1] || null,
      prompt: promptParts.join(' '),
      duration,
      aspectRatio
    };
  }

  /**
   * Generate a unique filename for the video
   * @returns {string} Filename
   */
  generateFilename() {
    return `videogen_${Date.now()}.mp4`;
  }

  async execute(message, args, context) {
    // Check if VeoService is available
    const veoService = this.veoService || context.bot?.veoService;
    if (!veoService) {
      return message.reply({
        content: 'Video generation is not available. Please contact the bot administrator.',
        allowedMentions: { repliedUser: false }
      });
    }

    // Parse arguments
    const { firstFrameUrl, lastFrameUrl, prompt, duration, aspectRatio } = this.parseArgs(args, veoService);

    // Show usage if missing prompt (prompt is always required)
    if (!prompt) {
      const validRatios = veoService.getValidAspectRatios().join(', ');
      const validDurations = veoService.getValidDurations().join(', ');
      return message.reply({
        content: `**Usage:** \`!videogen [image_url] [last_image_url] <prompt> [options]\`\n\n` +
                 `**Text-Only Mode** (text-to-video):\n` +
                 `• \`!videogen A sunset over the ocean with waves crashing\`\n` +
                 `• \`!vg A bird flying through clouds --duration 6\`\n\n` +
                 `**Single Image Mode** (image-to-video):\n` +
                 `• \`!videogen https://example.com/photo.png A camera panning across the scene\`\n` +
                 `• \`!vg <:emoji:123> The emoji spinning --duration 4\`\n\n` +
                 `**Two Image Mode** (first & last frame):\n` +
                 `• \`!videogen https://example.com/start.png https://example.com/end.png A flower blooming\`\n` +
                 `• \`!video <:emoji1:123> <:emoji2:456> Transformation -r 9:16\`\n\n` +
                 `**Options:**\n` +
                 `• \`--duration\` / \`-d\`: Video duration (${validDurations} seconds)\n` +
                 `• \`--ratio\` / \`-r\`: Aspect ratio (${validRatios})\n\n` +
                 `**Note:** Images (if provided) must be PNG or JPEG format.`,
        allowedMentions: { repliedUser: false }
      });
    }

    // Check cooldown
    if (veoService.isOnCooldown(message.author.id)) {
      const remaining = veoService.getRemainingCooldown(message.author.id);
      return message.reply({
        content: `You're on cooldown! Please wait ${remaining} seconds before generating another video.`,
        allowedMentions: { repliedUser: false }
      });
    }

    // Show typing indicator
    await message.channel.sendTyping();

    // Send initial status message
    let statusMessage = await message.reply({
      content: 'Starting video generation...',
      allowedMentions: { repliedUser: false }
    });

    // Progress callback to update status
    const onProgress = async (status) => {
      try {
        if (statusMessage && statusMessage.edit) {
          await statusMessage.edit({
            content: status,
            allowedMentions: { repliedUser: false }
          });
        }
      } catch (error) {
        // Ignore edit errors (message may have been deleted)
        logger.debug(`Failed to update status message: ${error.message}`);
      }
    };

    // Generate video
    logger.info(`Video generation requested by ${message.author.tag}: "${prompt.substring(0, 50)}..."`);

    const result = await veoService.generateVideo(
      prompt,
      firstFrameUrl,
      lastFrameUrl,
      { duration, aspectRatio },
      message.author,
      onProgress
    );

    if (!result.success) {
      // Update status message with error
      try {
        await statusMessage.edit({
          content: `Failed to generate video: ${result.error}`,
          allowedMentions: { repliedUser: false }
        });
      } catch {
        await message.reply({
          content: `Failed to generate video: ${result.error}`,
          allowedMentions: { repliedUser: false }
        });
      }
      return;
    }

    // Delete status message and send video
    try {
      await statusMessage.delete();
    } catch {
      // Ignore delete errors
    }

    // Create attachment and send
    const filename = this.generateFilename();

    await message.reply({
      files: [{
        attachment: result.buffer,
        name: filename
      }],
      allowedMentions: { repliedUser: false }
    });

    logger.info(`Video generated successfully for ${message.author.tag}`);
  }
}

module.exports = VideogenCommand;
