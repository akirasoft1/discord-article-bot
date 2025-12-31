// handlers/ReplyHandler.js
// Handles replies to bot messages for personality chats, summarization follow-ups, and image regeneration

const { AttachmentBuilder } = require('discord.js');
const logger = require('../logger');
const personalityManager = require('../personalities');
const TextUtils = require('../utils/textUtils');
const { withRootSpan, withSpan, setSpanAttributes } = require('../tracing');
const { DISCORD, REPLY, ERROR, CHAT, SUMMARIZATION } = require('../tracing-attributes');

class ReplyHandler {
  constructor(chatService, summarizationService, openaiClient, config, imagenService = null) {
    this.chatService = chatService;
    this.summarizationService = summarizationService;
    this.openaiClient = openaiClient;
    this.config = config;
    this.imagenService = imagenService;
  }

  /**
   * Handle a reply to a bot message
   * @param {Message} message - The reply message from a user
   * @param {Message} referencedMessage - The original bot message being replied to
   * @returns {boolean} True if the reply was handled, false otherwise
   */
  async handleReply(message, referencedMessage) {
    // Only handle replies to bot messages
    if (!referencedMessage.author.bot) {
      return false;
    }

    const botContent = referencedMessage.content;

    // Wrap in root span for tracing entry point
    return withRootSpan('discord.reply.handle', {
      [DISCORD.USER_ID]: message.author.id,
      [DISCORD.USER_TAG]: message.author.tag || message.author.username,
      [DISCORD.CHANNEL_ID]: message.channel.id,
      [DISCORD.GUILD_ID]: message.guild?.id || 'dm',
      [DISCORD.MESSAGE_ID]: message.id,
      [REPLY.OPERATION]: 'handle_reply',
    }, async (span) => {
      // Try to detect if this is a personality chat message
      const personalityInfo = this.detectPersonalityFromMessage(botContent);
      if (personalityInfo) {
        logger.info(`Detected reply to personality chat: ${personalityInfo.id}`);
        span.setAttributes({
          [REPLY.TYPE]: 'personality_chat',
          [REPLY.PERSONALITY_DETECTED]: true,
          [CHAT.PERSONALITY_ID]: personalityInfo.id,
          [CHAT.PERSONALITY_NAME]: personalityInfo.name,
        });
        await this.handlePersonalityChatReply(message, personalityInfo);
        return true;
      }

      // Try to detect if this is a summarization message
      if (this.isSummarizationMessage(botContent)) {
        logger.info('Detected reply to summarization message');
        span.setAttributes({
          [REPLY.TYPE]: 'summarization_followup',
          [REPLY.IS_SUMMARIZATION]: true,
        });
        await this.handleSummarizationReply(message, botContent);
        return true;
      }

      // Try to detect if this is an image generation message
      const attachments = referencedMessage.attachments?.map?.(a => a) ||
                          (referencedMessage.attachments?.size > 0 ?
                            [referencedMessage.attachments.first()] : []);
      if (this.isImageGenerationMessage(botContent, attachments)) {
        const originalPrompt = this.extractOriginalPrompt(botContent);
        if (originalPrompt && this.imagenService) {
          logger.info(`Detected reply to image generation: "${originalPrompt.substring(0, 50)}..."`);
          span.setAttributes({
            [REPLY.TYPE]: 'image_regeneration',
            'image.original_prompt': originalPrompt.substring(0, 100),
          });
          await this.handleImageReply(message, originalPrompt);
          return true;
        }
      }

      span.setAttribute(REPLY.TYPE, 'unhandled');
      return false;
    });
  }

  /**
   * Detect personality from a bot message by looking for emoji + name pattern
   * Bot messages are formatted as: "🕵️ **Jack Shadows**\n\n<message>"
   * @param {string} content - The bot message content
   * @returns {Object|null} Personality info {id, name, emoji} or null if not detected
   */
  detectPersonalityFromMessage(content) {
    // Get all personalities and try to match
    const personalities = personalityManager.getAll();

    for (const personality of personalities) {
      // Check for the format: "emoji **Name**" at the start of the message
      const pattern = new RegExp(`^${this.escapeRegex(personality.emoji)}\\s*\\*\\*${this.escapeRegex(personality.name)}\\*\\*`, 'i');

      if (pattern.test(content)) {
        return {
          id: personality.id,
          name: personality.name,
          emoji: personality.emoji
        };
      }
    }

    return null;
  }

