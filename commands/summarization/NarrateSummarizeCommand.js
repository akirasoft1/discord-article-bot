const BaseCommand = require('../base/BaseCommand');
const config = require('../../config/config');
const { shouldRedirectToLinkwarden, getLinkwardenRedirectMessage } = require('../../utils/linkwardenRedirect');

class NarrateSummarizeCommand extends BaseCommand {
  constructor(summarizationService) {
    super({
      name: 'narrate_summarize',
      aliases: ['narratesum', 'narrator'],
      description: 'Summarize an article as narrated by a celebrity',
      category: 'summarization',
      usage: '!narrate_summarize <url> [narrator]',
      examples: [
        '!narrate_summarize https://example.com/article morgan_freeman',
        '!narrate_summarize https://example.com/article gordon_ramsay'
      ],
      args: [
        { name: 'url', required: false, type: 'url' },
        { name: 'narrator', required: false, type: 'string' }
      ]
    });
    this.summarizationService = summarizationService;
  }

  async execute(message, args) {
    // When Linkwarden is enabled, redirect users to use the browser extension
    if (shouldRedirectToLinkwarden()) {
      return message.reply(getLinkwardenRedirectMessage());
    }

    const [url, narrator] = args;

    if (!url) {
      return message.reply('Please provide a URL. Usage: `!narrate_summarize <url> [narrator]`');
    }

    if (narrator && !config.bot.celebrityNarrators.narrators[narrator]) {
      const availableNarrators = Object.keys(config.bot.celebrityNarrators.narrators).join(', ');
      return message.reply(`Invalid narrator. Available narrators: ${availableNarrators}`);
    }

    return this.summarizationService.processUrl(url, message, message.author, null, false, null, narrator);
  }
}

module.exports = NarrateSummarizeCommand;