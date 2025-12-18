// commands/slash/ThrowbackCommand.js
// Slash command for "on this day" IRC throwbacks

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const logger = require('../../logger');

class ThrowbackSlashCommand extends BaseSlashCommand {
  constructor(qdrantService) {
    super({
      data: new SlashCommandBuilder()
        .setName('throwback')
        .setDescription('Show a random IRC conversation from this day in history'),
      deferReply: true,
      cooldown: 10
    });

    this.qdrantService = qdrantService;
  }

  async execute(interaction, context) {
    this.logExecution(interaction);

    const today = new Date();
    const month = today.getMonth() + 1;  // JS months are 0-indexed
    const day = today.getDate();

    // Use correct method: getRandomFromDate(month, day) - returns a single random result
    const result = await this.qdrantService.getRandomFromDate(month, day);

    if (!result) {
      const monthName = today.toLocaleDateString('en-US', { month: 'long' });
      await this.sendReply(interaction, {
        content: `No IRC conversations found from ${monthName} ${day} in history.\nTry again tomorrow for a different throwback!`,
        ephemeral: false
      });
      return;
    }

    const payload = result.payload || {};

    const year = payload.year || 'Unknown year';
    const channel = payload.channel || 'Unknown channel';
    const nick = payload.nick || payload.author || 'Unknown';
    const message = payload.message || payload.content || payload.text || 'No content';

    const embed = new EmbedBuilder()
      .setTitle(`On This Day: ${month}/${day}/${year}`)
      .setDescription(`From ${channel}`)
      .setColor(0xFFA500)
      .addFields({
        name: nick,
        value: message.length > 1000 ? message.substring(0, 997) + '...' : message,
        inline: false
      })
      .setFooter({ text: 'Use /throwback again for another memory' });

    await interaction.editReply({ embeds: [embed] });
  }
}

module.exports = ThrowbackSlashCommand;
