const BaseCommand = require('../base/BaseCommand');

class PopularSourcesCommand extends BaseCommand {
  constructor(analyticsService) {
    super({
      name: 'popular_sources',
      aliases: ['sources'],
      description: 'View the most popular news sources on the server',
      category: 'analytics',
      usage: '!popular_sources',
      examples: [
        '!popular_sources',
        '!sources'
      ]
    });
    this.analyticsService = analyticsService;
  }

  async execute(message, args) {
    const popularSourcesMessage = await this.analyticsService.getPopularSources();
    return message.channel.send(popularSourcesMessage);
  }
}

module.exports = PopularSourcesCommand;