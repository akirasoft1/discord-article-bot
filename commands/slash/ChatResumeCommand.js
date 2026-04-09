// commands/slash/ChatResumeCommand.js
// Slash command to resume an expired conversation

const { SlashCommandBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const TextUtils = require('../../utils/textUtils');
const logger = require('../../logger');

class ChatResumeSlashCommand extends BaseSlashCommand {
  constructor(chatService) {
    super({
      data: new SlashCommandBuilder()
        .setName('chatresume')
        .setDescription('Resume an expired conversation')
        .addStringOption(option =>
          option.setName('message')
            .setDescription('Your message to continue the conversation')
            .setRequired(true)
            .setMaxLength(2000)),
      deferReply: true,
      cooldown: 0
    });

    this.chatService = chatService;
  }

  async execute(interaction, context) {
    const personalityId = 'channel-voice';
    const userMessage = interaction.options.getString('message');
    const channelId = interaction.channel.id;
    const guildId = interaction.guild?.id || null;

    this.logExecution(interaction, `resuming conversation`);

    // Use resumeChat method which handles both restore and chat in one call
    const result = await this.chatService.resumeChat(
      personalityId,
      userMessage,
      interaction.user,
      channelId,
      guildId
    );

    if (!result.success) {
      await this.sendError(interaction, result.error);
      return;
    }

    const response = TextUtils.wrapUrls(
      `*(conversation resumed)*\n\n${result.message}`
    );

    await this.sendLongResponse(interaction, response);
  }
}

module.exports = ChatResumeSlashCommand;
