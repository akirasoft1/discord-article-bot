const BaseCommand = require('../base/BaseCommand');
const { shouldRedirectToLinkwarden, getLinkwardenRedirectMessage } = require('../../utils/linkwardenRedirect');

class LearnLanguageCommand extends BaseCommand {
  constructor(summarizationService) {
    super({
      name: 'learn_language',
      aliases: ['langsum', 'multilang'],
      description: 'Summarize an article in multiple languages for language learning',
      category: 'summarization',
      usage: '!learn_language <url> <language1> [language2] ...',
      examples: [
        '!learn_language https://example.com/article Spanish',
        '!learn_language https://example.com/article Spanish French'
      ],
      args: [
        { name: 'url', required: false, type: 'url' },
        { name: 'languages', required: false, type: 'string' }
      ]
    });
    this.summarizationService = summarizationService;
  }

  async execute(message, args) {
    // When Linkwarden is enabled, redirect users to use the browser extension
    if (shouldRedirectToLinkwarden()) {
      return message.reply(getLinkwardenRedirectMessage());
    }

    const url = args[0];
    const languages = args.slice(1).map(lang => lang.toLowerCase());

    if (!url) {
      return message.reply('Please provide a URL. Usage: `!learn_language <url> <language1> [language2] ...`');
    }

    if (languages.length === 0) {
      return message.reply('Please provide at least one target language.');
    }

    const content = await this.summarizationService.fetchContent(url, message);
    if (content === false) return;

    const multiLanguageSummaries = await this.summarizationService.generateMultiLanguageSummary(content, url, languages);
    if (multiLanguageSummaries) {
      let responseMessage = '**Multi-language Summaries:**\n';
      for (const lang in multiLanguageSummaries) {
        responseMessage += `\n**${lang.charAt(0).toUpperCase() + lang.slice(1)}:**\n${multiLanguageSummaries[lang]}\n`;
      }
      return message.channel.send(responseMessage);
    } else {
      return message.channel.send('Sorry, I could not generate multi-language summaries.');
    }
  }
}

module.exports = LearnLanguageCommand;