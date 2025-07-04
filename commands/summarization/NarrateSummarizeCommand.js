const BaseCommand = require('../base/BaseCommand');
const config = require('../../config/config');

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
        '!narrate_summarize https://example.com/article david_attenborough',
        '!narrate_summarize https://example.com/article gordon_ramsay'
      ],
      args: [
        { name: 'url', required: true, type: 'url' },
        { name: 'narrator', required: false, type: 'string' }
      ]
    });
    this.summarizationService = summarizationService;
  }

  async execute(message, args) {
    const [url, narrator] = args;
    
    if (narrator && !config.bot.celebrityNarrators.narrators[narrator]) {
      const availableNarrators = Object.keys(config.bot.celebrityNarrators.narrators).join(', ');
      return message.reply(`Invalid narrator. Available narrators: ${availableNarrators}`);
    }
    
    return this.summarizationService.processUrl(url, message, message.author, null, null, narrator);
  }
}

module.exports = NarrateSummarizeCommand;