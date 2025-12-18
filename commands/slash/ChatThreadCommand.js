// commands/slash/ChatThreadCommand.js
// Slash command for starting thread-based chat conversations

const { SlashCommandBuilder, ChannelType } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const TextUtils = require('../../utils/textUtils');
const logger = require('../../logger');
const personalityManager = require('../../personalities');

class ChatThreadSlashCommand extends BaseSlashCommand {
  constructor(chatService) {
    // Build personality choices dynamically
    const personalities = personalityManager.list();
    const choices = personalities.slice(0, 25).map(p => ({
      name: `${p.emoji} ${p.name}`,
      value: p.id
    }));

    super({
      data: new SlashCommandBuilder()
        .setName('chatthread')
        .setDescription('Start a dedicated thread for an extended conversation with an AI personality')
        .addStringOption(option =>
          option.setName('message')
            .setDescription('Your opening message')
            .setRequired(true)
            .setMaxLength(2000))
        .addStringOption(option => {
          option.setName('personality')
            .setDescription('Which personality to chat with (default: clair)')
            .setRequired(false);
          if (choices.length > 0) {
            option.addChoices(...choices);
          }
          return option;
        }),
      deferReply: true,
      cooldown: 10 // Slightly higher cooldown to prevent thread spam
    });

    this.chatService = chatService;
    // Track active chat threads: threadId -> { personalityId, userId, channelId }
    this.activeThreads = new Map();
  }

  async execute(interaction, context) {
    const personalityId = interaction.options.getString('personality') || 'clair';
    const userMessage = interaction.options.getString('message');
    const channelId = interaction.channel.id;
    const guildId = interaction.guild?.id || null;

    // Get personality info
    const personality = personalityManager.get(personalityId);
    if (!personality) {
      const available = personalityManager.list()
        .map(p => `\`${p.id}\` - ${p.emoji} ${p.name}`)
        .join('\n');
      await this.sendReply(interaction, {
        content: `Unknown personality. Available options:\n${available}`
      });
      return;
    }

    this.logExecution(interaction, `personality=${personalityId}, creating thread`);

    // Create thread for conversation
    let thread;
    try {
      const threadName = `${personality.emoji} Chat with ${personality.name}`;
      thread = await interaction.channel.threads.create({
        name: threadName.substring(0, 100), // Thread names max 100 chars
        autoArchiveDuration: 60, // Archive after 1 hour of inactivity
        type: ChannelType.PrivateThread,
        reason: `Chat thread started by ${interaction.user.tag}`
      });

      // Add the user to the thread
      await thread.members.add(interaction.user.id);
    } catch (error) {
      logger.error(`Failed to create chat thread: ${error.message}`);
      await this.sendError(interaction, 'Failed to create conversation thread. I may lack permission to create threads in this channel.');
      return;
    }

    // Store thread mapping
    this.activeThreads.set(thread.id, {
      personalityId,
      userId: interaction.user.id,
      channelId,
      guildId,
      createdAt: new Date()
    });

    // Reply to the original interaction
    await this.sendReply(interaction, {
      content: `Started a conversation with ${personality.emoji} **${personality.name}** in ${thread}!\n\nJust type your messages in the thread - no commands needed.`,
      ephemeral: false
    });

    // Get the initial response from the personality
    const result = await this.chatService.chat(
      personalityId,
      userMessage,
      interaction.user,
      thread.id, // Use thread ID as channel ID for conversation tracking
      guildId
    );

    if (!result.success) {
      await thread.send(`Error: ${result.error}`);
      return;
    }

    // Send the response in the thread
    const response = TextUtils.wrapUrls(
      `${result.personality.emoji} **${result.personality.name}**\n\n${result.message}`
    );

    // Split long messages
    const chunks = this.splitMessage(response, 2000);
    for (const chunk of chunks) {
      await thread.send(chunk);
    }
  }

  /**
   * Check if a thread is an active chat thread
   * @param {string} threadId
   * @returns {Object|null} Thread info or null
   */
  getThreadInfo(threadId) {
    return this.activeThreads.get(threadId) || null;
  }

  /**
   * Handle a message in a chat thread (called from bot.js messageCreate)
   * @param {Message} message
   * @returns {boolean} True if handled
   */
  async handleThreadMessage(message) {
    const threadInfo = this.activeThreads.get(message.channel.id);
    if (!threadInfo) {
      return false;
    }

    // Don't respond to bot messages
    if (message.author.bot) {
      return false;
    }

    // Show typing indicator
    await message.channel.sendTyping();

    const result = await this.chatService.chat(
      threadInfo.personalityId,
      message.content,
      message.author,
      message.channel.id,
      threadInfo.guildId
    );

    if (!result.success) {
      await message.reply({
        content: `Error: ${result.error}`,
        allowedMentions: { repliedUser: false }
      });
      return true;
    }

    const response = TextUtils.wrapUrls(
      `${result.personality.emoji} **${result.personality.name}**\n\n${result.message}`
    );

    // Split long messages
    const chunks = this.splitMessage(response, 2000);
    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) {
        await message.reply({
          content: chunks[i],
          allowedMentions: { repliedUser: false }
        });
      } else {
        await message.channel.send(chunks[i]);
      }
    }

    return true;
  }

  /**
   * Clean up old thread mappings (called periodically)
   * Removes threads older than 24 hours
   */
  cleanupOldThreads() {
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);

    for (const [threadId, info] of this.activeThreads) {
      if (info.createdAt.getTime() < oneDayAgo) {
        this.activeThreads.delete(threadId);
      }
    }
  }
}

module.exports = ChatThreadSlashCommand;
