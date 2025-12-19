// commands/slash/ContextCommand.js
// Slash command to view channel conversation context

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const logger = require('../../logger');

class ContextSlashCommand extends BaseSlashCommand {
  constructor(channelContextService) {
    super({
      data: new SlashCommandBuilder()
        .setName('context')
        .setDescription('View what I know about recent channel conversation'),
      deferReply: true,
      cooldown: 10
    });

    this.channelContextService = channelContextService;
  }

  async execute(interaction, context) {
    this.logExecution(interaction);

    const channelId = interaction.channel.id;

    if (!this.channelContextService) {
      await this.sendReply(interaction, {
        content: 'Channel context tracking is not enabled.',
        ephemeral: true
      });
      return;
    }

    const isTracked = this.channelContextService.isChannelTracked(channelId);

    if (!isTracked) {
      await this.sendReply(interaction, {
        content: 'This channel is not being tracked. An admin can enable tracking with `/channeltrack enable`.',
        ephemeral: true
      });
      return;
    }

    const stats = await this.channelContextService.getChannelStats(channelId);
    const recentMessages = this.channelContextService.getRecentContext(channelId, 5);
    const channelFacts = await this.channelContextService.getChannelFacts(channelId);

    const embed = new EmbedBuilder()
      .setTitle('Channel Context')
      .setDescription(`Context awareness for <#${channelId}>`)
      .setColor(0x5865F2);

    // Stats
    const statsLines = [
      `**In-memory buffer:** ${stats.bufferCount || 0} messages`,
      `**Indexed (searchable):** ${stats.indexedCount || 0} messages`
    ];
    if (stats.pendingCount > 0) {
      statsLines.push(`**Pending indexing:** ${stats.pendingCount || 0} messages`);
    }
    if (stats.lastActivity) {
      statsLines.push(`**Last activity:** ${this.formatTimeAgo(stats.lastActivity)}`);
    }
    embed.addFields({
      name: 'Statistics',
      value: statsLines.join('\n'),
      inline: false
    });

    // Recent messages preview
    if (recentMessages && recentMessages.length > 0) {
      // recentMessages can be a formatted string or array depending on the method
      let preview;
      if (typeof recentMessages === 'string') {
        preview = recentMessages.length > 500 ? recentMessages.substring(0, 497) + '...' : recentMessages;
      } else {
        preview = recentMessages.map(m => {
          const content = m.content.length > 80 ? m.content.substring(0, 77) + '...' : m.content;
          return `**${m.authorName}:** ${content}`;
        }).join('\n');
      }

      embed.addFields({
        name: 'Recent Messages (last 5)',
        value: preview || 'No recent messages',
        inline: false
      });
    }

    // Channel facts from Mem0
    if (channelFacts && channelFacts.trim().length > 0) {
      const truncatedFacts = channelFacts.length > 1000 ? channelFacts.substring(0, 997) + '...' : channelFacts;
      embed.addFields({
        name: 'Channel Facts (learned patterns)',
        value: truncatedFacts,
        inline: false
      });
    }

    embed.setFooter({
      text: 'Context is automatically injected into chat responses'
    });

    await interaction.editReply({ embeds: [embed] });
  }

  /**
   * Format a date as "X time ago"
   * @param {Date} date - Date to format
   * @returns {string} Formatted time ago string
   */
  formatTimeAgo(date) {
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

module.exports = ContextSlashCommand;
