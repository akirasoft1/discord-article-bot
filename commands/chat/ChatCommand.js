// commands/chat/ChatCommand.js
const BaseCommand = require('../base/BaseCommand');
const { validateImageAttachment, getSupportedFormatsText } = require('../../utils/imageValidation');

const DEFAULT_PERSONALITY = 'friendly';

class ChatCommand extends BaseCommand {
  constructor(chatService) {
    super({
      name: 'chat',
      aliases: ['c', 'talk'],
      description: 'Chat with a personality (defaults to friendly assistant). Supports image attachments!',
      category: 'chat',
      usage: '!chat [personality] <message> [image attachment]',
      examples: [
        '!chat What do you think about AI?',
        '!chat noir-detective Tell me a story',
        '!chat grumpy-historian Tell me about the internet',
        '!c How is the weather today?',
        '!chat What is in this image? [attach image]'
      ],
      args: [
        { name: 'personality', required: false, type: 'string' },
        { name: 'message', required: true, type: 'string' }
      ]
    });
    this.chatService = chatService;
  }

  async execute(message, args) {
    // Check for image attachments
    const imageAttachment = message.attachments.find(att =>
      att.contentType?.startsWith('image/') ||
      /\.(png|jpe?g|webp|gif)$/i.test(att.name)
    );

    // If only an image with no text, provide guidance
    if (args.length === 0 && !imageAttachment) {
      const personalities = this.chatService.listPersonalities();
      const list = personalities.map(p => `${p.emoji} **${p.id}** - ${p.description}`).join('\n');
      return message.reply({
        content: `**Usage:** \`!chat [personality] <message>\`\n\nPersonality is optional - defaults to **friendly** assistant.\nYou can also attach an image to ask questions about it!\n\n**Available Personalities:**\n${list}`,
        allowedMentions: { repliedUser: false }
      });
    }

    // Validate image attachment if present
    let imageUrl = null;
    let imageWarning = null;

    if (imageAttachment) {
      const validation = await validateImageAttachment(imageAttachment);

      if (!validation.valid) {
        return message.reply({
          content: validation.error,
          allowedMentions: { repliedUser: false }
        });
      }

      if (validation.warning) {
        imageWarning = validation.warning;
      }

      imageUrl = imageAttachment.url;
    }

    // Check if the first argument is a valid personality
    const firstArg = args[0]?.toLowerCase();
    const isPersonality = firstArg && this.chatService.personalityExists(firstArg);

    let personalityId;
    let userMessage;

    if (isPersonality) {
      // First arg is a personality, rest is the message
      personalityId = firstArg;
      userMessage = args.slice(1).join(' ');

      // If they specified a personality but no message (and no image), show help
      if (!userMessage.trim() && !imageUrl) {
        return message.reply({
          content: `Please provide a message. Usage: \`!chat ${personalityId} <message>\``,
          allowedMentions: { repliedUser: false }
        });
      }
    } else {
      // First arg is not a personality, use default and treat all args as message
      personalityId = DEFAULT_PERSONALITY;
      userMessage = args.join(' ');
    }

    // If there's an image but no message, use a default prompt
    if (imageUrl && !userMessage.trim()) {
      userMessage = 'What is in this image?';
    }

    // Show typing indicator
    await message.channel.sendTyping();

    // Pass channel and guild for conversation memory
    const channelId = message.channel.id;
    const guildId = message.guild?.id || null;

    const result = await this.chatService.chat(personalityId, userMessage, message.author, channelId, guildId, imageUrl);

    if (!result.success) {
      if (result.availablePersonalities) {
        const list = result.availablePersonalities.map(p => `${p.emoji} **${p.id}**`).join(', ');
        return message.reply({
          content: `Unknown personality: \`${personalityId}\`\n\nAvailable: ${list}`,
          allowedMentions: { repliedUser: false }
        });
      }
      // Handle specific error reasons with helpful messages
      if (result.reason === 'expired' || result.reason === 'message_limit' || result.reason === 'token_limit') {
        return message.reply({
          content: result.error,
          allowedMentions: { repliedUser: false }
        });
      }
      return message.reply({
        content: `Error: ${result.error}`,
        allowedMentions: { repliedUser: false }
      });
    }

    // Format response with personality header
    let response = `${result.personality.emoji} **${result.personality.name}**\n\n${result.message}`;

    // Add warning if there was an image validation warning
    if (imageWarning) {
      response = `> ${imageWarning}\n\n${response}`;
    }

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

      // Find a good break point
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

module.exports = ChatCommand;
