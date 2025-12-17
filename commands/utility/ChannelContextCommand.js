// commands/utility/ChannelContextCommand.js
// User command to view what channel context the bot has

const BaseCommand = require('../base/BaseCommand');
const logger = require('../../logger');

class ChannelContextCommand extends BaseCommand {
  constructor() {
    super({
      name: 'context',
      aliases: ['channelcontext', 'whatcontext'],
      description: 'View what the bot knows about recent channel conversation',
      category: 'utility',
      usage: '!context',
      examples: [
        '!context'
      ],
      args: []
    });
  }

  async execute(message, args, context) {
    const channelContextService = context.bot?.channelContextService;
    const channelId = message.channel.id;

    // Check if channel context is enabled
    if (!channelContextService) {
      return message.reply({
        content: 'Channel context tracking is not enabled on this bot.',
        allowedMentions: { repliedUser: false }
      });
    }

    // Check if this specific channel is being tracked
    if (!channelContextService.isChannelTracked(channelId)) {
      return message.reply({
        content: 'Channel context tracking is not enabled for this channel.\n' +
                 'An admin can enable it with `!channeltrack enable`.',
        allowedMentions: { repliedUser: false }
      });
    }

    try {
      // Get channel stats
      const stats = await channelContextService.getChannelStats(channelId);

      // Get recent context preview
      const recentContext = channelContextService.getRecentContext(channelId, 5);

      // Get channel facts from Mem0 (Tier 3)
      const channelFacts = await channelContextService.getChannelFacts(channelId);

      // Build response
      let response = '**Channel Context Summary**\n\n';

      // Stats section
      response += '**Statistics:**\n';
      response += `- Messages in buffer: ${stats.bufferCount}\n`;
      response += `- Messages indexed (searchable): ${stats.indexedCount}\n`;
      if (stats.pendingCount > 0) {
        response += `- Pending batch index: ${stats.pendingCount}\n`;
      }
      if (stats.lastActivity) {
        const timeAgo = this._formatTimeAgo(stats.lastActivity);
        response += `- Last activity: ${timeAgo}\n`;
      }

      // Recent messages preview
      if (recentContext) {
        response += '\n**Recent Conversation Preview (last 5 messages):**\n';
        response += '```\n';
        // Truncate if too long
        const previewText = recentContext.length > 400
          ? recentContext.substring(0, 400) + '...'
          : recentContext;
        response += previewText;
        response += '\n```\n';
      } else {
        response += '\n*No recent messages in buffer*\n';
      }

      // Channel facts from Mem0
      if (channelFacts) {
        response += '\n**Channel Facts (learned patterns):**\n';
        response += channelFacts + '\n';
      }

      // Truncate overall response if too long
      if (response.length > 1900) {
        response = response.substring(0, 1900) + '\n\n*...truncated*';
      }

      return message.reply({
        content: response,
        allowedMentions: { repliedUser: false }
      });

    } catch (error) {
      logger.error(`Error getting channel context: ${error.message}`);
      return message.reply({
        content: 'An error occurred while retrieving channel context.',
        allowedMentions: { repliedUser: false }
      });
    }
  }

  /**
   * Format a date as "X time ago"
   * @param {Date} date - Date to format
   * @returns {string} Formatted time ago string
   */
  _formatTimeAgo(date) {
    const now = new Date();
    const diffMs = now - new Date(date);
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMinutes < 1) return 'just now';
    if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  }
}

module.exports = ChannelContextCommand;
