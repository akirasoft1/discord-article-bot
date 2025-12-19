// commands/slash/ChatCommand.js
// Slash command for chatting with AI personalities

const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const TextUtils = require('../../utils/textUtils');
const logger = require('../../logger');
const personalityManager = require('../../personalities');

class ChatSlashCommand extends BaseSlashCommand {
  constructor(chatService) {
    // Build personality choices dynamically
    const personalities = personalityManager.list();
    const choices = personalities.slice(0, 25).map(p => ({
      name: `${p.emoji} ${p.name}`,
      value: p.id
    }));

    super({
      data: new SlashCommandBuilder()
        .setName('chat')
        .setDescription('Chat with an AI personality')
        .addStringOption(option =>
          option.setName('message')
            .setDescription('Your message to the personality')
            .setRequired(true)
            .setMaxLength(2000))
        .addStringOption(option => {
          option.setName('personality')
            .setDescription('Which personality to chat with (default: friendly)')
            .setRequired(false);
          // Add choices if we have them
          if (choices.length > 0) {
            option.addChoices(...choices);
          }
          return option;
        })
        .addAttachmentOption(option =>
          option.setName('image')
            .setDescription('Optional image to include in the conversation')
            .setRequired(false)),
      deferReply: true,
      cooldown: 0
    });

    this.chatService = chatService;
  }

  async execute(interaction, context) {
    const personalityId = interaction.options.getString('personality') || 'friendly';
    const userMessage = interaction.options.getString('message');
    const attachment = interaction.options.getAttachment('image');
    const channelId = interaction.channel.id;
    const guildId = interaction.guild?.id || null;

    this.logExecution(interaction, `personality=${personalityId}`);

    // Get image URL if attachment provided
    let imageUrl = null;
    if (attachment) {
      const validImageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
      if (validImageTypes.includes(attachment.contentType)) {
        imageUrl = attachment.url;
      } else {
        await this.sendError(interaction, 'Please attach a valid image file (PNG, JPEG, GIF, or WebP).');
        return;
      }
    }

    // Call chat service
    const result = await this.chatService.chat(
      personalityId,
      userMessage,
      interaction.user,
      channelId,
      guildId,
      imageUrl
    );

    if (!result.success) {
      if (result.availablePersonalities) {
        const availableList = result.availablePersonalities
          .map(p => `\`${p.id}\` - ${p.emoji} ${p.name}`)
          .join('\n');
        await this.sendReply(interaction, {
          content: `Unknown personality. Available options:\n${availableList}`
        });
        return;
      }
      // Handle specific error reasons with helpful messages (without "Error: " prefix)
      if (result.reason === 'expired' || result.reason === 'message_limit' || result.reason === 'token_limit') {
        await this.sendReply(interaction, {
          content: result.error
        });
        return;
      }
      await this.sendError(interaction, result.error);
      return;
    }

    // Format response with personality header and wrap URLs
    const response = TextUtils.wrapUrls(
      `${result.personality.emoji} **${result.personality.name}**\n\n${result.message}`
    );

    // Convert any generated images to Discord attachments
    const imageAttachments = [];
    if (result.images && result.images.length > 0) {
      for (let i = 0; i < result.images.length; i++) {
        const img = result.images[i];
        try {
          const buffer = Buffer.from(img.base64, 'base64');
          const attachment = new AttachmentBuilder(buffer, {
            name: `generated_image_${i + 1}.png`
          });
          imageAttachments.push(attachment);
          logger.info(`Prepared image attachment: generated_image_${i + 1}.png`);
        } catch (error) {
          logger.error(`Failed to create image attachment: ${error.message}`);
        }
      }
    }

    // Send response with images if any, handling long messages
    if (imageAttachments.length > 0) {
      // For messages with images, send text first then images
      await this.sendLongResponse(interaction, response);
      await interaction.followUp({ files: imageAttachments });
    } else {
      await this.sendLongResponse(interaction, response);
    }
  }
}

module.exports = ChatSlashCommand;
