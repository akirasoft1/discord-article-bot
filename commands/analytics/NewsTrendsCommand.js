const BaseCommand = require('../base/BaseCommand');

class NewsTrendsCommand extends BaseCommand {
  constructor(analyticsService) {
    super({
      name: 'news_trends',
      aliases: ['trends'],
      description: 'View current news trends on the server',
      category: 'analytics',
      usage: '!news_trends',
      examples: [
        '!news_trends',
        '!trends'
      ]
    });
    this.analyticsService = analyticsService;
  }

  async execute(message, args) {
    const trendsMessage = await this.analyticsService.getServerNewsTrends();
    return message.channel.send(trendsMessage);
  }
}

module.exports = NewsTrendsCommand;