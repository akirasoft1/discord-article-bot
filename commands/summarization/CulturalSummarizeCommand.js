const BaseCommand = require('../base/BaseCommand');
const config = require('../../config/config');
const { shouldRedirectToLinkwarden, getLinkwardenRedirectMessage } = require('../../utils/linkwardenRedirect');

class CulturalSummarizeCommand extends BaseCommand {
  constructor(summarizationService) {
    super({
      name: 'cultural_summarize',
      aliases: ['cultsum', 'cultural'],
      description: 'Summarize an article with cultural context',
      category: 'summarization',
      usage: '!cultural_summarize <url> <cultural_context>',
      examples: [
        '!cultural_summarize https://example.com/article japanese',
        '!cultural_summarize https://example.com/article indian'
      ],
      args: [
        { name: 'url', required: false, type: 'url' },
        { name: 'cultural_context', required: false, type: 'string' }
      ]
    });
    this.summarizationService = summarizationService;
  }

  async execute(message, args) {
    // When Linkwarden is enabled, redirect users to use the browser extension
    if (shouldRedirectToLinkwarden()) {
      return message.reply(getLinkwardenRedirectMessage());
    }

    const [url, culturalContext] = args;

    if (!url || !culturalContext) {
      return message.reply('Please provide a URL and cultural context. Usage: `!cultural_summarize <url> <context>`');
    }

    if (!config.bot.culturalContext.contexts[culturalContext]) {
      const availableContexts = Object.keys(config.bot.culturalContext.contexts).join(', ');
      return message.reply(`Invalid cultural context. Available contexts: ${availableContexts}`);
    }

    const content = await this.summarizationService.fetchContent(url, message);
    if (content === false) return;

    const summary = await this.summarizationService.generateCulturalContextSummary(content, url, culturalContext);
    if (summary) {
      return message.channel.send(`**Summary from ${culturalContext} cultural context:**\n${summary}`);
    } else {
      return message.channel.send(`Sorry, I could not generate a summary with the ${culturalContext} cultural context.`);
    }
  }
}

module.exports = CulturalSummarizeCommand;