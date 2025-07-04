const BaseCommand = require('../base/BaseCommand');
const config = require('../../config/config');

class HistoricalSummarizeCommand extends BaseCommand {
  constructor(summarizationService) {
    super({
      name: 'historical_summarize',
      aliases: ['histsum'],
      description: 'Summarize an article from a historical perspective',
      category: 'summarization',
      usage: '!historical_summarize <url> [perspective]',
      examples: [
        '!historical_summarize https://example.com/article ancient',
        '!historical_summarize https://example.com/article medieval',
        '!historical_summarize https://example.com/article victorian'
      ],
      args: [
        { name: 'url', required: true, type: 'url' },
        { name: 'perspective', required: false, type: 'string' }
      ]
    });
    this.summarizationService = summarizationService;
  }

  async execute(message, args) {
    const [url, perspective] = args;
    
    if (perspective && !config.bot.historicalPerspectives.perspectives[perspective]) {
      const availablePerspectives = Object.keys(config.bot.historicalPerspectives.perspectives).join(', ');
      return message.reply(`Invalid historical perspective. Available perspectives: ${availablePerspectives}`);
    }
    
    return this.summarizationService.processUrl(url, message, message.author, null, null, null, perspective);
  }
}

module.exports = HistoricalSummarizeCommand;