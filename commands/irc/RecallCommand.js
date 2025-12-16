// commands/irc/RecallCommand.js
// Semantic search through IRC history

const BaseCommand = require('../base/BaseCommand');
const logger = require('../../logger');

class RecallCommand extends BaseCommand {
  constructor() {
    super({
      name: 'recall',
      aliases: ['irc', 'ircsearch'],
      description: 'Search IRC history semantically',
      category: 'irc',
      usage: '!recall <query> [--me] [--year YYYY]',
      examples: [
        '!recall linux kernel',
        '!recall --me car problems',
        '!recall --year 2005 party at the lake',
        '!irc who had an STI'
      ],
      args: [
        { name: 'query', type: 'string', required: true, description: 'Search query' },
        { name: '--me', type: 'flag', description: 'Only search your IRC history' },
        { name: '--year', type: 'number', description: 'Filter by year' }
      ]
    });
  }

  async execute(message, args, context) {
    const qdrantService = context.bot?.qdrantService;
    const nickMappingService = context.bot?.nickMappingService;

    // Check if Qdrant service is available
    if (!qdrantService) {
      return message.reply({
        content: 'IRC history search is not available. Please contact the bot administrator.',
        allowedMentions: { repliedUser: false }
      });
    }

    // Parse args for flags
    const { query, flags } = this._parseArgs(args);

    // Check if query provided
    if (!query) {
      return message.reply({
        content: 'Please provide a search query.\n\n' +
                 '**Usage:** `!recall <query> [--me] [--year YYYY]`\n' +
                 '**Examples:**\n' +
                 '• `!recall linux server setup`\n' +
                 '• `!recall --me car problems`\n' +
                 '• `!recall --year 2005 road trip`',
        allowedMentions: { repliedUser: false }
      });
    }

    const userId = message.author.id;
    const searchOptions = { limit: 5 };

    // Handle --me flag: filter by user's IRC nicks
    if (flags.me && nickMappingService) {
      const ircNicks = nickMappingService.getIrcNicks(userId);
      if (ircNicks.length > 0) {
        searchOptions.participants = ircNicks;
        logger.debug(`Filtering by user's IRC nicks: ${ircNicks.join(', ')}`);
      } else {
        return message.reply({
          content: 'You don\'t have any IRC nicks mapped to your Discord account.\n' +
                   'Ask an admin to add your nick mappings.',
          allowedMentions: { repliedUser: false }
        });
      }
    }

    // Handle --year flag
    if (flags.year) {
      const year = parseInt(flags.year, 10);
      if (year >= 1999 && year <= 2024) {
        searchOptions.year = year;
      }
    }

    try {
      logger.info(`User ${message.author.tag} searching IRC history: "${query}"`);

      const results = await qdrantService.search(query, searchOptions);

      if (results.length === 0) {
        let noResultsMsg = `No IRC conversations found matching "${query}"`;
        if (flags.me) {
          noResultsMsg += ' in your history';
        }
        if (flags.year) {
          noResultsMsg += ` from ${flags.year}`;
        }
        noResultsMsg += '.';

        return message.reply({
          content: noResultsMsg,
          allowedMentions: { repliedUser: false }
        });
      }

      // Format results
      const formattedResults = results.map(r => qdrantService.formatResult(r));
      const header = flags.me ? '🔍 **Your IRC History**' : '🔍 **IRC History Search**';
      const queryInfo = flags.year ? `"${query}" (${flags.year})` : `"${query}"`;

      let response = `${header} - ${queryInfo}\n\n`;
      response += formattedResults.join('\n\n');

      // Truncate if too long for Discord
      if (response.length > 1900) {
        response = response.substring(0, 1900) + '\n\n*...results truncated*';
      }

      return message.reply({
        content: response,
        allowedMentions: { repliedUser: false }
      });

    } catch (error) {
      logger.error(`RecallCommand error: ${error.message}`);
      return message.reply({
        content: 'An error occurred while searching IRC history. Please try again.',
        allowedMentions: { repliedUser: false }
      });
    }
  }

  /**
   * Parse arguments and extract flags
   * @param {string[]} args - Command arguments
   * @returns {{ query: string, flags: Object }}
   */
  _parseArgs(args) {
    const flags = {};
    const queryParts = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg === '--me') {
        flags.me = true;
      } else if (arg === '--year' && args[i + 1]) {
        flags.year = args[i + 1];
        i++; // Skip next arg
      } else if (!arg.startsWith('--')) {
        queryParts.push(arg);
      }
    }

    return {
      query: queryParts.join(' '),
      flags
    };
  }
}

module.exports = RecallCommand;
