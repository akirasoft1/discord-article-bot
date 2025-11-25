const BaseCommand = require('../base/BaseCommand');
const config = require('../../config/config');
const { shouldRedirectToLinkwarden, getLinkwardenRedirectMessage } = require('../../utils/linkwardenRedirect');

class HistoricalSummarizeCommand extends BaseCommand {
  constructor(summarizationService) {
    super({
      name: 'historical_summarize',
      aliases: ['histsum'],
      description: 'Summarize an article from a historical perspective',
      category: 'summarization',
      usage: '!historical_summarize <url> [perspective]',
      examples: [
        '!historical_summarize https://example.com/article 1950s',
        '!historical_summarize https://example.com/article victorian'
      ],
      args: [
        { name: 'url', required: false, type: 'url' },
        { name: 'perspective', required: false, type: 'string' }
      ]
    });
    this.summarizationService = summarizationService;
  }

  async execute(message, args) {
    // When Linkwarden is enabled, redirect users to use the browser extension
    if (shouldRedirectToLinkwarden()) {
      return message.reply(getLinkwardenRedirectMessage());
    }

    const [url, perspective] = args;

    if (!url) {
      return message.reply('Please provide a URL. Usage: `!historical_summarize <url> [perspective]`');
    }

    if (perspective && !config.bot.historicalPerspectives.perspectives[perspective]) {
      const availablePerspectives = Object.keys(config.bot.historicalPerspectives.perspectives).join(', ');
      return message.reply(`Invalid historical perspective. Available perspectives: ${availablePerspectives}`);
    }

    return this.summarizationService.processUrl(url, message, message.author, null, false, null, null, perspective);
  }
}

module.exports = HistoricalSummarizeCommand;