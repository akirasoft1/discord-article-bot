const BaseCommand = require('../base/BaseCommand');

class ControversyMeterCommand extends BaseCommand {
  constructor(analyticsService) {
    super({
      name: 'controversy_meter',
      aliases: ['controversy'],
      description: 'View the most controversial topics based on reactions',
      category: 'analytics',
      usage: '!controversy_meter',
      examples: [
        '!controversy_meter',
        '!controversy'
      ]
    });
    this.analyticsService = analyticsService;
  }

  async execute(message, args) {
    const controversyMessage = await this.analyticsService.getControversyMeter();
    return message.channel.send(controversyMessage);
  }
}

module.exports = ControversyMeterCommand;