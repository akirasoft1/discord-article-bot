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
    const guildId = interaction.guild?.id || null;

    // Use correct method name with guildId parameter
    const conversations = await this.chatService.listUserConversations(userId, guildId);

    if (!conversations || conversations.length === 0) {
      await interaction.reply({
        content: 'You have no resumable conversations. Start a new one with `/chat`!',
        ephemeral: true
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('Your Resumable Conversations')
      .setDescription('Use `/chatresume` to continue a conversation')
      .setColor(0x5865F2);

    for (const conv of conversations) {
      // Use conversation's personality data which includes emoji and name
      const emoji = conv.personality?.emoji || '🎭';
      const name = conv.personality?.name || conv.personalityId || 'Unknown';
      const personalityId = conv.personality?.id || conv.personalityId;

      const timeAgo = this.getTimeAgo(new Date(conv.lastActivity));
      const preview = conv.lastUserMessage
        ? `"${conv.lastUserMessage.substring(0, 50)}${conv.lastUserMessage.length > 50 ? '...' : ''}"`
        : '';

      embed.addFields({
        name: `${emoji} ${name} (${conv.status || 'expired'})`,
        value: `${conv.messageCount || 0} messages • ${timeAgo}\n${preview}\n\`/chatresume personality:${personalityId}\``,
        inline: false
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
