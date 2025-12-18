// commands/slash/PersonalitiesCommand.js
// Slash command to list available chat personalities

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const personalityManager = require('../../personalities');

class PersonalitiesSlashCommand extends BaseSlashCommand {
  constructor() {
    super({
      data: new SlashCommandBuilder()
        .setName('personalities')
        .setDescription('List all available chat personalities'),
      cooldown: 5
    });
  }

  async execute(interaction, context) {
    this.logExecution(interaction);

    const personalities = personalityManager.list();

    if (personalities.length === 0) {
      await interaction.reply({
        content: 'No personalities are currently available.',
        ephemeral: true
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('Available Personalities')
      .setDescription('Use `/chat personality:<name> message:<your message>` to chat with a personality')
      .setColor(0x5865F2);

    for (const p of personalities) {
      embed.addFields({
        name: `${p.emoji} ${p.name}`,
        value: `\`${p.id}\` - ${p.description}`,
        inline: false
      });
    }

    await interaction.reply({ embeds: [embed] });
  }
}

module.exports = PersonalitiesSlashCommand;
