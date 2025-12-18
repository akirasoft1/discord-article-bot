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

    const embed = new EmbedBuilder()
      .setTitle('What I Remember About You')
      .setDescription(`You have **${memories.length}${memories.length >= 20 ? '+' : ''}** stored memories`)
      .setColor(0x5865F2)
      .setFooter({ text: 'Use /forget <number> to delete specific memories' });

    // Format memories for display
    let memoryText = memories.map((m, i) =>
      `**${i + 1}.** ${m.memory || m.text || 'Unknown'}`
    ).join('\n\n');

    // Split if too long
    if (memoryText.length > 4000) {
      memoryText = memoryText.substring(0, 3997) + '...';
    }

    embed.addFields({ name: 'Memories', value: memoryText || 'No memories found' });

    await interaction.editReply({ embeds: [embed], ephemeral: true });
  }
}

module.exports = MemoriesSlashCommand;
