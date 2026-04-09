// commands/slash/ChatResetCommand.js
// Admin slash command to reset conversation history

const { SlashCommandBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const logger = require('../../logger');

class ChatResetSlashCommand extends BaseSlashCommand {
  constructor(chatService) {
    super({
      data: new SlashCommandBuilder()
        .setName('chatreset')
        .setDescription('Reset conversation history in this channel (admin only)'),
      adminOnly: true,
      cooldown: 5
    });

    this.chatService = chatService;
  }

  async execute(interaction, context) {
    const personalityId = 'channel-voice';
    const channelId = interaction.channel.id;

    this.logExecution(interaction, `resetting conversation`);

    // Correct parameter order: channelId first, then personalityId
    const result = await this.chatService.resetConversation(channelId, personalityId);

    if (result.success) {
      await interaction.reply({
        content: '✅ Conversation history has been reset. The bot will have no memory of previous messages in this channel.',
        ephemeral: false
      });
    } else {
      await this.sendError(interaction, result.error || 'Failed to reset conversation.');
    }
  }
}

module.exports = ChatResetSlashCommand;
