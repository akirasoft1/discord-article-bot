const BaseCommand = require('../base/BaseCommand');

class UnsubscribeCommand extends BaseCommand {
  constructor(subscriptionService) {
    super({
      name: 'unsubscribe',
      description: 'Unsubscribe from news topics',
      category: 'subscription',
      usage: '!unsubscribe <topic>',
      examples: [
        '!unsubscribe technology',
        '!unsubscribe artificial intelligence'
      ],
      args: [
        { name: 'topic', required: true, type: 'string' }
      ]
    });
    this.subscriptionService = subscriptionService;
  }

  async execute(message, args) {
    const topic = args.join(' ');
    const { success, message: replyMessage } = await this.subscriptionService.unsubscribe(
      message.author.id, 
      topic
    );
    return message.reply(replyMessage);
  }
}

module.exports = UnsubscribeCommand;