  /**
   * Escape special regex characters in a string
   * @param {string} str - String to escape
   * @returns {string} Escaped string
   */
  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Check if a message is a summarization message
   * Summarization messages contain specific patterns like reading time, topic, source rating
   * @param {string} content - The bot message content
   * @returns {boolean} True if this is a summarization message
   */
  isSummarizationMessage(content) {
    // Check for typical summarization patterns
    const summarizationPatterns = [
      /\*\*Reading Time:\*\*/i,
      /\*\*Topic:\*\*/i,
      /\*\*Source Rating:\*\*/i,
      /\*\*Sentiment:\*\*/i,
      /\*\*Archived Version:\*\*/i,
      /\*\*Original:\*\*/i
    ];

    return summarizationPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Extract article URL from a summarization message
   * @param {string} content - The bot message content
   * @returns {string|null} The article URL or null if not found
   */
  extractArticleUrl(content) {
    // Look for Original URL pattern: **Original:** <url>
    const originalMatch = content.match(/\*\*Original:\*\*\s*<([^>]+)>/);
    if (originalMatch) {
      return originalMatch[1];
    }

    // Look for Archived Version pattern: **Archived Version:** <url>
    const archivedMatch = content.match(/\*\*Archived Version:\*\*\s*<([^>]+)>/);
    if (archivedMatch) {
      return archivedMatch[1];
    }

    // Look for any URL in the content
    const urlMatch = content.match(/(https?:\/\/[^\s<>]+)/);
    return urlMatch ? urlMatch[1] : null;
  }

  /**
   * Extract the summary text from a summarization message
   * @param {string} content - The bot message content
   * @returns {string} The summary text
   */
  extractSummaryText(content) {
    // Summary is typically between the title and the metadata section
    // Try to extract the main content before the **Archived Version:** or **Original:** line
    const lines = content.split('\n');
    const summaryLines = [];
    let inSummary = false;

    for (const line of lines) {
      // Skip title (usually first line with **)
      if (!inSummary && line.startsWith('**') && !line.includes('Reading Time') && !line.includes('Topic')) {
        inSummary = true;
        continue;
      }

      // Stop at metadata sections
      if (line.startsWith('**Archived Version:') ||
          line.startsWith('**Original:') ||
          line.startsWith('**Reading Time:') ||
          line.startsWith('**Topic:')) {
        break;
      }

      if (inSummary && line.trim()) {
        summaryLines.push(line);
      }
    }

    return summaryLines.join('\n').trim();
  }

  /**
   * Check if a message is an image generation result
   * Image generation messages have format: "**Prompt:** <prompt>" + image attachment
   * @param {string} content - The bot message content
   * @param {Array} attachments - Array of message attachments
   * @returns {boolean} True if this is an image generation message
   */
  isImageGenerationMessage(content, attachments) {
    // Must start with **Prompt:** (not nested in personality format)
    if (!content.startsWith('**Prompt:**')) {
      return false;
    }

    // Must have at least one image attachment
    if (!attachments || attachments.length === 0) {
      return false;
    }

    // Check if any attachment is an image
    const validImageTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
    const hasImageAttachment = attachments.some(att =>
      att.contentType && validImageTypes.includes(att.contentType)
    );

    return hasImageAttachment;
  }

  /**
   * Extract the original prompt from an image generation message
   * @param {string} content - The bot message content
   * @returns {string|null} The original prompt or null if not found
   */
  extractOriginalPrompt(content) {
    // Match "**Prompt:** <text>" format
    const match = content.match(/^\*\*Prompt:\*\*\s*(.+?)(?:\n|$)/);
    if (!match) {
      return null;
    }
    return match[1].trim();
  }

  /**
   * Handle a reply to an image generation message (regeneration with feedback)
   * @param {Message} message - The user's reply message with feedback
   * @param {string} originalPrompt - The original image prompt
   */
  async handleImageReply(message, originalPrompt) {
    return withSpan('discord.reply.image_regeneration', {
      [DISCORD.CHANNEL_ID]: message.channel.id,
      'image.original_prompt': originalPrompt.substring(0, 100),
    }, async (span) => {
      const userFeedback = message.content;

      // Show typing indicator
      await message.channel.sendTyping();

      try {
        // Use AI to combine original prompt with user feedback
        const enhancedPrompt = await this._enhancePromptWithFeedback(originalPrompt, userFeedback);
        span.setAttribute('image.enhanced_prompt', enhancedPrompt.substring(0, 100));

        logger.info(`Enhanced prompt: "${enhancedPrompt.substring(0, 100)}..."`);

        // Generate new image with enhanced prompt
        const result = await this.imagenService.generateImage(
          enhancedPrompt,
          {},
          { id: message.author.id, tag: message.author.tag || message.author.username }
        );

        if (!result.success) {
          span.setAttributes({
            [ERROR.TYPE]: 'image_generation_failed',
            [ERROR.MESSAGE]: result.error,
          });
          await message.reply({
            content: `Failed to regenerate image: ${result.error}`,
            allowedMentions: { repliedUser: false }
          });
          return;
        }

        // Get file extension from MIME type
        const extension = this._getImageExtension(result.mimeType);
        const filename = `regenerated_${Date.now()}.${extension}`;

        // Create attachment
        const attachment = new AttachmentBuilder(result.buffer, {
          name: filename,
          description: enhancedPrompt.substring(0, 100)
        });

        // Send regenerated image
        await message.reply({
          content: `**Prompt:** ${enhancedPrompt}`,
          files: [attachment],
          allowedMentions: { repliedUser: false }
        });

        logger.info(`Regenerated image for ${message.author.tag || message.author.username}`);

      } catch (error) {
        logger.error(`Error handling image reply: ${error.message}`);
        span.setAttributes({
          [ERROR.TYPE]: error.name || 'Error',
          [ERROR.MESSAGE]: error.message,
        });
        await message.reply({
          content: `Sorry, I encountered an error while processing your image request: ${error.message}`,
          allowedMentions: { repliedUser: false }
        });
      }
    });
  }

  /**
   * Enhance an image prompt with user feedback using AI
   * @param {string} originalPrompt - The original image prompt
   * @param {string} userFeedback - User's feedback/modification request
   * @returns {Promise<string>} Enhanced prompt
   * @private
   */
  async _enhancePromptWithFeedback(originalPrompt, userFeedback) {
    const systemPrompt = `You are an expert at crafting image generation prompts. Your task is to take an original image generation prompt and user feedback, then create an improved prompt that incorporates the requested changes.

Rules:
- Keep the enhanced prompt concise (under 200 words)
- Preserve the core subject and style of the original prompt unless the user specifically asks to change it
- Incorporate the user's feedback naturally
- Output ONLY the new prompt text, nothing else - no explanations, no quotation marks, no prefixes
- Maintain image generation best practices (clear descriptions, style cues, composition hints)`;

    const userInput = `Original prompt: "${originalPrompt}"

User feedback: "${userFeedback}"

Create an enhanced prompt that incorporates this feedback:`;

    const response = await this.openaiClient.responses.create({
      model: this.config.openai.model || 'gpt-4.1-mini',
      instructions: systemPrompt,
      input: userInput,
    });

    return response.output_text.trim();
  }

  /**
   * Get file extension from MIME type
   * @param {string} mimeType - The MIME type
   * @returns {string} File extension
   * @private
   */
  _getImageExtension(mimeType) {
    const extensions = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp'
    };
    return extensions[mimeType] || 'png';
  }

