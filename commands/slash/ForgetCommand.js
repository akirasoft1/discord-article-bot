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
    // Check if Mem0 service is enabled
    if (!this.mem0Service.isEnabled()) {
      await this.sendReply(interaction, {
        content: 'Memory feature is not enabled on this bot.',
        ephemeral: true
      });
      return;
    }

    const memoryIdInput = interaction.options.getString('memory_id');
    const userId = interaction.user.id;

    this.logExecution(interaction, `memory_id=${memoryIdInput}`);

    if (memoryIdInput.toLowerCase() === 'all') {
      // First check how many memories they have
      const memResult = await this.mem0Service.getUserMemories(userId, { limit: 100 });
      const memoryCount = memResult.results?.length || 0;

      if (memoryCount === 0) {
        await this.sendReply(interaction, {
          content: 'You have no memories to delete.',
          ephemeral: true
        });
        return;
      }

      // Show confirmation buttons
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`forget_confirm_${userId}`)
          .setLabel(`Yes, delete all ${memoryCount} memories`)
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`forget_cancel_${userId}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({
        content: `⚠️ **Warning:** This will delete **all ${memoryCount} memories** I have about you.\n\nThis action cannot be undone.`,
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

    // Check if input is a number (memory list position)
    const memoryNumber = parseInt(memoryIdInput, 10);
    if (!isNaN(memoryNumber) && memoryNumber > 0) {
      // Delete by position number
      const memResult = await this.mem0Service.getUserMemories(userId, { limit: 20 });
      const memories = memResult.results || [];

      if (memories.length === 0) {
        await this.sendReply(interaction, {
          content: 'You have no memories to delete.',
          ephemeral: true
        });
        return;
      }

      if (memoryNumber > memories.length) {
        await this.sendError(interaction, `Invalid number. You have ${memories.length} memories. Use a number between 1 and ${memories.length}.`);
        return;
      }

      // Get the memory at this position (1-indexed)
      const memory = memories[memoryNumber - 1];
      const memoryContent = memory.memory || memory.text || 'Unknown';

      // deleteMemory only takes memoryId
      await this.mem0Service.deleteMemory(memory.id);

      await this.sendReply(interaction, {
        content: `✅ Memory #${memoryNumber} deleted: "${memoryContent.substring(0, 50)}${memoryContent.length > 50 ? '...' : ''}"`,
        ephemeral: true
      });
      return;
    }

    // Delete by full memory ID (legacy support)
    try {
      await this.mem0Service.deleteMemory(memoryIdInput);
      await this.sendReply(interaction, {
        content: `✅ Memory deleted successfully.`,
        ephemeral: true
      });
    } catch (error) {
      await this.sendError(interaction, 'Failed to delete memory. Please check the memory number is correct using `/memories`.');
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

      try {
        // Use the correct method name: deleteAllUserMemories
        await this.mem0Service.deleteAllUserMemories(userId);

        await interaction.editReply({
          content: `✅ All your memories have been deleted. I no longer remember anything about you.\n\nNew memories will be created as we chat.`,
          components: [],
          ephemeral: true
        });
      } catch (error) {
        await interaction.editReply({
          content: `Error: Failed to delete memories. Please try again later.`,
          components: [],
          ephemeral: true
        });
      }

      this.pendingConfirmations.delete(userId);

    } else if (interaction.customId === `forget_cancel_${userId}`) {
      await interaction.update({
        content: '❌ Memory deletion cancelled.',
        components: [],
        ephemeral: true
      });

      this.pendingConfirmations.delete(userId);
    }
  }
}

module.exports = ForgetSlashCommand;
