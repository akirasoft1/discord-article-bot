const BaseCommand = require('../base/BaseCommand');
const config = require('../../config/config');
const { shouldRedirectToLinkwarden, getLinkwardenRedirectMessage } = require('../../utils/linkwardenRedirect');

class ReSummarizeCommand extends BaseCommand {
  constructor(summarizationService) {
    super({
      name: 'resummarize',
      aliases: ['resum'],
      description: 'Force re-summarization of an article (bypasses duplicate check)',
      category: 'summarization',
      usage: '!resummarize <url> [style]',
      examples: [
        '!resummarize https://example.com/article',
        '!resummarize https://example.com/article pirate'
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

    const [url, style] = args;

    if (!url) {
      return message.reply('Please provide a URL to re-summarize. Usage: `!resummarize <url> [style]`');
    }

    if (style && !config.bot.summaryStyles.styles[style]) {
      const availableStyles = Object.keys(config.bot.summaryStyles.styles).join(', ');
      return message.reply(`Invalid summary style. Available styles: ${availableStyles}`);
    }

    // Call processUrl with forceReSummarize flag
    return this.summarizationService.processUrl(url, message, message.author, style, true);
  }
}

module.exports = ReSummarizeCommand;