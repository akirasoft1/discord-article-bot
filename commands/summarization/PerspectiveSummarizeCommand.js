const BaseCommand = require('../base/BaseCommand');
const config = require('../../config/config');
const { shouldRedirectToLinkwarden, getLinkwardenRedirectMessage } = require('../../utils/linkwardenRedirect');

class PerspectiveSummarizeCommand extends BaseCommand {
  constructor(summarizationService) {
    super({
      name: 'perspective_summarize',
      aliases: ['perspsum', 'perspective'],
      description: 'Summarize an article from different political perspectives',
      category: 'summarization',
      usage: '!perspective_summarize <url> <perspective>',
      examples: [
        '!perspective_summarize https://example.com/article liberal',
        '!perspective_summarize https://example.com/article conservative'
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

    if (!url || !perspective) {
      return message.reply('Please provide a URL and perspective. Usage: `!perspective_summarize <url> <perspective>`');
    }

    if (!config.bot.alternativePerspectives.perspectives[perspective]) {
      const availablePerspectives = Object.keys(config.bot.alternativePerspectives.perspectives).join(', ');
      return message.reply(`Invalid perspective. Available perspectives: ${availablePerspectives}`);
    }

    const content = await this.summarizationService.fetchContent(url, message);
    if (content === false) return;

    const summary = await this.summarizationService.getAlternativePerspectiveSummary(content, url, perspective);
    if (summary) {
      return message.channel.send(`**Summary from ${perspective} perspective:**\n${summary}`);
    } else {
      return message.channel.send(`Sorry, I could not generate a summary from the ${perspective} perspective.`);
    }
  }
}

module.exports = PerspectiveSummarizeCommand;