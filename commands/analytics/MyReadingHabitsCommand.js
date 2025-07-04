const BaseCommand = require('../base/BaseCommand');

class MyReadingHabitsCommand extends BaseCommand {
  constructor(analyticsService) {
    super({
      name: 'my_reading_habits',
      aliases: ['myhabits', 'reading_habits'],
      description: 'View your personal reading habits and statistics',
      category: 'analytics',
      usage: '!my_reading_habits',
      examples: [
        '!my_reading_habits',
        '!myhabits'
      ]
    });
    this.analyticsService = analyticsService;
  }

  async execute(message, args) {
    const readingHabitsMessage = await this.analyticsService.getUserReadingHabits(message.author.id);
    return message.reply(readingHabitsMessage);
  }
}

module.exports = MyReadingHabitsCommand;