const BaseCommand = require('../base/BaseCommand');
const config = require('../../config/config');

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
        '!resummarize https://example.com/article bullet',
        '!resummarize https://example.com/article technical'
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
    
    // Call processUrl with forceReSummarize flag
    return this.summarizationService.processUrl(url, message, message.author, style, true);
  }
}

module.exports = ReSummarizeCommand;