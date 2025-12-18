// commands/slash/ForgetCommand.js
// Slash command to delete memories

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const logger = require('../../logger');

class ForgetSlashCommand extends BaseSlashCommand {
  constructor(mem0Service) {
    super({
      data: new SlashCommandBuilder()
        .setName('forget')
        .setDescription('Delete a memory or all memories')
        .addStringOption(option =>
          option.setName('memory_id')
            .setDescription('Memory ID to delete, or "all" to delete everything')
            .setRequired(true)),
      deferReply: true,
      ephemeral: true,
      cooldown: 5
    });

    this.mem0Service = mem0Service;
    this.pendingConfirmations = new Map();
  }

  async execute(interaction, context) {
    const memoryId = interaction.options.getString('memory_id');
    const userId = interaction.user.id;

    this.logExecution(interaction, `memory_id=${memoryId}`);

    if (memoryId.toLowerCase() === 'all') {
      // Show confirmation buttons
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`forget_confirm_${userId}`)
          .setLabel('Yes, delete all memories')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`forget_cancel_${userId}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({
        content: 'Are you sure you want to delete **all** your memories? This cannot be undone.',
        components: [row],
        ephemeral: true
      });

      // Store pending confirmation
      this.pendingConfirmations.set(userId, {
        timestamp: Date.now(),
        interaction
      });

      return;
    }

    // Delete specific memory
    const result = await this.mem0Service.deleteMemory(memoryId, userId);

    if (result.success) {
      await this.sendReply(interaction, {
        content: `Memory deleted successfully.`,
        ephemeral: true
      });
    } else {
      await this.sendError(interaction, result.error || 'Failed to delete memory. Make sure the memory ID is correct.');
    }
  }

  /**
   * Handle button interactions for confirmation
   * @param {ButtonInteraction} interaction
   */
  async handleButton(interaction) {
    const userId = interaction.user.id;

    if (interaction.customId === `forget_confirm_${userId}`) {
      await interaction.deferUpdate();

      const result = await this.mem0Service.deleteAllMemories(userId);

      if (result.success) {
        await interaction.editReply({
          content: `All your memories have been deleted. I no longer remember anything about you.`,
          components: [],
          ephemeral: true
        });
      } else {
        await interaction.editReply({
          content: `Error: ${result.error || 'Failed to delete memories.'}`,
          components: [],
          ephemeral: true
        });
      }

      this.pendingConfirmations.delete(userId);

    } else if (interaction.customId === `forget_cancel_${userId}`) {
      await interaction.update({
        content: 'Memory deletion cancelled.',
        components: [],
        ephemeral: true
      });

      this.pendingConfirmations.delete(userId);
    }
  }
}

module.exports = ForgetSlashCommand;
