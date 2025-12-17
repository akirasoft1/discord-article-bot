// commands/admin/ChannelTrackCommand.js
// Admin command to enable/disable channel context tracking

const BaseCommand = require('../base/BaseCommand');
const config = require('../../config/config');
const logger = require('../../logger');

class ChannelTrackCommand extends BaseCommand {
  constructor() {
    super({
      name: 'channeltrack',
      aliases: ['track', 'trackcontext'],
      description: 'Enable/disable channel conversation tracking (admin only)',
      category: 'admin',
      usage: '!channeltrack <enable|disable|status>',
      examples: [
        '!channeltrack enable',
        '!channeltrack disable',
        '!channeltrack status'
      ],
      args: [
        { name: 'action', required: false, type: 'string' }
      ]
    });
  }

  async execute(message, args, context) {
    // Check if user is a bot admin
    const userId = message.author.id;
    const isAdmin = config.discord.adminUserIds.includes(userId);

    if (!isAdmin) {
      return message.reply({
        content: 'Only bot admins can manage channel tracking.',
        allowedMentions: { repliedUser: false }
      });
    }

    const channelContextService = context.bot?.channelContextService;

    // Check if channel context feature is enabled globally
    if (!config.channelContext?.enabled) {
      return message.reply({
        content: 'Channel context tracking is not enabled in the bot configuration.\n' +
                 'Set `CHANNEL_CONTEXT_ENABLED=true` in environment variables to enable.',
        allowedMentions: { repliedUser: false }
      });
    }

    if (!channelContextService) {
      return message.reply({
        content: 'Channel context service is not available. Check bot logs for errors.',
        allowedMentions: { repliedUser: false }
      });
    }

    const channelId = message.channel.id;
    const guildId = message.guild?.id;
    const action = args[0]?.toLowerCase();

    // Default to status if no action provided
    if (!action || action === 'status') {
      return this.showStatus(message, channelContextService, channelId);
    }

    switch (action) {
      case 'enable':
      case 'on':
        return this.enableTracking(message, channelContextService, channelId, guildId, userId);

      case 'disable':
      case 'off':
        return this.disableTracking(message, channelContextService, channelId);

      default:
        return message.reply({
          content: '**Usage:** `!channeltrack <enable|disable|status>`\n\n' +
                   '**Actions:**\n' +
                   '- `enable` - Start tracking conversations in this channel\n' +
                   '- `disable` - Stop tracking conversations in this channel\n' +
                   '- `status` - Show tracking status for this channel',
          allowedMentions: { repliedUser: false }
        });
    }
  }

  async showStatus(message, channelContextService, channelId) {
    try {
      const isTracked = channelContextService.isChannelTracked(channelId);
      const stats = await channelContextService.getChannelStats(channelId);

      let statusMessage = `**Channel Context Tracking Status**\n\n`;
      statusMessage += `**Enabled:** ${isTracked ? 'Yes' : 'No'}\n`;

      if (isTracked) {
        statusMessage += `**Messages in buffer:** ${stats.bufferCount}\n`;
        statusMessage += `**Messages indexed:** ${stats.indexedCount}\n`;
        statusMessage += `**Pending indexing:** ${stats.pendingCount}\n`;
        if (stats.lastActivity) {
          statusMessage += `**Last activity:** ${stats.lastActivity.toLocaleString()}\n`;
        }
      }

      statusMessage += `\n**Configuration:**\n`;
      statusMessage += `- Recent message buffer: ${config.channelContext.recentMessageCount} messages\n`;
      statusMessage += `- Batch index interval: ${config.channelContext.batchIndexIntervalMinutes} minutes\n`;
      statusMessage += `- Retention: ${config.channelContext.retentionDays} days\n`;

      return message.reply({
        content: statusMessage,
        allowedMentions: { repliedUser: false }
      });
    } catch (error) {
      logger.error(`Error getting channel tracking status: ${error.message}`);
      return message.reply({
        content: 'An error occurred while getting status. Please try again.',
        allowedMentions: { repliedUser: false }
      });
    }
  }

  async enableTracking(message, channelContextService, channelId, guildId, userId) {
    try {
      if (channelContextService.isChannelTracked(channelId)) {
        return message.reply({
          content: 'Channel context tracking is already enabled for this channel.',
          allowedMentions: { repliedUser: false }
        });
      }

      await channelContextService.enableChannel(channelId, guildId, userId);

      logger.info(`Channel tracking enabled for ${channelId} by ${message.author.tag}`);

      return message.reply({
        content: '**Channel context tracking enabled.**\n\n' +
                 'Messages in this channel will now be recorded for conversation awareness.\n' +
                 'The bot will have context of recent discussions when responding to chat commands.\n\n' +
                 '**Privacy note:** Messages are stored for up to ' +
                 `${config.channelContext.retentionDays} days and used only for conversation context.`,
        allowedMentions: { repliedUser: false }
      });
    } catch (error) {
      logger.error(`Error enabling channel tracking: ${error.message}`);
      return message.reply({
        content: 'An error occurred while enabling tracking. Please try again.',
        allowedMentions: { repliedUser: false }
      });
    }
  }

  async disableTracking(message, channelContextService, channelId) {
    try {
      if (!channelContextService.isChannelTracked(channelId)) {
        return message.reply({
          content: 'Channel context tracking is not enabled for this channel.',
          allowedMentions: { repliedUser: false }
        });
      }

      await channelContextService.disableChannel(channelId);

      logger.info(`Channel tracking disabled for ${channelId} by ${message.author.tag}`);

      return message.reply({
        content: '**Channel context tracking disabled.**\n\n' +
                 'Messages in this channel are no longer being recorded.\n' +
                 'Previously indexed messages will be retained until their expiry date.',
        allowedMentions: { repliedUser: false }
      });
    } catch (error) {
      logger.error(`Error disabling channel tracking: ${error.message}`);
      return message.reply({
        content: 'An error occurred while disabling tracking. Please try again.',
        allowedMentions: { repliedUser: false }
      });
    }
  }
}

module.exports = ChannelTrackCommand;
