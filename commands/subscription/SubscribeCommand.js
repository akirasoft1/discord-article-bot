const BaseCommand = require('../base/BaseCommand');

class SubscribeCommand extends BaseCommand {
  constructor(subscriptionService) {
    super({
      name: 'subscribe',
      description: 'Subscribe to news topics to receive notifications',
      category: 'subscription',
      usage: '!subscribe <topic>',
      examples: [
        '!subscribe technology',
        '!subscribe artificial intelligence',
        '!subscribe climate change'
      ],
      args: [
        { name: 'topic', required: true, type: 'string' }
      ]
    });
    this.subscriptionService = subscriptionService;
  }

  async execute(message, args, context) {
    const topic = args.join(' ');
    const { success, message: replyMessage } = await this.subscriptionService.subscribe(
      message.author.id, 
      topic
    );
    
    return this.sendReply(message, replyMessage, context);
  }
}

module.exports = SubscribeCommand;