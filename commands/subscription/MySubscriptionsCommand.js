const BaseCommand = require('../base/BaseCommand');

class MySubscriptionsCommand extends BaseCommand {
  constructor(subscriptionService) {
    super({
      name: 'my_subscriptions',
      aliases: ['mysubs', 'subscriptions'],
      description: 'List your current news topic subscriptions',
      category: 'subscription',
      usage: '!my_subscriptions',
      examples: [
        '!my_subscriptions',
        '!mysubs'
      ]
    });
    this.subscriptionService = subscriptionService;
  }

  async execute(message, args) {
    const { success, message: replyMessage } = await this.subscriptionService.listSubscriptions(
      message.author.id
    );
    return message.reply(replyMessage);
  }
}

module.exports = MySubscriptionsCommand;