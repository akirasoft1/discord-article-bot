// commands/slash/ResummarizeCommand.js
// Slash command for force re-summarizing articles

const { SlashCommandBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const logger = require('../../logger');
const { shouldRedirectToLinkwarden, getLinkwardenRedirectMessage } = require('../../utils/linkwardenRedirect');

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
    // When Linkwarden is enabled, redirect users to use the browser extension
    if (shouldRedirectToLinkwarden()) {
      await interaction.editReply({
        content: getLinkwardenRedirectMessage()
      });
      return;
    }

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

    // Create a mock message object that processUrl can work with
    const mockMessage = {
      channel: {
        send: async (content) => {
          if (typeof content === 'string') {
            await interaction.editReply({ content });
          } else {
            await interaction.editReply(content);
          }
        },
        sendTyping: async () => {}
      },
      reply: async (content) => {
        if (typeof content === 'string') {
          await interaction.editReply({ content });
        } else {
          await interaction.editReply(content);
        }
      },
      react: async () => {}
    };

    const user = {
      id: interaction.user.id,
      tag: interaction.user.tag || interaction.user.username
    };

    // Call processUrl with forceReSummarize=true
    await this.summarizationService.processUrl(
      url,
      mockMessage,
      user,
      style !== 'default' ? style : null,
      true // Force re-summarize (bypass duplicate check)
    );
  }
}

module.exports = ResummarizeSlashCommand;
