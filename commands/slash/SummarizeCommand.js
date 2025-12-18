// commands/slash/SummarizeCommand.js
// Slash command for summarizing articles

const { SlashCommandBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const logger = require('../../logger');

class SummarizeSlashCommand extends BaseSlashCommand {
  constructor(summarizationService) {
    super({
      data: new SlashCommandBuilder()
        .setName('summarize')
        .setDescription('Summarize an article from a URL')
        .addStringOption(option =>
          option.setName('url')
            .setDescription('The URL of the article to summarize')
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
      cooldown: 10
    });

    this.summarizationService = summarizationService;
  }

  async execute(interaction, context) {
    const url = interaction.options.getString('url');
    const style = interaction.options.getString('style') || 'default';

    this.logExecution(interaction, `url=${url}, style=${style}`);

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
      style !== 'default' ? style : null
    );

    if (!result.success) {
      await this.sendError(interaction, result.error || 'Failed to summarize article.');
      return;
    }

    await this.sendLongResponse(interaction, result.summary);
  }
}

module.exports = SummarizeSlashCommand;
