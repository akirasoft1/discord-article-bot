// commands/slash/HistoryCommand.js
// Slash command to view IRC history for a user

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const logger = require('../../logger');

class HistorySlashCommand extends BaseSlashCommand {
  constructor(qdrantService, nickMappingService) {
    super({
      data: new SlashCommandBuilder()
        .setName('history')
        .setDescription('View IRC history for yourself or another user')
        .addUserOption(option =>
          option.setName('user')
            .setDescription('User to look up (defaults to yourself)')
            .setRequired(false)),
      deferReply: true,
      cooldown: 10
    });

    this.qdrantService = qdrantService;
    this.nickMappingService = nickMappingService;
  }

  async execute(interaction, context) {
    const targetUser = interaction.options.getUser('user') || interaction.user;

    this.logExecution(interaction, `user=${targetUser.tag}`);

    // Get the user's IRC nicks
    const mapping = await this.nickMappingService?.getMapping(targetUser.id);

    if (!mapping || !mapping.ircNicks || mapping.ircNicks.length === 0) {
      const isSelf = targetUser.id === interaction.user.id;
      await this.sendReply(interaction, {
        content: isSelf
          ? 'You don\'t have any IRC nicks mapped. Set them up to view your IRC history.'
          : `${targetUser.username} doesn't have any IRC nicks mapped.`,
        ephemeral: true
      });
      return;
    }

    // Search for messages from those nicks
    const results = await this.qdrantService.searchByNicks(mapping.ircNicks, 10);

    if (!results || results.length === 0) {
      await this.sendReply(interaction, {
        content: `No IRC history found for ${targetUser.username}.`,
        ephemeral: false
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`IRC History for ${targetUser.username}`)
      .setDescription(`Nicks: ${mapping.ircNicks.join(', ')}`)
      .setColor(0x5865F2)
      .setFooter({ text: `Showing ${results.length} recent messages` });

    for (const result of results) {
      const payload = result.payload || {};
      const date = payload.date || payload.timestamp || 'Unknown';
      const nick = payload.nick || payload.author || 'Unknown';
      const message = payload.message || payload.content || payload.text || '';
      const channel = payload.channel || '';

      const title = `${nick} ${channel ? `in ${channel}` : ''} (${date})`;
      const value = message.length > 200 ? message.substring(0, 197) + '...' : message;

      embed.addFields({ name: title, value: value || 'No content', inline: false });
    }

    await interaction.editReply({ embeds: [embed] });
  }
}

module.exports = HistorySlashCommand;
