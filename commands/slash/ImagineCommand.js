// commands/slash/ImagineCommand.js
// Slash command for AI image generation

const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const logger = require('../../logger');

class ImagineSlashCommand extends BaseSlashCommand {
  constructor(imagenService, imageRetryHandler = null) {
    super({
      data: new SlashCommandBuilder()
        .setName('imagine')
        .setDescription('Generate an image from a text prompt')
        .addStringOption(option =>
          option.setName('prompt')
            .setDescription('What to generate')
            .setRequired(true)
            .setMaxLength(1000))
        .addStringOption(option =>
          option.setName('ratio')
            .setDescription('Aspect ratio')
            .setRequired(false)
            .addChoices(
              { name: '1:1 (Square)', value: '1:1' },
              { name: '16:9 (Landscape)', value: '16:9' },
              { name: '9:16 (Portrait)', value: '9:16' },
              { name: '4:3', value: '4:3' },
              { name: '3:4', value: '3:4' },
              { name: '3:2', value: '3:2' },
              { name: '2:3', value: '2:3' }
            ))
        .addAttachmentOption(option =>
          option.setName('reference')
            .setDescription('Optional reference image to guide generation')
            .setRequired(false)),
      deferReply: true,
      cooldown: 30
    });

    this.imagenService = imagenService;
    this.imageRetryHandler = imageRetryHandler;
  }

  async execute(interaction, context) {
    const prompt = interaction.options.getString('prompt');
    const ratio = interaction.options.getString('ratio') || '1:1';
    const reference = interaction.options.getAttachment('reference');

    this.logExecution(interaction, `prompt="${prompt.substring(0, 50)}...", ratio=${ratio}`);

    // Get reference image URL if provided
    let referenceUrl = null;
    if (reference) {
      const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
      if (validTypes.includes(reference.contentType)) {
        referenceUrl = reference.url;
      } else {
        await this.sendError(interaction, 'Reference image must be PNG, JPEG, GIF, or WebP.');
        return;
      }
    }

    const result = await this.imagenService.generateImage(
      prompt,
      {
        aspectRatio: ratio,
        referenceImageUrl: referenceUrl
      },
      { id: interaction.user.id, tag: interaction.user.tag }
    );

    if (!result.success) {
      // Send basic error message first
      await this.sendError(interaction, result.error || 'Failed to generate image.');

      // If we have a retry handler and failure context, offer intelligent retry options
      if (this.imageRetryHandler && result.failureContext) {
        try {
          // Create a mock message object for the retry handler to use
          const mockMessage = {
            channel: interaction.channel,
            guild: interaction.guild,
            id: interaction.id
          };

          await this.imageRetryHandler.handleFailedGeneration(
            mockMessage,
            prompt,
            result.failureContext,
            interaction.user
          );
        } catch (retryError) {
          logger.error(`Failed to offer retry options: ${retryError.message}`);
        }
      }
      return;
    }

    // Get file extension from mime type
    const extension = this._getFileExtension(result.mimeType);
    const filename = `generated-image-${Date.now()}.${extension}`;

    // Create attachment from the generated image buffer
    const attachment = new AttachmentBuilder(result.buffer, {
      name: filename,
      description: prompt.substring(0, 100)
    });

    await interaction.editReply({
      content: `**Prompt:** ${prompt}`,
      files: [attachment]
    });
  }

  /**
   * Get file extension from mime type
   * @param {string} mimeType
   * @returns {string}
   */
  _getFileExtension(mimeType) {
    const mimeToExt = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp'
    };
    return mimeToExt[mimeType] || 'png';
  }
}

module.exports = ImagineSlashCommand;
