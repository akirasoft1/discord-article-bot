const BaseCommand = require('../base/BaseCommand');
const config = require('../../config/config');

class MoodSummarizeCommand extends BaseCommand {
  constructor(summarizationService) {
    super({
      name: 'mood_summarize',
      aliases: ['moodsum'],
      description: 'Summarize an article with a specific mood',
      category: 'summarization',
      usage: '!mood_summarize <url> [mood]',
      examples: [
        '!mood_summarize https://example.com/article optimistic',
        '!mood_summarize https://example.com/article skeptical',
        '!mood_summarize https://example.com/article humorous'
      ],
      args: [
        { name: 'url', required: true, type: 'url' },
        { name: 'mood', required: false, type: 'string' }
      ]
    });
    this.summarizationService = summarizationService;
  }

  async execute(message, args) {
    const [url, mood] = args;
    
    if (mood && !config.bot.moodBasedSummaries.moods[mood]) {
      const availableMoods = Object.keys(config.bot.moodBasedSummaries.moods).join(', ');
      return message.reply(`Invalid mood. Available moods: ${availableMoods}`);
    }
    
    return this.summarizationService.processUrl(url, message, message.author, null, mood);
  }
}

module.exports = MoodSummarizeCommand;