// commands/slash/ChatResetCommand.js
// Admin slash command to reset a personality's conversation history

const { SlashCommandBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const personalityManager = require('../../personalities');
const logger = require('../../logger');

class ChatResetSlashCommand extends BaseSlashCommand {
  constructor(chatService) {
    const personalities = personalityManager.list();
    const choices = personalities.slice(0, 25).map(p => ({
      name: `${p.emoji} ${p.name}`,
      value: p.id
    }));

    super({
      data: new SlashCommandBuilder()
        .setName('chatreset')
        .setDescription('Reset a personality\'s conversation history (admin only)')
        .addStringOption(option => {
          option.setName('personality')
            .setDescription('Which personality to reset')
            .setRequired(true);
          if (choices.length > 0) {
            option.addChoices(...choices);
          }
          return option;
        }),
      adminOnly: true,
      cooldown: 5
    });

    this.chatService = chatService;
  }

  async execute(interaction, context) {
    const personalityId = interaction.options.getString('personality');
    const channelId = interaction.channel.id;

    this.logExecution(interaction, `personality=${personalityId}`);

    const personality = personalityManager.get(personalityId);
    if (!personality) {
      await this.sendError(interaction, 'Unknown personality.');
      return;
    }

    // Correct parameter order: channelId first, then personalityId
    const result = await this.chatService.resetConversation(channelId, personalityId);

    if (result.success) {
      await interaction.reply({
        content: `${personality.emoji} Conversation with **${personality.name}** has been reset. They will have no memory of previous messages.`,
        ephemeral: false
      });
    } else {
      await this.sendError(interaction, result.error || 'Failed to reset conversation.');
    }
  }
}

module.exports = ChatResetSlashCommand;
