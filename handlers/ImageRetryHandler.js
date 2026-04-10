// handlers/ImageRetryHandler.js
// Handles failed image generation with AI-powered analysis and interactive retry

const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const logger = require('../logger');

// Reaction emojis for prompt selection
const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣'];
const DISMISS_EMOJI = '❌';

// Timeout for pending retries (60 seconds)
const RETRY_TIMEOUT_MS = 60000;

class ImageRetryHandler {
  /**
   * Initialize ImageRetryHandler
   * @param {Object} imagenService - ImagenService for generating images
   * @param {Object} analyzerService - ImagePromptAnalyzerService for analyzing failures
   * @param {Object} config - Bot configuration (for admin user checks)
   */
  constructor(imagenService, analyzerService, config = {}) {
    this.imagenService = imagenService;
    this.analyzerService = analyzerService;
    this.config = config;

    // Map of messageId -> pending retry data
    // { userId, originalPrompt, suggestedPrompts, channelId, messageId, analysisId, createdAt, timeout }
    this.pendingRetries = new Map();
  }

  /**
   * Check if a message has a pending retry
   * @param {string} messageId - Discord message ID
   * @returns {boolean}
   */
  isPendingRetry(messageId) {
    const isPending = this.pendingRetries.has(messageId);
    logger.debug(`isPendingRetry check - messageId: ${messageId}, isPending: ${isPending}, pendingCount: ${this.pendingRetries.size}`);
    return isPending;
  }

  /**
   * Handle a failed image generation - analyze and offer retry options
   * @param {Message} message - Original Discord message
   * @param {string} originalPrompt - The prompt that failed
   * @param {Object} failureContext - Failure context from ImagenService
   * @param {Object} user - Discord user
   */
  async handleFailedGeneration(message, originalPrompt, failureContext, user) {
    try {
      // Analyze the failed prompt
      const analysis = await this.analyzerService.analyzeFailedPrompt(
        originalPrompt,
        failureContext.error || 'Generation failed',
        failureContext
      ).catch(err => {
        logger.error(`Prompt analysis failed: ${err.message}`);
        return {
          failureType: failureContext.type || 'unknown',
          analysis: 'Unable to analyze the failure.',
          suggestedPrompts: [],
          confidence: 0
        };
      });

      // Auto-retry: if enabled, not a safety block, and we have suggestions, try once automatically
      const autoRetryEnabled = this.config.imagen?.autoRetry !== false; // default true
      const isSafetyBlock = failureContext.type === 'safety';
      const hasSuggestions = analysis.suggestedPrompts?.length > 0;

      if (autoRetryEnabled && !isSafetyBlock && hasSuggestions) {
        const retryPrompt = analysis.suggestedPrompts[0];
        logger.info(`Auto-retrying image generation with simplified prompt: "${retryPrompt}"`);

        await message.channel.send({
          content: `Image generation failed — automatically retrying with a simplified prompt...`
        });

        const isAdmin = this.config.discord?.adminUserIds?.includes(user.id) || false;
        const retryResult = await this.imagenService.generateImage(retryPrompt, { isAdmin }, user);

        if (retryResult.success) {
          logger.info(`Auto-retry succeeded for user ${user.username}`);
          const attachment = new AttachmentBuilder(retryResult.buffer, {
            name: `generated_${Date.now()}.png`
          });
          await message.channel.send({
            content: `**Prompt:** ${retryPrompt}`,
            files: [attachment]
          });

          // Record the successful auto-retry
          const recordResult = await this.analyzerService.recordFailureAnalysis(
            originalPrompt, analysis, user.id, message.channel.id,
            { guildId: message.guild?.id, username: user.username }
          );
          if (recordResult.id) {
            await this.analyzerService.updateRetryAttempt(recordResult.id, retryPrompt, true);
          }
          return;
        }

        logger.info(`Auto-retry also failed for user ${user.username}, falling back to interactive suggestions`);
      }

      // Interactive fallback: send embed with suggestions and reaction buttons
      await this._sendInteractiveEmbed(message, originalPrompt, failureContext, analysis, user);

    } catch (error) {
      logger.error(`Error handling failed generation: ${error.message}`);
      try {
        await message.channel.send({
          content: `Image generation failed. Please try a different prompt.`
        });
      } catch (e) {
        logger.error(`Failed to send fallback error message: ${e.message}`);
      }
    }
  }

