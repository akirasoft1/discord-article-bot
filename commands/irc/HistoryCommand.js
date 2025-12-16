// commands/irc/HistoryCommand.js
// View IRC history for yourself or another user

const BaseCommand = require('../base/BaseCommand');
const logger = require('../../logger');

class HistoryCommand extends BaseCommand {
  constructor() {
    super({
      name: 'history',
      aliases: ['irchistory', 'myirc'],
      description: 'View IRC history for yourself or a mentioned user',
      category: 'irc',
      usage: '!history [@user]',
      examples: [
        '!history',
        '!history @someone',
        '!myirc'
      ],
      args: [
        { name: 'user', type: 'user', required: false, description: 'Discord user to look up' }
      ]
    });
  }

  async execute(message, args, context) {
    const qdrantService = context.bot?.qdrantService;
    const nickMappingService = context.bot?.nickMappingService;

    // Check if services are available
    if (!qdrantService || !nickMappingService) {
      return message.reply({
        content: 'IRC history service is not available. Please contact the bot administrator.',
        allowedMentions: { repliedUser: false }
      });
    }

    // Determine whose history to show
    const mentionedUser = message.mentions.users.first();
    const targetUser = mentionedUser || message.author;
    const isSelf = targetUser.id === message.author.id;

    // Get IRC nicks for the target user
    const ircNicks = nickMappingService.getIrcNicks(targetUser.id);

    if (ircNicks.length === 0) {
      const whoText = isSelf ? 'You don\'t' : `${targetUser.tag} doesn't`;
      return message.reply({
        content: `${whoText} have any IRC nicks mapped to ${isSelf ? 'your' : 'their'} Discord account.\n` +
                 'Ask an admin to add nick mappings.',
        allowedMentions: { repliedUser: false }
      });
    }

    try {
      logger.info(`User ${message.author.tag} viewing IRC history for ${targetUser.tag} (nicks: ${ircNicks.join(', ')})`);

      const results = await qdrantService.getByParticipants(ircNicks, { limit: 10 });

      if (results.length === 0) {
        const whoText = isSelf ? 'your' : `${targetUser.tag}'s`;
        return message.reply({
          content: `No IRC history found for ${whoText} nicks (${ircNicks.join(', ')}).`,
          allowedMentions: { repliedUser: false }
        });
      }

      // Format results
      const formattedResults = results.slice(0, 5).map(r => qdrantService.formatResult(r));
      const whoText = isSelf ? 'Your' : `${targetUser.tag}'s`;
      const nicksText = ircNicks.slice(0, 3).join(', ') + (ircNicks.length > 3 ? '...' : '');

      let response = `📜 **${whoText} IRC History**\n`;
      response += `*Nicks: ${nicksText}*\n\n`;
      response += formattedResults.join('\n\n');

      if (results.length > 5) {
        response += `\n\n*Showing 5 of ${results.length} conversations. Use \`!recall --me <query>\` to search.*`;
      }

      // Truncate if too long
      if (response.length > 1900) {
        response = response.substring(0, 1900) + '\n\n*...truncated*';
      }

      return message.reply({
        content: response,
        allowedMentions: { repliedUser: false }
      });

    } catch (error) {
      logger.error(`HistoryCommand error: ${error.message}`);
      return message.reply({
        content: 'An error occurred while fetching IRC history. Please try again.',
        allowedMentions: { repliedUser: false }
      });
    }
  }
}

module.exports = HistoryCommand;
