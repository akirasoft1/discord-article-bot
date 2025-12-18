// commands/slash/ResummarizeCommand.js
// Slash command for force re-summarizing articles

const { SlashCommandBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const logger = require('../../logger');

class ResummarizeSlashCommand extends BaseSlashCommand {
  constructor(summarizationService) {
    super({
      data: new SlashCommandBuilder()
        .setName('resummarize')
        .setDescription('Force re-summarize an article (bypasses cache)')
        .addStringOption(option =>
          option.setName('url')
            .setDescription('The URL of the article to re-summarize')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('style')
            .setDescription('Summary style')
            .setRequired(false)
            .addChoices(
              { name: 'Default', value: 'default' },
              { name: 'Pirate', value: 'pirate' },
              { name: 'Shakespeare', value: 'shakespeare' },
              { name: 'Gen Z', value: 'genz' },
              { name: 'Academic', value: 'academic' }
            )),
      deferReply: true,
      cooldown: 15
    });

    this.summarizationService = summarizationService;
  }

  async execute(interaction, context) {
    const url = interaction.options.getString('url');
    const style = interaction.options.getString('style') || 'default';

    this.logExecution(interaction, `url=${url}, style=${style}, force=true`);

    // Validate URL
    try {
      new URL(url);
    } catch {
      await this.sendError(interaction, 'Please provide a valid URL.');
      return;
    }

    const result = await this.summarizationService.summarize(
      url,
      interaction.user.id,
      interaction.user.tag || interaction.user.username,
      style !== 'default' ? style : null,
      true // Force re-summarize
    );

    if (!result.success) {
      await this.sendError(interaction, result.error || 'Failed to summarize article.');
      return;
    }

    await this.sendLongResponse(interaction, result.summary);
  }
}

module.exports = ResummarizeSlashCommand;