  /**
   * Send interactive embed with suggestions and reaction buttons
   * @param {Message} message - Discord message
   * @param {string} originalPrompt - Original prompt that failed
   * @param {Object} failureContext - Failure context
   * @param {Object} analysis - Analysis result from analyzer service
   * @param {Object} user - Discord user
   * @private
   */
  async _sendInteractiveEmbed(message, originalPrompt, failureContext, analysis, user) {
    const embedData = this.analyzerService.formatAnalysisForEmbed(analysis);
    const embed = new EmbedBuilder()
      .setTitle(embedData.title)
      .setDescription(embedData.description)
      .setColor(embedData.color)
      .setFooter(embedData.footer);

    for (const field of embedData.fields || []) {
      embed.addFields(field);
    }

    const embedMessage = await message.channel.send({
      embeds: [embed]
    });

    // Add reaction buttons for each suggested prompt
    const numSuggestions = Math.min(analysis.suggestedPrompts?.length || 0, 3);
    for (let i = 0; i < numSuggestions; i++) {
      await embedMessage.react(NUMBER_EMOJIS[i]);
    }
    await embedMessage.react(DISMISS_EMOJI);

    // Record the analysis in the database
    const recordResult = await this.analyzerService.recordFailureAnalysis(
      originalPrompt,
      analysis,
      user.id,
      message.channel.id,
      {
        guildId: message.guild?.id,
        username: user.username
      }
    );

    // Store pending retry data
    const pendingData = {
      userId: user.id,
      originalPrompt,
      suggestedPrompts: analysis.suggestedPrompts || [],
      channelId: message.channel.id,
      messageId: embedMessage.id,
      analysisId: recordResult.id || null,
      createdAt: Date.now()
    };

    this.pendingRetries.set(embedMessage.id, pendingData);
    logger.info(`Stored pending retry for embed message ${embedMessage.id}, total pending: ${this.pendingRetries.size}`);

    // Set timeout to clean up
    const timeout = setTimeout(() => {
      this.pendingRetries.delete(embedMessage.id);
      logger.debug(`Cleaned up expired pending retry: ${embedMessage.id}`);
    }, RETRY_TIMEOUT_MS);

    pendingData.timeout = timeout;
    logger.info(`Handled failed generation for user ${user.username}, offered ${numSuggestions} alternatives, embedMessageId: ${embedMessage.id}`);
  }

  /**
   * Handle a retry reaction on a pending retry message
   * @param {MessageReaction} reaction - The reaction
   * @param {Object} user - Discord user who reacted
   */
  async handleRetryReaction(reaction, user) {
    const messageId = reaction.message.id;

    // Check if this is a pending retry
    const pendingData = this.pendingRetries.get(messageId);
    if (!pendingData) {
      return;
    }

    // Only the original user can retry
    if (pendingData.userId !== user.id) {
      logger.debug(`Ignoring reaction from non-original user: ${user.id}`);
      return;
    }

    const emoji = reaction.emoji.name;

    // Handle dismiss
    if (emoji === DISMISS_EMOJI) {
      this._cleanupPendingRetry(messageId);
      try {
        await reaction.message.delete();
      } catch (e) {
        logger.debug(`Could not delete dismissed message: ${e.message}`);
      }
      logger.info(`User ${user.username} dismissed image retry`);
      return;
    }

    // Get the selected prompt index
    const promptIndex = NUMBER_EMOJIS.indexOf(emoji);
    if (promptIndex === -1 || promptIndex >= pendingData.suggestedPrompts.length) {
      return;
    }

    const selectedPrompt = pendingData.suggestedPrompts[promptIndex];
    logger.info(`User ${user.username} retrying with suggestion ${promptIndex + 1}: "${selectedPrompt}"`);

    try {
      // Show typing indicator
      await reaction.message.channel.sendTyping();

      // Check if user is an admin (for premium model access)
      const isAdmin = this.config.discord?.adminUserIds?.includes(user.id) || false;

      // Generate image with the selected prompt
      const result = await this.imagenService.generateImage(selectedPrompt, { isAdmin }, user);

      // Update analysis record
      if (pendingData.analysisId) {
        await this.analyzerService.updateRetryAttempt(
          pendingData.analysisId,
          selectedPrompt,
          result.success
        );
      }

      if (result.success) {
        // Send the generated image
        const attachment = new AttachmentBuilder(result.buffer, {
          name: 'generated_image.png'
        });

        await reaction.message.channel.send({
          content: `Retry successful! Here's your image using the improved prompt.`,
          files: [attachment]
        });

        // Delete the embed message
        try {
          await reaction.message.delete();
        } catch (e) {
          logger.debug(`Could not delete retry embed: ${e.message}`);
        }
      } else {
        // Retry also failed
        await reaction.message.channel.send({
          content: `The retry also failed: ${result.error}\nYou may need to try a completely different approach.`
        });
      }

    } catch (error) {
      logger.error(`Error during retry: ${error.message}`);
      await reaction.message.channel.send({
        content: `An error occurred during retry: ${error.message}`
      });
    } finally {
      // Clean up regardless of outcome
      this._cleanupPendingRetry(messageId);
    }
  }

  /**
   * Clean up a pending retry
   * @private
   */
  _cleanupPendingRetry(messageId) {
    const pendingData = this.pendingRetries.get(messageId);
    if (pendingData?.timeout) {
      clearTimeout(pendingData.timeout);
    }
    this.pendingRetries.delete(messageId);
  }

  /**
   * Clean up all expired retries (can be called periodically)
   */
  cleanupExpiredRetries() {
    const now = Date.now();
    for (const [messageId, data] of this.pendingRetries) {
      if (now - data.createdAt > RETRY_TIMEOUT_MS) {
        this._cleanupPendingRetry(messageId);
        logger.debug(`Cleaned up expired retry: ${messageId}`);
      }
    }
  }
}

module.exports = ImageRetryHandler;
