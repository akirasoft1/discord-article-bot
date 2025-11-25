const BaseCommand = require('../base/BaseCommand');
const config = require('../../config/config');
const { shouldRedirectToLinkwarden, getLinkwardenRedirectMessage } = require('../../utils/linkwardenRedirect');

class SummarizeCommand extends BaseCommand {
  constructor(summarizationService) {
    super({
      name: 'summarize',
      aliases: ['sum'],
      description: 'Summarize an article from a URL (redirects to Linkwarden when enabled)',
      category: 'summarization',
      usage: '!summarize <url> [style]',
      examples: [
        '!summarize https://example.com/article',
        '!summarize https://example.com/article pirate'
      ],
      args: [
        { name: 'url', required: false, type: 'url' },
        { name: 'style', required: false, type: 'string' }
      ]
    });
    this.summarizationService = summarizationService;
  }

  async execute(message, args) {
    // When Linkwarden is enabled, redirect users to use the browser extension
    if (shouldRedirectToLinkwarden()) {
      return message.reply(getLinkwardenRedirectMessage());
    }

    // Fallback to original behavior if Linkwarden is not enabled
    const [url, style] = args;

    if (!url) {
      return message.reply('Please provide a URL to summarize. Usage: `!summarize <url> [style]`');
    }

    if (style && !config.bot.summaryStyles.styles[style]) {
      const availableStyles = Object.keys(config.bot.summaryStyles.styles).join(', ');
      return message.reply(`Invalid summary style. Available styles: ${availableStyles}`);
    }

    return this.summarizationService.processUrl(url, message, message.author, style);
  }
}

module.exports = SummarizeCommand;