const BaseCommand = require('../base/BaseCommand');

class DiscussionQuestionsCommand extends BaseCommand {
  constructor(summarizationService) {
    super({
      name: 'discussion_questions',
      aliases: ['discuss', 'questions'],
      description: 'Generate discussion questions based on an article',
      category: 'utility',
      usage: '!discussion_questions <url>',
      examples: [
        '!discussion_questions https://example.com/article',
        '!discuss https://example.com/article'
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
      const discussionQuestions = await this.summarizationService.pollService.generateDiscussionQuestions(summary.summary);
      if (discussionQuestions) {
        return message.channel.send(`**Discussion Starters:**\n${discussionQuestions}`);
      } else {
        return message.channel.send('Sorry, I could not generate discussion questions for this article.');
      }
    } else {
      return message.channel.send('Sorry, I could not summarize the article to generate discussion questions.');
    }
  }
}

module.exports = DiscussionQuestionsCommand;