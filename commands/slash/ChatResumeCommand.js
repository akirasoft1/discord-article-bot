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

    // Use resumeChat method which handles both restore and chat in one call
    const result = await this.chatService.resumeChat(
      personalityId,
      userMessage,
      interaction.user,
      channelId,
      guildId
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
