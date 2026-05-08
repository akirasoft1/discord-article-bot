// ===== handlers/ReactionHandler.js =====
const logger = require('../logger');
const UrlUtils = require('../utils/urlUtils');
const { withRootSpan } = require('../tracing');
const { DISCORD, REACTION, ERROR } = require('../tracing-attributes');

const SANDBOX_REVEAL_EMOJI = new Set(['🔍', '📜', '🐛']);

class ReactionHandler {
  constructor(summarizationService, mongoService, sandboxTraceService = null) {
    this.summarizationService = summarizationService;
    this.mongoService = mongoService;
    this.sandboxTraceService = sandboxTraceService;
  }

  async handleNewsReaction(reaction, user) {
    if (reaction.emoji.name !== '📰' || reaction.count > 1) {
      return;
    }

    const message = reaction.message;

    // Wrap in root span for tracing entry point
    return withRootSpan('discord.reaction.news', {
      [DISCORD.USER_ID]: user.id,
      [DISCORD.USER_TAG]: user.tag || user.username,
      [DISCORD.CHANNEL_ID]: message.channel.id,
      [DISCORD.GUILD_ID]: message.guild?.id || 'dm',
      [DISCORD.MESSAGE_ID]: message.id,
      [REACTION.OPERATION]: 'handle_news_reaction',
      [REACTION.EMOJI]: reaction.emoji.name,
    }, async (span) => {
      logger.info(`Newspaper reaction by ${user.tag} on message: ${message.content}`);

      const urls = UrlUtils.extractUrlsFromText(message.content);
      span.setAttribute(REACTION.URLS_FOUND, urls.length);

      if (urls.length === 0) {
        logger.info('No URLs found in message');
        return;
      }

      // Process each URL
      for (const url of urls) {
        try {
          await this.summarizationService.processUrl(url, message, user);

          // Update reaction count in DB
          if (reaction.emoji.name) {
            const totalReactions = reaction.count;
            await this.mongoService.updateArticleReactions(url, reaction.emoji.name, totalReactions);
          }
        } catch (error) {
          logger.error(`Error processing URL ${url}: ${error.message}`);
          span.setAttributes({
            [ERROR.TYPE]: error.name || 'Error',
            [ERROR.MESSAGE]: error.message,
          });
        }
      }
    });
  }

  /**
   * Reaction-reveal for sandbox executions:
   *   🔍 → reply with the source code attachment
   *   📜 → reply with stdout (and stderr when non-empty)
   *   🐛 → reply with stderr only
   * Returns true when a reveal reply was sent, false otherwise.
   */
  async handleSandboxRevealReaction(reaction, user) {
    const emoji = reaction.emoji.name;
    if (!SANDBOX_REVEAL_EMOJI.has(emoji)) return false;
    if (!this.sandboxTraceService || !this.mongoService) return false;

    const message = reaction.message;
    if (!message || !message.id) return false;

    let executionIds;
    try {
      executionIds = await this.mongoService.getMessageExecutionIds(message.id);
    } catch (e) {
      logger.warn(`Failed to look up executionIds for message ${message.id}: ${e.message}`);
      return false;
    }
    if (!executionIds || executionIds.length === 0) return false;

    // Most recent execution is rightmost (agent_turn_index ascending).
    const targetExecutionId = executionIds[executionIds.length - 1];
    const trace = await this.sandboxTraceService.getByExecutionId(targetExecutionId);
    if (!trace) return false;

    const { AttachmentBuilder } = require('discord.js');
    const attachments = [];
    if (emoji === '🔍') {
      const a = this.sandboxTraceService.buildCodeAttachment(trace);
      attachments.push(new AttachmentBuilder(a.buffer, { name: a.filename }));
    } else if (emoji === '📜') {
      const out = this.sandboxTraceService.buildStdoutAttachment(trace);
      attachments.push(new AttachmentBuilder(out.buffer, { name: out.filename }));
      if ((trace.stderr || '').length > 0) {
        const err = this.sandboxTraceService.buildStderrAttachment(trace);
        attachments.push(new AttachmentBuilder(err.buffer, { name: err.filename }));
      }
    } else if (emoji === '🐛') {
      const err = this.sandboxTraceService.buildStderrAttachment(trace);
      attachments.push(new AttachmentBuilder(err.buffer, { name: err.filename }));
    }

    try {
      await message.reply({ files: attachments, allowedMentions: { repliedUser: false } });
    } catch (e) {
      logger.warn(`Failed to send sandbox reveal reply: ${e.message}`);
      return false;
    }
    logger.info(
      `Sandbox reveal: ${emoji} for execution ${targetExecutionId} (requested by ${user.tag || user.id})`,
    );
    return true;
  }
}

module.exports = ReactionHandler;
