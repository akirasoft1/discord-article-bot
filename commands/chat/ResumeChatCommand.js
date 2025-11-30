// commands/chat/ResumeChatCommand.js
const BaseCommand = require('../base/BaseCommand');

class ResumeChatCommand extends BaseCommand {
  constructor(chatService) {
    super({
      name: 'chatresume',
      aliases: ['resumechat'],
      description: 'Resume an expired conversation with a personality',
      category: 'chat',
      usage: '!chatresume <personality> <message>',
      examples: [
        '!chatresume noir-detective Where were we?',
        '!chatresume grumpy-historian Continue from before'
      ],
      args: [
        { name: 'personality', required: true, type: 'string' },
        { name: 'message', required: true, type: 'string' }
      ]
    });
    this.chatService = chatService;
  }

  async execute(message, args) {
    if (args.length < 2) {
      const personalities = this.chatService.listPersonalities();
      const list = personalities.map(p => `${p.emoji} **${p.id}**`).join(', ');
      return message.reply({
        content: `**Usage:** \`!chatresume <personality> <message>\`\n\nResume an expired conversation and continue chatting.\n\nAvailable: ${list}`,
        allowedMentions: { repliedUser: false }
      });
    }

    const personalityId = args[0].toLowerCase();
    const userMessage = args.slice(1).join(' ');

    // Show typing indicator
    await message.channel.sendTyping();

    const channelId = message.channel.id;
    const guildId = message.guild?.id || null;

    const result = await this.chatService.resumeChat(personalityId, userMessage, message.author, channelId, guildId);

    if (!result.success) {
      if (result.availablePersonalities) {
        const list = result.availablePersonalities.map(p => `${p.emoji} **${p.id}**`).join(', ');
        return message.reply({
          content: `Unknown personality: \`${personalityId}\`\n\nAvailable: ${list}`,
          allowedMentions: { repliedUser: false }
        });
      }
      return message.reply({
        content: result.error,
        allowedMentions: { repliedUser: false }
      });
    }

    // Format response with personality header and resumed indicator
    const response = `${result.personality.emoji} **${result.personality.name}** *(conversation resumed)*\n\n${result.message}`;

    // Split if too long for Discord
    if (response.length > 2000) {
      const chunks = this.splitMessage(response, 2000);
      for (const chunk of chunks) {
        await message.channel.send(chunk);
      }
    } else {
      await message.reply({
        content: response,
        allowedMentions: { repliedUser: false }
      });
    }
  }

  /**
   * Split a long message into chunks
   * @param {string} text - Text to split
   * @param {number} maxLength - Maximum length per chunk
   * @returns {Array<string>} Array of chunks
   */
  splitMessage(text, maxLength) {
    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      let breakPoint = remaining.lastIndexOf('\n', maxLength);
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = remaining.lastIndexOf(' ', maxLength);
      }
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = maxLength;
      }

      chunks.push(remaining.substring(0, breakPoint));
      remaining = remaining.substring(breakPoint).trim();
    }

    return chunks;
  }
}

module.exports = ResumeChatCommand;
