// commands/slash/ChatThreadCommand.js
// Slash command for starting thread-based chat conversations

const { SlashCommandBuilder, ChannelType, AttachmentBuilder } = require('discord.js');
const BaseSlashCommand = require('../base/BaseSlashCommand');
const TextUtils = require('../../utils/textUtils');
const logger = require('../../logger');
const personalityManager = require('../../personalities');

class ChatThreadSlashCommand extends BaseSlashCommand {
  constructor(chatService, mongoService = null) {
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
            .setDescription('Which personality to chat with (default: friendly)')
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
    this.mongoService = mongoService;
    // In-memory cache of active threads: threadId -> { personalityId, userId, channelId }
    // Backed by MongoDB for persistence across restarts
    this.activeThreads = new Map();
  }

  /**
   * Load active threads from MongoDB on startup
   * Should be called after bot is ready
   */
  async loadThreadsFromDatabase() {
    if (!this.mongoService) {
      logger.warn('MongoService not available - thread persistence disabled');
      return;
    }

    try {
      const threads = await this.mongoService.getActiveChatThreads();
      for (const thread of threads) {
        this.activeThreads.set(thread.threadId, {
          personalityId: thread.personalityId,
          userId: thread.userId,
          channelId: thread.channelId,
          guildId: thread.guildId,
          createdAt: thread.createdAt
        });
      }
      logger.info(`Loaded ${threads.length} active chat threads from database`);
    } catch (error) {
      logger.error(`Failed to load chat threads from database: ${error.message}`);
    }
  }

  async execute(interaction, context) {
    const personalityId = interaction.options.getString('personality') || 'friendly';
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

    // Store thread mapping in memory and database
    const threadInfo = {
      personalityId,
      userId: interaction.user.id,
      channelId,
      guildId,
      createdAt: new Date()
    };
    this.activeThreads.set(thread.id, threadInfo);

    // Persist to MongoDB for survival across restarts
    if (this.mongoService) {
      await this.mongoService.saveChatThread(thread.id, threadInfo);
      logger.debug(`Persisted chat thread ${thread.id} to database`);
    }

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
      // Handle specific error reasons with helpful messages (without "Error: " prefix)
      if (result.reason === 'expired' || result.reason === 'message_limit' || result.reason === 'token_limit') {
        await thread.send(result.error);
      } else {
        await thread.send(`Error: ${result.error}`);
      }
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

    // Send any generated images
    await this._sendGeneratedImages(thread, result.images);
  }

  /**
   * Convert base64 images to Discord attachments and send them
   * @param {TextChannel|ThreadChannel} channel - Channel to send images to
   * @param {Array<{id: string, base64: string}>} images - Generated images
   * @private
   */
  async _sendGeneratedImages(channel, images) {
    if (!images || images.length === 0) {
      return;
    }

    const imageAttachments = [];
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      try {
        const buffer = Buffer.from(img.base64, 'base64');
        const attachment = new AttachmentBuilder(buffer, {
          name: `generated_image_${i + 1}.png`
        });
        imageAttachments.push(attachment);
        logger.info(`Prepared image attachment for thread: generated_image_${i + 1}.png`);
      } catch (error) {
        logger.error(`Failed to create image attachment: ${error.message}`);
      }
    }

    if (imageAttachments.length > 0) {
      await channel.send({ files: imageAttachments });
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
   * @returns {boolean} True if handled (or attempted to handle)
   */
  async handleThreadMessage(message) {
    let threadInfo = this.activeThreads.get(message.channel.id);

    // If not in memory cache, check MongoDB (thread may have been created before restart)
    if (!threadInfo && this.mongoService) {
      const dbThread = await this.mongoService.getChatThread(message.channel.id);
      if (dbThread) {
        // Restore to in-memory cache
        threadInfo = {
          personalityId: dbThread.personalityId,
          userId: dbThread.userId,
          channelId: dbThread.channelId,
          guildId: dbThread.guildId,
          createdAt: dbThread.createdAt
        };
        this.activeThreads.set(message.channel.id, threadInfo);
        logger.debug(`Restored chat thread ${message.channel.id} from database`);
      }
    }

    if (!threadInfo) {
      return false;
    }

    // Don't respond to bot messages
    if (message.author.bot) {
      return false;
    }

    // From this point on, we're handling this message - return true even on error
    // to prevent duplicate processing by the reply handler
    try {
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
        // Handle specific error reasons with helpful messages (without "Error: " prefix)
        const errorContent = (result.reason === 'expired' || result.reason === 'message_limit' || result.reason === 'token_limit')
          ? result.error
          : `Error: ${result.error}`;
        await message.reply({
          content: errorContent,
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

      // Send any generated images
      await this._sendGeneratedImages(message.channel, result.images);

      return true;
    } catch (error) {
      logger.error(`Error handling thread message: ${error.message}`);
      // Return true to indicate we attempted to handle this message
      // This prevents the reply handler from also trying to process it
      return true;
    }
  }

  /**
   * Clean up old thread mappings (called periodically)
   * Removes threads older than 24 hours from memory and database
   */
  async cleanupOldThreads() {
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);

    // Clean up in-memory cache
    for (const [threadId, info] of this.activeThreads) {
      if (info.createdAt.getTime() < oneDayAgo) {
        this.activeThreads.delete(threadId);
      }
    }

    // Clean up database
    if (this.mongoService) {
      await this.mongoService.cleanupOldChatThreads(24);
    }
  }
}

module.exports = ChatThreadSlashCommand;
