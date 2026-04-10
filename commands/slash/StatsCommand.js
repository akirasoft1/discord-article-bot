// commands/slash/StatsCommand.js
// Slash command to show token usage leaderboard

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');

class StatsSlashCommand extends BaseSlashCommand {
  constructor(mongoService) {
    super({
      data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Show top token consumers')
        .addIntegerOption(option =>
          option.setName('days')
            .setDescription('Number of days to look back (default: today)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(90)),
      deferReply: true,
      cooldown: 10
    });

    this.mongoService = mongoService;
  }

  async execute(interaction, context) {
    this.logExecution(interaction);

    const days = interaction.options.getInteger('days') || 1;
    const leaderboard = await this.mongoService.getTokenUsageLeaderboard(days, 5);

    if (leaderboard.length === 0) {
      await this.sendReply(interaction, {
        content: `No token usage recorded in the last ${days === 1 ? 'day' : `${days} days`}.`
      });
      return;
    }

    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    const lines = leaderboard.map((entry, i) => {
      const tokens = entry.totalTokens.toLocaleString();
      return `${medals[i]} **${entry.username}** — ${tokens} tokens (${entry.requestCount} requests)`;
    });

    const periodLabel = days === 1 ? 'Today' : `Last ${days} days`;

    const embed = new EmbedBuilder()
      .setTitle(`Token Usage — ${periodLabel}`)
      .setDescription(lines.join('\n'))
      .setColor(0x5865F2)
      .setTimestamp();

    await this.sendReply(interaction, { embeds: [embed] });
  }
}

module.exports = StatsSlashCommand;
