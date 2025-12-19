// commands/slash/MemoriesCommand.js
// Slash command to view stored memories

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const logger = require('../../logger');

class MemoriesSlashCommand extends BaseSlashCommand {
  constructor(mem0Service) {
    super({
      data: new SlashCommandBuilder()
        .setName('memories')
        .setDescription('View what I remember about you'),
      deferReply: true,
      ephemeral: true,
      cooldown: 10
    });

    this.mem0Service = mem0Service;
  }

  async execute(interaction, context) {
    this.logExecution(interaction);

    // Check if Mem0 service is enabled
    if (!this.mem0Service.isEnabled()) {
      await this.sendReply(interaction, {
        content: 'Memory feature is not enabled on this bot.',
        ephemeral: true
      });
      return;
    }

    const userId = interaction.user.id;

    // Use getUserMemories which returns { results: Array }
    const result = await this.mem0Service.getUserMemories(userId, { limit: 20 });
    const memories = result.results || [];

    if (memories.length === 0) {
      await this.sendReply(interaction, {
        content: 'I don\'t have any memories about you yet! Chat with me and I\'ll start remembering things, or use `/remember` to tell me something.',
        ephemeral: true
      });
      return;
    }

    // Format memories for display - each memory on its own line
    const memoryLines = memories.map((m, i) => {
      const content = m.memory || m.text || 'Unknown memory';
      // Truncate individual memories if too long
      const truncated = content.length > 100 ? content.substring(0, 97) + '...' : content;
      return `**${i + 1}.** ${truncated}`;
    });

    // Join with newlines and ensure we don't exceed embed field limit (1024 chars)
    let memoryText = memoryLines.join('\n');
    if (memoryText.length > 1000) {
      // Find a safe truncation point
      memoryText = memoryText.substring(0, 997) + '...';
    }

    // Ensure memoryText is never empty (Discord requires non-empty field values)
    if (!memoryText || memoryText.trim().length === 0) {
      memoryText = 'No readable memories found.';
    }

    const embed = new EmbedBuilder()
      .setTitle('What I Remember About You')
      .setDescription(`You have **${memories.length}${memories.length >= 20 ? '+' : ''}** stored memories`)
      .setColor(0x5865F2)
      .addFields({ name: 'Your Memories', value: memoryText })
      .setFooter({ text: 'Use /forget <number> to delete specific memories' });

    await interaction.editReply({ embeds: [embed], ephemeral: true });
  }
}

module.exports = MemoriesSlashCommand;
