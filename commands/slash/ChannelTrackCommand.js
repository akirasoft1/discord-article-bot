// commands/slash/ChannelTrackCommand.js
// Admin slash command for channel context tracking management

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const logger = require('../../logger');

class ChannelTrackSlashCommand extends BaseSlashCommand {
  constructor(channelContextService, mongoService) {
    super({
      data: new SlashCommandBuilder()
        .setName('channeltrack')
        .setDescription('Manage channel conversation tracking (admin only)')
        .addSubcommand(subcommand =>
          subcommand.setName('enable')
            .setDescription('Enable conversation tracking for this channel'))
        .addSubcommand(subcommand =>
          subcommand.setName('disable')
            .setDescription('Disable conversation tracking for this channel'))
        .addSubcommand(subcommand =>
          subcommand.setName('status')
            .setDescription('Show tracking status for this channel')),
      adminOnly: true,
      cooldown: 5
    });

    this.channelContextService = channelContextService;
    this.mongoService = mongoService;
  }

  async execute(interaction, context) {
    const subcommand = interaction.options.getSubcommand();

    this.logExecution(interaction, `subcommand=${subcommand}`);

    if (!this.channelContextService) {
      await interaction.reply({
        content: 'Channel context tracking feature is not enabled in bot configuration.',
        ephemeral: true
      });
      return;
    }

    switch (subcommand) {
      case 'enable':
        await this.handleEnable(interaction);
        break;
      case 'disable':
        await this.handleDisable(interaction);
        break;
      case 'status':
        await this.handleStatus(interaction);
        break;
    }
  }

  async handleEnable(interaction) {
    const channelId = interaction.channel.id;
    const guildId = interaction.guild?.id;
    const userId = interaction.user.id;

    if (this.channelContextService.isChannelTracked(channelId)) {
      await interaction.reply({
        content: 'This channel is already being tracked.',
        ephemeral: true
      });
      return;
    }

    await this.channelContextService.enableChannel(channelId, guildId, userId);

    await interaction.reply({
      content: [
        'Channel conversation tracking has been **enabled** for this channel.',
        '',
        '**What this means:**',
        '- Recent messages will be kept in memory for context',
        '- Messages will be indexed for semantic search',
        '- The bot will have awareness of conversation when responding',
        '- Messages are retained for 30 days then automatically deleted',
        '',
        '*Users can use `/context` to see what the bot knows about recent conversation.*'
      ].join('\n'),
      ephemeral: false
    });
  }

  async handleDisable(interaction) {
    const channelId = interaction.channel.id;

    if (!this.channelContextService.isChannelTracked(channelId)) {
      await interaction.reply({
        content: 'This channel is not currently being tracked.',
        ephemeral: true
      });
      return;
    }

    await this.channelContextService.disableChannel(channelId);

    await interaction.reply({
      content: [
        'Channel conversation tracking has been **disabled** for this channel.',
        '',
        'Previously indexed messages will remain until they expire (30 days from creation).',
        'No new messages will be recorded.'
      ].join('\n'),
      ephemeral: false
    });
  }

  async handleStatus(interaction) {
    const channelId = interaction.channel.id;
    const isTracked = this.channelContextService.isChannelTracked(channelId);

    if (!isTracked) {
      await interaction.reply({
        content: 'This channel is **not tracked**. Use `/channeltrack enable` to start tracking.',
        ephemeral: true
      });
      return;
    }

    const stats = await this.channelContextService.getChannelStats(channelId);
    const config = await this.mongoService?.getChannelTrackingConfig(channelId);

    const embed = new EmbedBuilder()
      .setTitle('Channel Tracking Status')
      .setDescription(`Status for <#${channelId}>`)
      .setColor(0x00FF00);

    embed.addFields(
      { name: 'Status', value: 'Enabled', inline: true },
      { name: 'In-Memory Buffer', value: `${stats.bufferCount || 0} messages`, inline: true },
      { name: 'Indexed', value: `${stats.indexedCount || 0} messages`, inline: true },
      { name: 'Pending Index', value: `${stats.pendingCount || 0} messages`, inline: true },
      { name: 'Channel Facts', value: `${stats.factsCount || 0}`, inline: true }
    );

    if (config) {
      const enabledAt = config.enabledAt ? new Date(config.enabledAt).toLocaleDateString() : 'Unknown';
      const enabledBy = config.enabledBy || 'Unknown';

      embed.addFields(
        { name: 'Enabled On', value: enabledAt, inline: true },
        { name: 'Enabled By', value: enabledBy === 'config' ? 'Configuration' : `<@${enabledBy}>`, inline: true }
      );
    }

    embed.setFooter({
      text: 'Messages are retained for 30 days'
    });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

module.exports = ChannelTrackSlashCommand;
