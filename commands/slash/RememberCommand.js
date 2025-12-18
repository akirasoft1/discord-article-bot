// commands/slash/RememberCommand.js
// Slash command to tell the bot to remember something

const { SlashCommandBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const logger = require('../../logger');

class RememberSlashCommand extends BaseSlashCommand {
  constructor(mem0Service) {
    super({
      data: new SlashCommandBuilder()
        .setName('remember')
        .setDescription('Tell me something to remember about you')
        .addStringOption(option =>
          option.setName('fact')
            .setDescription('What should I remember?')
            .setRequired(true)
            .setMaxLength(1000)),
      deferReply: true,
      cooldown: 5
    });

    this.mem0Service = mem0Service;
  }

  async execute(interaction, context) {
    const fact = interaction.options.getString('fact');
    const userId = interaction.user.id;

    this.logExecution(interaction, `storing memory`);

    const result = await this.mem0Service.addMemory(
      fact,
      userId,
      { source: 'remember_command' }
    );

    if (result.success) {
      await this.sendReply(interaction, {
        content: `Got it! I'll remember that. Use \`/memories\` to see what I know about you.`,
        ephemeral: false
      });
    } else {
      await this.sendError(interaction, result.error || 'Failed to store memory.');
    }
  }
}

module.exports = RememberSlashCommand;
