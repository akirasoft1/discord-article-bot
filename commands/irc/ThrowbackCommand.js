// commands/irc/ThrowbackCommand.js
// Show a random IRC conversation from this day in history

const BaseCommand = require('../base/BaseCommand');
const logger = require('../../logger');

class ThrowbackCommand extends BaseCommand {
  constructor() {
    super({
      name: 'throwback',
      aliases: ['tbt', 'onthisday', 'otd'],
      description: 'Show a random IRC conversation from this day in history',
      category: 'irc',
      usage: '!throwback',
      examples: [
        '!throwback',
        '!tbt',
        '!onthisday'
      ],
      args: []
    });
  }

  async execute(message, args, context) {
    const qdrantService = context.bot?.qdrantService;

    // Check if service is available
    if (!qdrantService) {
      return message.reply({
        content: 'IRC history service is not available. Please contact the bot administrator.',
        allowedMentions: { repliedUser: false }
      });
    }

    const now = new Date();
    const month = now.getMonth() + 1; // JS months are 0-indexed
    const day = now.getDate();

    try {
      logger.info(`User ${message.author.tag} requested throwback for ${month}/${day}`);

      const result = await qdrantService.getRandomFromDate(month, day);

      if (!result) {
        const monthName = now.toLocaleDateString('en-US', { month: 'long' });
        return message.reply({
          content: `No IRC conversations found from ${monthName} ${day} in history.\n` +
                   'Try again tomorrow for a different throwback!',
          allowedMentions: { repliedUser: false }
        });
      }

      // Calculate years ago
      const year = result.payload?.year;
      const yearsAgo = year ? (now.getFullYear() - year) : null;

      // Format the result
      const formatted = qdrantService.formatResult(result);

      // Build response
      const monthName = now.toLocaleDateString('en-US', { month: 'long' });
      let response = `📅 **On This Day - ${monthName} ${day}**\n`;

      if (yearsAgo) {
        response += `*${yearsAgo} years ago (${year})*\n\n`;
      } else {
        response += '\n';
      }

      response += formatted;

      // Add footer
      response += '\n\n*Use `!throwback` again for another random memory*';

      // Truncate if too long
      if (response.length > 1900) {
        response = response.substring(0, 1900) + '\n\n*...truncated*';
      }

      return message.reply({
        content: response,
        allowedMentions: { repliedUser: false }
      });

    } catch (error) {
      logger.error(`ThrowbackCommand error: ${error.message}`);
      return message.reply({
        content: 'An error occurred while fetching throwback. Please try again.',
        allowedMentions: { repliedUser: false }
      });
    }
  }
}

module.exports = ThrowbackCommand;
