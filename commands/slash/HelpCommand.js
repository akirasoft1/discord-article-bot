// commands/slash/HelpCommand.js
// Slash command for help and command listing

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const logger = require('../../logger');

class HelpSlashCommand extends BaseSlashCommand {
  constructor() {
    super({
      data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show available commands and how to use them')
        .addStringOption(option =>
          option.setName('command')
            .setDescription('Get detailed help for a specific command')
            .setRequired(false)),
      cooldown: 5
    });
  }

  async execute(interaction, context) {
    const specificCommand = interaction.options.getString('command');

    this.logExecution(interaction, specificCommand ? `command=${specificCommand}` : 'general');

    if (specificCommand) {
      await this.showCommandHelp(interaction, specificCommand, context);
    } else {
      await this.showGeneralHelp(interaction, context);
    }
  }

  async showGeneralHelp(interaction, context) {
    const embed = new EmbedBuilder()
      .setTitle('Discord Article Bot - Commands')
      .setDescription('All commands use Discord slash commands. Type `/` to see available commands.')
      .setColor(0x5865F2);

    // Chat commands
    embed.addFields({
      name: 'Chat',
      value: [
        '`/chat` - Chat with an AI personality',
        '`/chatthread` - Start a dedicated conversation thread',
        '`/personalities` - List available personalities',
        '`/chatlist` - View your resumable conversations',
        '`/chatresume` - Resume an expired conversation',
        '`/chatreset` - Reset a conversation (admin)'
      ].join('\n'),
      inline: false
    });

    // Summarization
    embed.addFields({
      name: 'Summarization',
      value: [
        '`/summarize` - Summarize an article from a URL',
        '`/resummarize` - Force re-summarize an article'
      ].join('\n'),
      inline: false
    });

    // Media generation
    embed.addFields({
      name: 'Media Generation',
      value: [
        '`/imagine` - Generate an image from text',
        '`/videogen` - Generate a video from text/images'
      ].join('\n'),
      inline: false
    });

    // Memory
    embed.addFields({
      name: 'Memory',
      value: [
        '`/memories` - View what I remember about you',
        '`/remember` - Tell me something to remember',
        '`/forget` - Delete a memory or all memories'
      ].join('\n'),
      inline: false
    });

    // IRC History
    embed.addFields({
      name: 'IRC History',
      value: [
        '`/recall` - Search IRC history',
        '`/history` - View IRC history for a user',
        '`/throwback` - Random "on this day" IRC memory'
      ].join('\n'),
      inline: false
    });

    // Utility
    embed.addFields({
      name: 'Utility',
      value: [
        '`/help` - Show this help message',
        '`/context` - View channel conversation context',
        '`/channeltrack` - Manage channel tracking (admin)'
      ].join('\n'),
      inline: false
    });

    embed.setFooter({
      text: 'Tip: You can still reply to bot messages to continue conversations!'
    });

    await interaction.reply({ embeds: [embed] });
  }

  async showCommandHelp(interaction, commandName, context) {
    const helpTexts = {
      chat: {
        title: '/chat',
        description: 'Chat with an AI personality',
        usage: '/chat message:<your message> [personality:<name>] [image:<file>]',
        details: 'Start a conversation with one of several AI personalities. The personality defaults to Clair if not specified. You can attach an image to include in the conversation.'
      },
      chatthread: {
        title: '/chatthread',
        description: 'Start a dedicated thread for extended conversations',
        usage: '/chatthread message:<your message> [personality:<name>]',
        details: 'Creates a private thread for an ongoing conversation. All messages in the thread are automatically directed to the personality - no commands needed.'
      },
      summarize: {
        title: '/summarize',
        description: 'Summarize an article',
        usage: '/summarize url:<article url> [style:<style>]',
        details: 'Fetches and summarizes the article at the given URL. Available styles: default, pirate, shakespeare, genz, academic.'
      },
      imagine: {
        title: '/imagine',
        description: 'Generate an image',
        usage: '/imagine prompt:<description> [ratio:<aspect>] [reference:<image>]',
        details: 'Uses AI to generate an image from your text description. You can specify an aspect ratio and optionally provide a reference image.'
      },
      recall: {
        title: '/recall',
        description: 'Search IRC history',
        usage: '/recall query:<search terms> [my_messages:true] [year:<year>]',
        details: 'Performs semantic search through historical IRC logs. Filter to your own messages or specific years.'
      },
      memories: {
        title: '/memories',
        description: 'View stored memories',
        usage: '/memories',
        details: 'Shows what the bot remembers about you from past conversations. Memory IDs are shown for deletion.'
      }
    };

    const help = helpTexts[commandName.toLowerCase()];

    if (!help) {
      await interaction.reply({
        content: `No help available for "${commandName}". Use \`/help\` to see all commands.`,
        ephemeral: true
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(help.title)
      .setDescription(help.description)
      .setColor(0x5865F2)
      .addFields(
        { name: 'Usage', value: `\`${help.usage}\``, inline: false },
        { name: 'Details', value: help.details, inline: false }
      );

    await interaction.reply({ embeds: [embed] });
  }
}

module.exports = HelpSlashCommand;
