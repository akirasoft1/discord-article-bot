const BaseCommand = require('../base/BaseCommand');

class PollCommand extends BaseCommand {
  constructor(summarizationService) {
    super({
      name: 'poll',
      description: 'Generate a poll based on an article',
      category: 'utility',
      usage: '!poll <url>',
      examples: [
        '!poll https://example.com/article'
      ],
      args: [
        { name: 'url', required: true, type: 'url' }
      ]
    });
    this.summarizationService = summarizationService;
  }

  async execute(message, args) {
    const [url] = args;
    
    const content = await this.summarizationService.fetchContent(url, message);
    if (content === false) return;
    
    const summary = await this.summarizationService.generateSummary(content, url);
    if (summary && summary.summary) {
      const pollQuestion = await this.summarizationService.pollService.generatePoll(summary.summary);
      if (pollQuestion) {
        return this.summarizationService.pollService.createDiscordPoll(message.channel, pollQuestion);
      } else {
        return message.channel.send('Sorry, I could not generate a poll for this article.');
      }
    } else {
      return message.channel.send('Sorry, I could not summarize the article to generate a poll.');
    }
  }
}

module.exports = PollCommand;