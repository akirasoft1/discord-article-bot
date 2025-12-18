// commands/slash/ChatListCommand.js
// Slash command to list resumable conversations

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const personalityManager = require('../../personalities');
const logger = require('../../logger');

class ChatListSlashCommand extends BaseSlashCommand {
  constructor(chatService) {
    super({
      data: new SlashCommandBuilder()
        .setName('chatlist')
        .setDescription('List your resumable conversations'),
      cooldown: 5
    });

    this.chatService = chatService;
  }

  async execute(interaction, context) {
    this.logExecution(interaction);

    const userId = interaction.user.id;
    const conversations = await this.chatService.getResumableConversations(userId);

    if (!conversations || conversations.length === 0) {
      await interaction.reply({
        content: 'You have no resumable conversations. Start a new one with `/chat`!',
        ephemeral: true
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('Your Resumable Conversations')
      .setDescription('Use `/chatresume personality:<name> message:<your message>` to continue')
      .setColor(0x5865F2);

    for (const conv of conversations) {
      const personality = personalityManager.get(conv.personalityId);
      const emoji = personality?.emoji || '🎭';
      const name = personality?.name || conv.personalityId;

      const expiredAt = new Date(conv.expiredAt);
      const timeAgo = this.getTimeAgo(expiredAt);

      embed.addFields({
        name: `${emoji} ${name}`,
        value: `Expired ${timeAgo}\n\`/chatresume personality:${conv.personalityId}\``,
        inline: true
      });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  /**
   * Format a date as a relative time string
   * @param {Date} date
   * @returns {string}
   */
  getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
  }
}

module.exports = ChatListSlashCommand;