  /**
   * Handle a reply to a personality chat message
   * @param {Message} message - The user's reply message
   * @param {Object} personalityInfo - The detected personality info
   */
  async handlePersonalityChatReply(message, personalityInfo) {
    return withSpan('discord.reply.personality_chat', {
      [CHAT.PERSONALITY_ID]: personalityInfo.id,
      [CHAT.PERSONALITY_NAME]: personalityInfo.name,
      [DISCORD.CHANNEL_ID]: message.channel.id,
    }, async (span) => {
      const channelId = message.channel.id;
      const guildId = message.guild?.id || null;
      const userMessage = message.content;

      // Show typing indicator
      await message.channel.sendTyping();

      // For replies, we let chatService.chat() handle the conversation logic
      // It will check for idle timeout and either continue or start fresh
      // We only show the "forgotten" message if the conversation was explicitly
      // expired or reset (not just idle - idle conversations get auto-renewed by !chat)
      const status = await this.chatService.mongoService.getConversationStatus(channelId, personalityInfo.id);

      logger.debug(`Reply handler - conversation status for ${personalityInfo.id} in ${channelId}: ${JSON.stringify(status)}`);
      span.setAttribute(REPLY.CONVERSATION_STATUS, status.status || 'new');

      // Only show forgotten message for explicitly expired/reset conversations
      // For idle conversations, chatService.chat() will handle them (start fresh)
      if (status.exists && (status.status === 'expired' || status.status === 'reset')) {
        logger.info(`Conversation ${personalityInfo.id} is ${status.status}, showing expired message`);
        // Conversation was explicitly expired or reset - respond in character about forgetting
        await this.handleExpiredConversationReply(message, personalityInfo);
        return;
      }

      // Continue the conversation (or start fresh if idle - chatService handles this)
      const result = await this.chatService.chat(
        personalityInfo.id,
        userMessage,
        message.author,
        channelId,
        guildId
      );

      if (!result.success) {
        span.setAttributes({
          [ERROR.TYPE]: 'chat_error',
          [ERROR.MESSAGE]: result.error || 'Unknown error',
        });
        if (result.availablePersonalities) {
          return message.reply({
            content: `I couldn't find that personality. Something went wrong.`,
            allowedMentions: { repliedUser: false }
          });
        }
        return message.reply({
          content: result.error,
          allowedMentions: { repliedUser: false }
        });
      }

      span.setAttribute(CHAT.HAS_IMAGE, result.images?.length > 0);

      // Format response with personality header and wrap URLs
      const response = TextUtils.wrapUrls(
        `${result.personality.emoji} **${result.personality.name}**\n\n${result.message}`
      );

      // Convert any generated images to Discord attachments
      const imageAttachments = this._createImageAttachments(result.images);

      // Split if too long for Discord
      if (response.length > 2000) {
        const chunks = this.splitMessage(response, 2000);
        for (const chunk of chunks) {
          await message.channel.send(chunk);
        }
        // Send images after text chunks
        if (imageAttachments.length > 0) {
          await message.channel.send({ files: imageAttachments });
        }
      } else {
        await message.reply({
          content: response,
          allowedMentions: { repliedUser: false }
        });
        // Send images as follow-up
        if (imageAttachments.length > 0) {
          await message.channel.send({ files: imageAttachments });
        }
      }
    });
  }

