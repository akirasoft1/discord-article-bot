const BaseCommand = require('../base/BaseCommand');
const config = require('../../config/config');

class SummarizeCommand extends BaseCommand {
  constructor(summarizationService) {
    super({
      name: 'summarize',
      aliases: ['sum'],
      description: 'Summarize an article from a URL',
      category: 'summarization',
      usage: '!summarize <url> [style]',
      examples: [
        '!summarize https://example.com/article',
        '!summarize https://example.com/article bullet',
        '!summarize https://example.com/article technical'
      ],
      args: [
        { name: 'url', required: true, type: 'url' },
        { name: 'style', required: false, type: 'string' }
      ]
    });
    this.summarizationService = summarizationService;
  }

  async execute(message, args) {
    const [url, style] = args;
    
    if (style && !config.bot.summaryStyles.styles[style]) {
      const availableStyles = Object.keys(config.bot.summaryStyles.styles).join(', ');
      return message.reply(`Invalid summary style. Available styles: ${availableStyles}`);
    }
    
    return this.summarizationService.processUrl(url, message, message.author, style);
  }
}

module.exports = SummarizeCommand;