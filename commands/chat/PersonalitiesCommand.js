// commands/chat/PersonalitiesCommand.js
const BaseCommand = require('../base/BaseCommand');

class PersonalitiesCommand extends BaseCommand {
  constructor(chatService) {
    super({
      name: 'personalities',
      aliases: ['chars', 'characters'],
      description: 'List all available chat personalities',
      category: 'chat',
      usage: '!personalities',
      examples: [
        '!personalities',
        '!chars'
      ]
    });
    this.chatService = chatService;
  }

  async execute(message) {
    const personalities = this.chatService.listPersonalities();

    if (personalities.length === 0) {
      return message.reply({
        content: 'No personalities are currently available.',
        allowedMentions: { repliedUser: false }
      });
    }

    const header = '🎭 **Available Chat Personalities**\n\n';
    const list = personalities.map(p =>
      `${p.emoji} **${p.id}**\n` +
      `   *${p.name}*\n` +
      `   ${p.description}`
    ).join('\n\n');

    const footer = '\n\n**Usage:** `!chat <personality-id> <your message>`\n' +
                   '**Example:** `!chat noir-detective What do you think about AI?`';

    const response = header + list + footer;

    return message.reply({
      content: response,
      allowedMentions: { repliedUser: false }
    });
  }
}

module.exports = PersonalitiesCommand;
