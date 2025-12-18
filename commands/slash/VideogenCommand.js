// commands/slash/VideogenCommand.js
// Slash command for AI video generation

const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const logger = require('../../logger');

class VideogenSlashCommand extends BaseSlashCommand {
  constructor(veoService) {
    super({
      data: new SlashCommandBuilder()
        .setName('videogen')
        .setDescription('Generate a video from text or images')
        .addStringOption(option =>
          option.setName('prompt')
            .setDescription('What to generate')
            .setRequired(true)
            .setMaxLength(1000))
        .addStringOption(option =>
          option.setName('duration')
            .setDescription('Video duration in seconds')
            .setRequired(false)
            .addChoices(
              { name: '4 seconds', value: '4' },
              { name: '6 seconds', value: '6' },
              { name: '8 seconds', value: '8' }
            ))
        .addStringOption(option =>
          option.setName('ratio')
            .setDescription('Aspect ratio')
            .setRequired(false)
            .addChoices(
              { name: '16:9 (Landscape)', value: '16:9' },
              { name: '9:16 (Portrait)', value: '9:16' }
            ))
        .addAttachmentOption(option =>
          option.setName('first_frame')
            .setDescription('Starting frame image')
            .setRequired(false))
        .addAttachmentOption(option =>
          option.setName('last_frame')
            .setDescription('Ending frame image (for morphing)')
            .setRequired(false)),
      deferReply: true,
      cooldown: 60
    });

    this.veoService = veoService;
  }

  async execute(interaction, context) {
    const prompt = interaction.options.getString('prompt');
    const duration = parseInt(interaction.options.getString('duration') || '8', 10);
    const ratio = interaction.options.getString('ratio') || '16:9';
    const firstFrame = interaction.options.getAttachment('first_frame');
    const lastFrame = interaction.options.getAttachment('last_frame');

    this.logExecution(interaction, `prompt="${prompt.substring(0, 50)}...", duration=${duration}s`);

    // Validate image types if provided
    const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

    let firstFrameUrl = null;
    let lastFrameUrl = null;

    if (firstFrame) {
      if (!validTypes.includes(firstFrame.contentType)) {
        await this.sendError(interaction, 'First frame must be PNG, JPEG, GIF, or WebP.');
        return;
      }
      firstFrameUrl = firstFrame.url;
    }

    if (lastFrame) {
      if (!validTypes.includes(lastFrame.contentType)) {
        await this.sendError(interaction, 'Last frame must be PNG, JPEG, GIF, or WebP.');
        return;
      }
      lastFrameUrl = lastFrame.url;
    }

    // Update the deferred reply with progress
    await interaction.editReply({
      content: `Generating video... This may take a few minutes.\n**Prompt:** ${prompt}`
    });

    const result = await this.veoService.generate(
      prompt,
      interaction.user.id,
      {
        duration,
        aspectRatio: ratio,
        firstFrameUrl,
        lastFrameUrl,
        onProgress: async (status) => {
          try {
            await interaction.editReply({
              content: `${status}\n**Prompt:** ${prompt}`
            });
          } catch (e) {
            // Ignore edit errors
          }
        }
      }
    );

    if (!result.success) {
      await this.sendError(interaction, result.error || 'Failed to generate video.');
      return;
    }

    // Send the video
    if (result.videoBuffer) {
      const attachment = new AttachmentBuilder(result.videoBuffer, {
        name: 'generated-video.mp4',
        description: prompt.substring(0, 100)
      });

      await interaction.editReply({
        content: `**Prompt:** ${prompt}`,
        files: [attachment]
      });
    } else if (result.videoUrl) {
      await interaction.editReply({
        content: `**Prompt:** ${prompt}\n\n**Video:** ${result.videoUrl}`
      });
    }
  }
}

module.exports = VideogenSlashCommand;
