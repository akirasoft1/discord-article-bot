// commands/slash/ChatResumeCommand.js
// Slash command to resume an expired conversation

const { SlashCommandBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const TextUtils = require('../../utils/textUtils');
const personalityManager = require('../../personalities');
const logger = require('../../logger');

class ChatResumeSlashCommand extends BaseSlashCommand {
  constructor(chatService) {
    const personalities = personalityManager.list();
    const choices = personalities.slice(0, 25).map(p => ({
      name: `${p.emoji} ${p.name}`,
      value: p.id
    }));

    super({
      data: new SlashCommandBuilder()
        .setName('chatresume')
        .setDescription('Resume an expired conversation with a personality')
        .addStringOption(option => {
          option.setName('personality')
            .setDescription('Which personality to resume')
            .setRequired(true);
          if (choices.length > 0) {
            option.addChoices(...choices);
          }
          return option;
        })
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
    const personalityId = interaction.options.getString('personality');
    const userMessage = interaction.options.getString('message');
    const channelId = interaction.channel.id;
    const guildId = interaction.guild?.id || null;

    this.logExecution(interaction, `personality=${personalityId}`);

    const personality = personalityManager.get(personalityId);
    if (!personality) {
      await this.sendError(interaction, 'Unknown personality.');
      return;
    }

    // Try to restore the previous conversation
    const restored = await this.chatService.restoreConversation(personalityId, channelId);

    if (!restored) {
      await this.sendReply(interaction, {
        content: `${personality.emoji} No expired conversation found with **${personality.name}**. Use \`/chat\` to start a new conversation.`
      });
      return;
    }

    // Continue the conversation
    const result = await this.chatService.chat(
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
      `${result.personality.emoji} **${result.personality.name}** *(conversation resumed)*\n\n${result.message}`
    );

    await this.sendLongResponse(interaction, response);
  }
}

module.exports = ChatResumeSlashCommand;
