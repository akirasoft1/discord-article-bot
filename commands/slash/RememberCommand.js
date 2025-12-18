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
    const channelId = interaction.channel?.id;
    const guildId = interaction.guild?.id;

    this.logExecution(interaction, `storing memory`);

    // Format as a conversation so Mem0 can extract the fact
    // We phrase it as if the user is telling us directly
    const messages = [
      { role: 'user', content: `Please remember this about me: ${fact}` },
      { role: 'assistant', content: `Got it! I'll remember that ${fact}` }
    ];

    const result = await this.mem0Service.addMemory(messages, userId, {
      channelId: channelId,
      guildId: guildId,
      personalityId: 'explicit_memory', // Mark as explicitly stored
      source: 'remember_command'
    });

    // addMemory returns { results: Array, error?: string }
    const memoriesStored = result.results?.length || 0;

    if (memoriesStored > 0) {
      await this.sendReply(interaction, {
        content: `✅ I've remembered that about you!\n\n> ${fact}\n\nUse \`/memories\` to see everything I remember.`,
        ephemeral: false
      });
    } else if (result.error) {
      await this.sendError(interaction, result.error);
    } else {
      // Mem0 might not have extracted anything notable, but we acknowledge it
      await this.sendReply(interaction, {
        content: `📝 I've noted that, though I may already know this or it might not be something I can remember long-term.\n\nUse \`/memories\` to see what I currently remember about you.`,
        ephemeral: false
      });
    }
  }
}

module.exports = RememberSlashCommand;
