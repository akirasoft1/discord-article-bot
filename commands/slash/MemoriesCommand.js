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
    const memories = await this.mem0Service.getMemories(userId);

    if (!memories || memories.length === 0) {
      await this.sendReply(interaction, {
        content: 'I don\'t have any memories about you yet! Chat with me and I\'ll start remembering things.',
        ephemeral: true
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('What I Remember About You')
      .setDescription(`You have **${memories.length}** stored memories`)
      .setColor(0x5865F2)
      .setFooter({ text: 'Use /forget to delete specific memories' });

    // Show up to 20 memories
    const displayMemories = memories.slice(0, 20);
    let memoryText = displayMemories.map((m, i) =>
      `**${i + 1}.** ${m.memory || m.text || 'Unknown'}\n\`ID: ${m.id}\``
    ).join('\n\n');

    if (memories.length > 20) {
      memoryText += `\n\n*...and ${memories.length - 20} more*`;
    }

    // Split if too long
    if (memoryText.length > 4000) {
      memoryText = memoryText.substring(0, 3997) + '...';
    }

    embed.addFields({ name: 'Memories', value: memoryText });

    await interaction.editReply({ embeds: [embed], ephemeral: true });
  }
}

module.exports = MemoriesSlashCommand;
