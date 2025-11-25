const BaseCommand = require('../base/BaseCommand');
const config = require('../../config/config');
const { shouldRedirectToLinkwarden, getLinkwardenRedirectMessage } = require('../../utils/linkwardenRedirect');

class MoodSummarizeCommand extends BaseCommand {
  constructor(summarizationService) {
    super({
      name: 'mood_summarize',
      aliases: ['moodsum'],
      description: 'Summarize an article with a specific mood',
      category: 'summarization',
      usage: '!mood_summarize <url> [mood]',
      examples: [
        '!mood_summarize https://example.com/article monday',
        '!mood_summarize https://example.com/article friday'
      ],
      args: [
        { name: 'url', required: false, type: 'url' },
        { name: 'mood', required: false, type: 'string' }
      ]
    });
    this.summarizationService = summarizationService;
  }

  async execute(message, args) {
    // When Linkwarden is enabled, redirect users to use the browser extension
    if (shouldRedirectToLinkwarden()) {
      return message.reply(getLinkwardenRedirectMessage());
    }

    const [url, mood] = args;

    if (!url) {
      return message.reply('Please provide a URL. Usage: `!mood_summarize <url> [mood]`');
    }

    if (mood && !config.bot.moodBasedSummaries.moods[mood]) {
      const availableMoods = Object.keys(config.bot.moodBasedSummaries.moods).join(', ');
      return message.reply(`Invalid mood. Available moods: ${availableMoods}`);
    }

    return this.summarizationService.processUrl(url, message, message.author, null, false, mood);
  }
}

module.exports = MoodSummarizeCommand;