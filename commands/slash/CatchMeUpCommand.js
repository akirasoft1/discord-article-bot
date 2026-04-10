// commands/slash/CatchMeUpCommand.js
// Slash command to get a DM summary of what happened while the user was away

const { SlashCommandBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const logger = require('../../logger');

class CatchMeUpSlashCommand extends BaseSlashCommand {
  constructor(catchMeUpService) {
    super({
      data: new SlashCommandBuilder()
        .setName('catchmeup')
        .setDescription('Get a DM summary of what you missed while you were away'),
      deferReply: true,
      cooldown: 60 // 1 minute cooldown to prevent spam
    });

    this.catchMeUpService = catchMeUpService;
  }

  async execute(interaction, context) {
    this.logExecution(interaction);

    const userId = interaction.user.id;
    const guildId = interaction.guild?.id || null;

    const result = await this.catchMeUpService.generateCatchUp(userId, guildId);

    if (!result.success) {
      await this.sendReply(interaction, {
        content: result.error || 'Failed to generate catch-up summary.',
        ephemeral: true
      });
      return;
    }

    // If nothing new, reply in channel
    if (result.nothingNew) {
      await this.sendReply(interaction, {
        content: result.message,
        ephemeral: true
      });
      return;
    }

    // Split long messages into Discord-safe chunks
    const chunks = this.splitMessage(result.message, 2000);

    // Send catch-up via DM
    try {
      for (const chunk of chunks) {
        await interaction.user.send(chunk);
      }

      await this.sendReply(interaction, {
        content: "I've sent you a DM with your catch-up summary!",
        ephemeral: true
      });
    } catch (dmError) {
      logger.warn(`Failed to DM user ${userId}: ${dmError.message}`);
      await this.sendReply(interaction, {
        content: "I couldn't send you a DM — you may have DMs disabled for this server. Here's your catch-up instead:",
        ephemeral: true
      });

      // Fall back to ephemeral replies in channel
      for (const chunk of chunks) {
        await interaction.followUp({
          content: chunk,
          ephemeral: true
        });
      }
    }
  }
}

module.exports = CatchMeUpSlashCommand;
