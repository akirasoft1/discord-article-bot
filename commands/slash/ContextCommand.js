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
    const recentMessages = await this.channelContextService.getRecentContext(channelId, 5);

    const embed = new EmbedBuilder()
      .setTitle('Channel Context')
      .setDescription(`Context awareness for <#${channelId}>`)
      .setColor(0x5865F2);

    // Stats
    embed.addFields({
      name: 'Statistics',
      value: [
        `**In-memory buffer:** ${stats.bufferCount || 0} messages`,
        `**Indexed (searchable):** ${stats.indexedCount || 0} messages`,
        `**Pending indexing:** ${stats.pendingCount || 0} messages`,
        `**Channel facts:** ${stats.factsCount || 0}`
      ].join('\n'),
      inline: false
    });

    // Recent messages preview
    if (recentMessages && recentMessages.length > 0) {
      const preview = recentMessages.map(m => {
        const content = m.content.length > 80 ? m.content.substring(0, 77) + '...' : m.content;
        return `**${m.authorName}:** ${content}`;
      }).join('\n');

      embed.addFields({
        name: 'Recent Messages (last 5)',
        value: preview,
        inline: false
      });
    }

    embed.setFooter({
      text: 'Context is automatically injected into chat responses'
    });

    await interaction.editReply({ embeds: [embed] });
  }
}

module.exports = ContextSlashCommand;
