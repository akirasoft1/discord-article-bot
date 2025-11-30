// commands/chat/ResetChatCommand.js
const BaseCommand = require('../base/BaseCommand');

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
    // Check for "bot admin" role
    const member = message.member;
    if (!member) {
      return message.reply({
        content: 'This command can only be used in a server.',
        allowedMentions: { repliedUser: false }
      });
    }

    const hasAdminRole = member.roles.cache.some(role =>
      role.name.toLowerCase() === 'bot admin'
    );

    if (!hasAdminRole) {
      return message.reply({
        content: 'Only users with the "bot admin" role can reset conversations.',
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
