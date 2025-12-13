// commands/chat/ChatListCommand.js
const BaseCommand = require('../base/BaseCommand');

class ChatListCommand extends BaseCommand {
  constructor(chatService) {
    super({
      name: 'chatlist',
      aliases: ['listchats', 'chats'],
      description: 'List your resumable conversations',
      category: 'chat',
      usage: '!chatlist',
      examples: [
        '!chatlist',
        '!chats'
      ],
      args: []
    });
    this.chatService = chatService;
  }

  async execute(message, args) {
    const userId = message.author.id;
    const guildId = message.guild?.id || null;

    const conversations = await this.chatService.listUserConversations(userId, guildId);

    if (conversations.length === 0) {
      return message.reply({
        content: 'You have no resumable conversations.\n\nStart a new chat with `!chat <message>` or `!chat <personality> <message>`.',
        allowedMentions: { repliedUser: false }
      });
    }

    // Format the list
    const lines = conversations.map((conv, index) => {
      const timeAgo = this.formatTimeAgo(conv.lastActivity);
      const preview = conv.lastUserMessage
        ? `"${conv.lastUserMessage}${conv.lastUserMessage.length >= 50 ? '...' : ''}"`
        : '';

      return `${index + 1}. ${conv.personality.emoji} **${conv.personality.name}** (${conv.status})\n` +
             `   ${conv.messageCount} messages • ${timeAgo}\n` +
             `   ${preview}\n` +
             `   \`!chatresume ${conv.personality.id} <message>\``;
    });

    const response = `**Your Resumable Conversations:**\n\n${lines.join('\n\n')}`;

    if (response.length > 2000) {
      const chunks = this.splitMessage(response, 2000);
      for (const chunk of chunks) {
        await message.channel.send(chunk);
      }
    } else {
      await message.reply({
        content: response,
        allowedMentions: { repliedUser: false }
      });
    }
  }

  /**
   * Format a date as a human-readable "time ago" string
   * @param {Date} date - The date to format
   * @returns {string} Human-readable time ago
   */
  formatTimeAgo(date) {
    const now = new Date();
    const diffMs = now - new Date(date);
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 60) {
      return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else {
      return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    }
  }

  /**
   * Split a long message into chunks
   * @param {string} text - Text to split
   * @param {number} maxLength - Maximum length per chunk
   * @returns {Array<string>} Array of chunks
   */
  splitMessage(text, maxLength) {
    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      let breakPoint = remaining.lastIndexOf('\n', maxLength);
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = remaining.lastIndexOf(' ', maxLength);
      }
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = maxLength;
      }

      chunks.push(remaining.substring(0, breakPoint));
      remaining = remaining.substring(breakPoint).trim();
    }

    return chunks;
  }
}

module.exports = ChatListCommand;
