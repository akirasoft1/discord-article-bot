// commands/chat/ResetChatCommand.js
const BaseCommand = require('../base/BaseCommand');
const config = require('../../config/config');

class ResetChatCommand extends BaseCommand {
  constructor(chatService) {
    super({
      name: 'chatreset',
      aliases: ['resetchat', 'cr'],
      description: 'Reset a personality conversation (bot admin only)',
      category: 'chat',
      usage: '!chatreset <personality>',
      examples: [
        '!chatreset noir-detective',
        '!chatreset grumpy-historian'
      ],
      args: [
        { name: 'personality', required: true, type: 'string' }
      ]
    });
    this.chatService = chatService;
  }

  async execute(message, args) {
    // Check if user is a bot admin (by user ID from config)
    const userId = message.author.id;
    const isAdmin = config.discord.adminUserIds.includes(userId);

    if (!isAdmin) {
      return message.reply({
        content: 'Only bot admins can reset conversations.',
        allowedMentions: { repliedUser: false }
      });
    }

    if (args.length < 1) {
      const personalities = this.chatService.listPersonalities();
      const list = personalities.map(p => `${p.emoji} **${p.id}**`).join(', ');
      return message.reply({
        content: `**Usage:** \`!chatreset <personality>\`\n\nAvailable: ${list}`,
        allowedMentions: { repliedUser: false }
      });
    }

    const personalityId = args[0].toLowerCase();
    const channelId = message.channel.id;

    const result = await this.chatService.resetConversation(channelId, personalityId);

    if (!result.success) {
      return message.reply({
        content: result.error,
        allowedMentions: { repliedUser: false }
      });
    }

    return message.reply({
      content: result.message,
      allowedMentions: { repliedUser: false }
    });
  }
}

module.exports = ResetChatCommand;
