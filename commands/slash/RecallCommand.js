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

    // Build filter
    const filter = {};

    if (year) {
      filter.year = year;
    }

    if (myMessages) {
      // Get user's IRC nicks
      const mapping = await this.nickMappingService?.getMapping(interaction.user.id);
      if (mapping && mapping.ircNicks && mapping.ircNicks.length > 0) {
        filter.nicks = mapping.ircNicks;
      } else {
        await this.sendReply(interaction, {
          content: 'You don\'t have any IRC nicks mapped to your Discord account. Use the nick mapping command to set them up.',
          ephemeral: true
        });
        return;
      }
    }

    const results = await this.qdrantService.search(query, 5, filter);

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
      const date = payload.date || payload.timestamp || 'Unknown date';
      const nick = payload.nick || payload.author || 'Unknown';
      const message = payload.message || payload.content || payload.text || 'No content';
      const channel = payload.channel || '';

      const title = `${nick} ${channel ? `in ${channel}` : ''} (${date})`;
      const value = message.length > 200 ? message.substring(0, 197) + '...' : message;

      embed.addFields({ name: title, value: value, inline: false });
    }

    await interaction.editReply({ embeds: [embed] });
  }
}

module.exports = RecallSlashCommand;
