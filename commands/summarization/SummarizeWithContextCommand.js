const BaseCommand = require('../base/BaseCommand');
const config = require('../../config/config');

class SummarizeWithContextCommand extends BaseCommand {
  constructor(summarizationService) {
    super({
      name: 'summarize_with_context',
      aliases: ['sumctx', 'contextsum'],
      description: 'Summarize an article with historical/background context',
      category: 'summarization',
      usage: '!summarize_with_context <url> [style]',
      examples: [
        '!summarize_with_context https://example.com/article',
        '!sumctx https://example.com/article pirate',
        '!contextsum https://example.com/article academic'
      ],
      args: [
        { name: 'url', required: true, type: 'url' },
        { name: 'style', required: false, type: 'string' }
      ]
    });
    this.summarizationService = summarizationService;
  }

  async execute(message, args, context) {
    // Check if context provider is enabled
    if (!config.bot.contextProvider.enabled) {
      return this.sendReply(message, 'Context provider feature is currently disabled.', context);
    }

    const [url, style] = args;
    
    if (style && !config.bot.summaryStyles.styles[style]) {
      const availableStyles = Object.keys(config.bot.summaryStyles.styles).join(', ');
      return this.sendReply(message, `Invalid summary style. Available styles: ${availableStyles}`, context);
    }
    
    return this.summarizationService.processUrlWithContext(url, message, message.author, style);
  }
}

module.exports = SummarizeWithContextCommand;