  /**
   * Create Discord attachments from base64 images
   * @param {Array<{id: string, base64: string}>} images - Generated images
   * @returns {Array<AttachmentBuilder>} Discord attachment builders
   * @private
   */
  _createImageAttachments(images) {
    const attachments = [];
    if (!images || images.length === 0) {
      return attachments;
    }

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      try {
        const buffer = Buffer.from(img.base64, 'base64');
        const attachment = new AttachmentBuilder(buffer, {
          name: `generated_image_${i + 1}.png`
        });
        attachments.push(attachment);
        logger.info(`Prepared image attachment: generated_image_${i + 1}.png`);
      } catch (error) {
        logger.error(`Failed to create image attachment: ${error.message}`);
      }
    }

    return attachments;
  }

  /**
   * Handle reply to an expired personality conversation
   * Responds in character about having forgotten the conversation
   * @param {Message} message - The user's reply message
   * @param {Object} personalityInfo - The detected personality info
   */
  async handleExpiredConversationReply(message, personalityInfo) {
    const personality = personalityManager.get(personalityInfo.id);

    if (!personality) {
      return message.reply({
        content: `I couldn't find that personality.`,
        allowedMentions: { repliedUser: false }
      });
    }

    // Generate an in-character "I've forgotten" response
    const forgetPrompt = `${personality.systemPrompt}

The user is trying to continue a conversation with you, but too much time has passed (30+ minutes of inactivity) and you've completely forgotten what you were talking about.

Respond IN CHARACTER explaining that you don't remember what you were discussing. Stay true to your personality while letting them know they need to start a new conversation. Be brief (1-2 sentences max). Do NOT use phrases like "start a new conversation" or mention commands - just express confusion about what they were talking about in your character's unique voice.`;

    try {
      const response = await this.openaiClient.responses.create({
        model: this.config.openai.model || 'gpt-5.1',
        instructions: forgetPrompt,
        input: message.content,
      });

      const characterResponse = response.output_text;

      // Add the command hint after the in-character response
      const fullResponse = `${personalityInfo.emoji} **${personalityInfo.name}**\n\n${characterResponse}\n\n*This conversation has expired. Start a new one with \`!chat ${personalityInfo.id} <message>\`*`;

      await message.reply({
        content: fullResponse,
        allowedMentions: { repliedUser: false }
      });

    } catch (error) {
      logger.error(`Error generating expired conversation response: ${error.message}`);
      await message.reply({
        content: `${personalityInfo.emoji} **${personalityInfo.name}**\n\n*This conversation has expired after 30 minutes of inactivity. Start a new one with \`!chat ${personalityInfo.id} <message>\`*`,
        allowedMentions: { repliedUser: false }
      });
    }
  }

  /**
   * Handle a reply to a summarization message (follow-up question about an article)
   * @param {Message} message - The user's reply message
   * @param {string} originalContent - The original bot message content
   */
  async handleSummarizationReply(message, originalContent) {
    return withSpan('discord.reply.summarization_followup', {
      [DISCORD.CHANNEL_ID]: message.channel.id,
      [SUMMARIZATION.IS_FOLLOW_UP]: true,
    }, async (span) => {
      const userQuestion = message.content;
      const articleUrl = this.extractArticleUrl(originalContent);
      const summaryText = this.extractSummaryText(originalContent);

      span.setAttributes({
        [SUMMARIZATION.ARTICLE_URL]: articleUrl || 'unknown',
        [SUMMARIZATION.CONTENT_LENGTH]: summaryText.length,
      });

      // Show typing indicator
      await message.channel.sendTyping();

      // Build context for the follow-up question
      const systemPrompt = `You are a helpful assistant that answers follow-up questions about articles that have been summarized. Be concise and informative.

Here is the context from a previously summarized article:
${summaryText}

${articleUrl ? `Original article URL: ${articleUrl}` : ''}

Answer the user's follow-up question based on the summary provided. If the question cannot be answered from the summary alone, acknowledge this and provide what insight you can. Keep responses focused and under 500 words.`;

      try {
        const response = await this.openaiClient.responses.create({
          model: this.config.openai.model || 'gpt-5.1',
          instructions: systemPrompt,
          input: userQuestion,
        });

        const answer = response.output_text;

        // Add token usage to span
        span.setAttributes({
          'gen_ai.usage.input_tokens': response.usage?.input_tokens || 0,
          'gen_ai.usage.output_tokens': response.usage?.output_tokens || 0,
        });

        // Record token usage
        if (this.summarizationService?.mongoService) {
          await this.summarizationService.mongoService.recordTokenUsage(
            message.author.id,
            message.author.tag || message.author.username,
            response.usage?.input_tokens || 0,
            response.usage?.output_tokens || 0,
            'summarize_followup',
            this.config.openai.model || 'gpt-5.1'
          );
        }

        // Format and send response with URL wrapping
        const formattedResponse = TextUtils.wrapUrls(`**Follow-up Answer:**\n\n${answer}`);

        if (formattedResponse.length > 2000) {
          const chunks = this.splitMessage(formattedResponse, 2000);
          for (const chunk of chunks) {
            await message.channel.send(chunk);
          }
        } else {
          await message.reply({
            content: formattedResponse,
            allowedMentions: { repliedUser: false }
          });
        }

      } catch (error) {
        logger.error(`Error handling summarization follow-up: ${error.message}`);
        span.setAttributes({
          [ERROR.TYPE]: error.name || 'Error',
          [ERROR.MESSAGE]: error.message,
        });
        await message.reply({
          content: 'Sorry, I encountered an error while processing your question.',
          allowedMentions: { repliedUser: false }
        });
      }
    });
  }

  /**
   * Split a long message into chunks
   * @param {string} text - Text to split
   * @param {number} maxLength - Maximum length per chunk
   * @returns {Array<string>} Array of chunks
   */
  splitMessage(text, maxLength) {
    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Find a good break point
      let breakPoint = remaining.lastIndexOf('\n', maxLength);
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = remaining.lastIndexOf(' ', maxLength);
      }
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = maxLength;
      }

      chunks.push(remaining.substring(0, breakPoint));
      remaining = remaining.substring(breakPoint).trim();
    }

    return chunks;
  }
}

module.exports = ReplyHandler;
