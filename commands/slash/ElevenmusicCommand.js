// commands/slash/ElevenmusicCommand.js
// Slash command for AI music generation via ElevenLabs music_v1

const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');

class ElevenmusicSlashCommand extends BaseSlashCommand {
  constructor(elevenLabsMusicService) {
    super({
      data: new SlashCommandBuilder()
        .setName('elevenmusic')
        .setDescription('Generate music with ElevenLabs')
        .addStringOption((o) => o.setName('prompt').setDescription('What to generate').setRequired(true).setMaxLength(6000))
        .addIntegerOption((o) => o.setName('duration').setDescription('Length in seconds (3-600, default 90)').setRequired(false).setMinValue(3).setMaxValue(600))
        .addBooleanOption((o) => o.setName('instrumental').setDescription('Force instrumental (no vocals). Ignored if lyrics are provided.').setRequired(false))
        .addStringOption((o) => o.setName('lyrics').setDescription('Custom lyrics. Triggers ElevenLabs composition_plan mode.').setRequired(false).setMaxLength(6000)),
      deferReply: true,
      cooldown: 60
    });

    this.elevenLabsMusicService = elevenLabsMusicService;
  }

  async execute(interaction) {
    if (!this.elevenLabsMusicService || !this.elevenLabsMusicService.isEnabled()) {
      await this.sendError(interaction, 'Music generation is not enabled on this bot.');
      return;
    }

    const prompt = interaction.options.getString('prompt');
    const duration = interaction.options.getInteger('duration') || undefined;
    const instrumental = interaction.options.getBoolean('instrumental') ?? false;
    const lyrics = interaction.options.getString('lyrics') || undefined;

    this.logExecution(interaction, `prompt="${prompt.substring(0, 50)}...", duration=${duration || 'default'}, instrumental=${instrumental}, lyrics=${lyrics ? 'yes' : 'no'}`);

    await interaction.editReply({
      content: `Generating music with ElevenLabs... (this may take 10–60 seconds)\n**Prompt:** ${prompt}`
    });

    const result = await this.elevenLabsMusicService.generateMusic(
      prompt,
      { durationSeconds: duration, instrumental, lyrics },
      { id: interaction.user.id, tag: interaction.user.tag }
    );

    if (!result.success) {
      await this.sendError(interaction, result.error || 'Failed to generate music.');
      return;
    }

    if (!result.buffer) {
      await this.sendError(interaction, 'Music generation completed but no audio data was returned.');
      return;
    }

    const attachment = new AttachmentBuilder(result.buffer, {
      name: `generated-music-${Date.now()}.mp3`,
      description: prompt.substring(0, 100)
    });

    await interaction.editReply({
      content: `**Prompt:** ${prompt}`,
      files: [attachment]
    });
  }
}

module.exports = ElevenmusicSlashCommand;
