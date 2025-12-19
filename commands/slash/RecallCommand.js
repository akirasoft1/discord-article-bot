// commands/slash/RecallCommand.js
// Slash command for semantic search through IRC history

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const logger = require('../../logger');

class RecallSlashCommand extends BaseSlashCommand {
  constructor(qdrantService, nickMappingService) {
    super({
      data: new SlashCommandBuilder()
        .setName('recall')
        .setDescription('Search through IRC history')
        .addStringOption(option =>
          option.setName('query')
            .setDescription('What to search for')
            .setRequired(true)
            .setMaxLength(500))
        .addBooleanOption(option =>
          option.setName('my_messages')
            .setDescription('Only show your own messages')
            .setRequired(false))
        .addIntegerOption(option =>
          option.setName('year')
            .setDescription('Filter by year (1999-2024)')
            .setRequired(false)
            .setMinValue(1999)
            .setMaxValue(2024)),
      deferReply: true,
      cooldown: 5
    });

    this.qdrantService = qdrantService;
    this.nickMappingService = nickMappingService;
  }

  async execute(interaction, context) {
    const query = interaction.options.getString('query');
    const myMessages = interaction.options.getBoolean('my_messages') || false;
    const year = interaction.options.getInteger('year');

    this.logExecution(interaction, `query="${query}", myMessages=${myMessages}, year=${year || 'any'}`);

    // Build search options object
    const searchOptions = { limit: 5 };

    if (year) {
      searchOptions.year = year;
    }

    if (myMessages && this.nickMappingService) {
      // Get user's IRC nicks
      const ircNicks = this.nickMappingService.getIrcNicks(interaction.user.id);
      if (ircNicks && ircNicks.length > 0) {
        searchOptions.participants = ircNicks;
      } else {
        await this.sendReply(interaction, {
          content: 'You don\'t have any IRC nicks mapped to your Discord account. Ask an admin to add your nick mappings.',
          ephemeral: true
        });
        return;
      }
    }

    // Use correct signature: search(query, options)
    const results = await this.qdrantService.search(query, searchOptions);

    if (!results || results.length === 0) {
      await this.sendReply(interaction, {
        content: `No results found for "${query}"${year ? ` in ${year}` : ''}.`,
        ephemeral: false
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`IRC History Search`)
      .setDescription(`Results for: **${query}**${year ? ` (${year})` : ''}`)
      .setColor(0x5865F2)
      .setFooter({ text: `Found ${results.length} results` });

    for (const result of results) {
      const payload = result.payload || {};
      const channel = payload.channel || 'DM';
      const participants = (payload.participants || []).slice(0, 5).join(', ') || payload.nick || 'Unknown';
      const text = payload.text || payload.message || payload.content || 'No content';
      const score = result.score ? ` (${Math.round(result.score * 100)}% match)` : '';

      // Format date like the service does
      let dateStr = '';
      if (payload.start_time) {
        try {
          const date = new Date(payload.start_time);
          dateStr = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        } catch {
          dateStr = String(payload.year || '????');
        }
      } else {
        dateStr = String(payload.year || payload.date || '????');
      }

      const title = `${dateStr} - ${channel}${score}`;
      const value = text.length > 300 ? text.substring(0, 297) + '...' : text;

      embed.addFields({
        name: title,
        value: `*${participants}*\n${value}`,
        inline: false
      });
    }

    await interaction.editReply({ embeds: [embed] });
  }
}

module.exports = RecallSlashCommand;
