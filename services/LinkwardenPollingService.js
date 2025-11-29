// services/LinkwardenPollingService.js
// Polling service that monitors Linkwarden for new archived links
// and triggers summarization and posting to Discord
const logger = require('../logger');
const { withRootSpan, withSpan, addSpanEvent, setSpanAttributes } = require('../tracing');

class LinkwardenPollingService {
  constructor(linkwardenService, summarizationService, discordClient, config) {
    this.linkwardenService = linkwardenService;
    this.summarizationService = summarizationService;
    this.discordClient = discordClient;
    this.config = config;

    this.isRunning = false;
    this.pollInterval = null;
    this.processingQueue = [];
    this.isProcessing = false;
  }

  /**
   * Start the polling service
   * Tests connection to Linkwarden before starting the poll loop
   */
  async start() {
    if (!this.config.linkwarden.enabled) {
      logger.info('Linkwarden integration is disabled');
      return false;
    }

    logger.info('Starting Linkwarden polling service...');

    // Test connection first
    const connectionResult = await this.linkwardenService.testConnection();
    if (!connectionResult.success) {
      logger.error(`Failed to connect to Linkwarden: ${connectionResult.error}`);
      logger.error('Linkwarden polling will not start. Please check your configuration.');
      return false;
    }

    logger.info(`Connected to Linkwarden as: ${connectionResult.username}`);

    // Verify the source collection exists
    const collectionResult = await this.linkwardenService.verifySourceCollection();
    if (!collectionResult.success) {
      logger.error(`Source collection not accessible: ${collectionResult.error}`);
      logger.error('Please create the collection in Linkwarden and update LINKWARDEN_SOURCE_COLLECTION_ID');
      return false;
    }

    logger.info(`Monitoring collection: "${collectionResult.collection.name}"`);

    // Verify Discord channel is accessible
    const channelId = this.config.linkwarden.discordChannelId;
    try {
      const channel = await this.discordClient.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        logger.error(`Discord channel ${channelId} is not a valid text channel`);
        return false;
      }
      logger.info(`Will post to Discord channel: #${channel.name}`);
    } catch (error) {
      logger.error(`Failed to access Discord channel ${channelId}: ${error.message}`);
      return false;
    }

    const intervalMs = this.config.linkwarden.pollIntervalMs || 60000;
    logger.info(`Poll interval: ${intervalMs}ms (${intervalMs / 1000}s)`);

    // Run immediately on start
    await this.poll();

    // Then set up interval
    this.pollInterval = setInterval(() => this.poll(), intervalMs);
    this.isRunning = true;

    logger.info('Linkwarden polling service started successfully');
    return true;
  }

  /**
   * Stop the polling service
   */
  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isRunning = false;
    logger.info('Linkwarden polling service stopped');
  }

  /**
   * Poll for new links and add them to the processing queue
   */
  async poll() {
    return withRootSpan('linkwarden.poll', {
      'linkwarden.collection_id': this.config.linkwarden.sourceCollectionId,
      'linkwarden.poll_interval_ms': this.config.linkwarden.pollIntervalMs,
    }, async (span) => {
      try {
        logger.debug('Polling Linkwarden for new links...');
        addSpanEvent('poll.started');

        const newLinks = await this.linkwardenService.getNewLinks();

        span.setAttribute('linkwarden.links_found', newLinks.length);

        if (newLinks.length === 0) {
          logger.debug('No new links to process from Linkwarden');
          addSpanEvent('poll.no_new_links');
          return;
        }

        logger.info(`Found ${newLinks.length} new links from Linkwarden`);
        addSpanEvent('poll.links_found', { count: newLinks.length });

        // Add to queue and start processing
        let queuedCount = 0;
        for (const link of newLinks) {
          // Check if link is already in queue
          const alreadyQueued = this.processingQueue.some(q => q.id === link.id);
          if (!alreadyQueued) {
            this.processingQueue.push(link);
            logger.debug(`Added link ${link.id} to processing queue`);
            queuedCount++;
          }
        }

        span.setAttribute('linkwarden.links_queued', queuedCount);
        span.setAttribute('linkwarden.queue_size', this.processingQueue.length);

        // Process queue if not already processing
        if (!this.isProcessing) {
          await this.processQueue();
        }
      } catch (error) {
        logger.error(`Error during Linkwarden poll: ${error.message}`);
        logger.error(error.stack);
        throw error; // Re-throw to let withRootSpan record the error
      }
    });
  }

  /**
   * Process queued links one at a time
   */
  async processQueue() {
    if (this.isProcessing || this.processingQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.processingQueue.length > 0) {
      const link = this.processingQueue.shift();

      try {
        await this.processLink(link);
      } catch (error) {
        logger.error(`Error processing link ${link.id}: ${error.message}`);
        // Don't re-queue failed links to avoid infinite loops
      }

      // Small delay between processing to avoid rate limits
      if (this.processingQueue.length > 0) {
        await this.delay(2000);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Process a single link from Linkwarden
   * @param {Object} link - Linkwarden link object
   */
  async processLink(link) {
    const linkName = link.name || link.url || `Link ${link.id}`;

    return withSpan('linkwarden.processLink', {
      'linkwarden.link.id': link.id,
      'linkwarden.link.name': linkName,
      'linkwarden.link.url': link.url,
      'linkwarden.link.has_textContent': !!link.textContent,
      'linkwarden.link.readable': link.readable || 'undefined',
      'linkwarden.link.monolith': link.monolith || 'undefined',
    }, async (span) => {
      logger.info(`Processing Linkwarden link: ${linkName}`);
      addSpanEvent('processLink.started', { link_id: link.id });

      try {
        // Get the target Discord channel
        const channelId = this.config.linkwarden.discordChannelId;
        const channel = await this.discordClient.channels.fetch(channelId);

        if (!channel || !channel.isTextBased()) {
          logger.error(`Invalid Discord channel: ${channelId}`);
          span.setAttribute('error.type', 'invalid_channel');
          return;
        }

        span.setAttribute('discord.channel.id', channelId);
        span.setAttribute('discord.channel.name', channel.name);

        // Try to get readable content for summarization
        // Priority order: textContent > readable > monolith (stripped HTML)
        let content = null;
        let contentSource = 'none';

        // Log available content types for debugging
        logger.debug(`Link ${link.id} content availability: textContent=${!!link.textContent}, readable=${link.readable}, monolith=${link.monolith}`);

        // 1. First try textContent (already extracted text)
        if (link.textContent) {
          content = link.textContent;
          contentSource = 'textContent';
          logger.info(`Using textContent for link ${link.id} (${content.length} chars)`);
          addSpanEvent('content.extracted', { source: 'textContent', chars: content.length });
        }

        // 2. If no textContent, try to fetch the readable archive (best for articles)
        if (!content && link.readable && link.readable !== 'unavailable') {
          logger.debug(`Fetching readable content for link ${link.id}`);
          addSpanEvent('content.fetching', { source: 'readable' });

          content = await this.linkwardenService.getReadableContent(link.id);
          if (content) {
            contentSource = 'readable';
            logger.info(`Using readable content for link ${link.id} (${content.length} chars)`);
            addSpanEvent('content.extracted', { source: 'readable', chars: content.length });
          } else {
            logger.warn(`Readable content fetch returned empty for link ${link.id}`);
            addSpanEvent('content.fetch_failed', { source: 'readable', reason: 'empty_response' });
          }
        } else if (!content && (!link.readable || link.readable === 'unavailable')) {
          logger.debug(`Readable content not available for link ${link.id} (readable=${link.readable})`);
        }

        // 3. If still no content, try monolith as last resort
        if (!content && link.monolith && link.monolith !== 'unavailable') {
          logger.debug(`Fetching monolith content for link ${link.id}`);
          addSpanEvent('content.fetching', { source: 'monolith' });

          const monolithHtml = await this.linkwardenService.getMonolithContent(link.id);
          if (monolithHtml) {
            logger.debug(`Monolith HTML retrieved for link ${link.id} (${monolithHtml.length} chars before stripping)`);
            span.setAttribute('linkwarden.monolith.raw_chars', monolithHtml.length);

            content = this.stripHtml(monolithHtml);
            contentSource = 'monolith';
            logger.info(`Using monolith content for link ${link.id} (${content.length} chars after HTML stripping)`);
            addSpanEvent('content.extracted', { source: 'monolith', chars: content.length, raw_chars: monolithHtml.length });

            // Warn if content is suspiciously short after stripping
            if (content.length < 200) {
              logger.warn(`Monolith content for link ${link.id} is very short after HTML stripping (${content.length} chars) - may indicate paywall or failed archive`);
              addSpanEvent('content.warning', { reason: 'short_content_after_strip', chars: content.length });
              span.setAttribute('linkwarden.content.possible_paywall', true);
            }
          } else {
            logger.warn(`Monolith content fetch returned empty for link ${link.id}`);
            addSpanEvent('content.fetch_failed', { source: 'monolith', reason: 'empty_response' });
          }
        } else if (!content && (!link.monolith || link.monolith === 'unavailable')) {
          logger.debug(`Monolith content not available for link ${link.id} (monolith=${link.monolith})`);
        }

        // Set final content attributes on span
        span.setAttribute('linkwarden.content.source', contentSource);
        span.setAttribute('linkwarden.content.chars', content ? content.length : 0);
        span.setAttribute('linkwarden.content.available', !!content);

        // Final content status logging
        if (!content) {
          logger.warn(`No content could be extracted for link ${link.id} - summarization will rely on URL/web search`);
          addSpanEvent('content.none_available', { fallback: 'web_search' });
        } else if (content.length < 100) {
          logger.warn(`Extracted content for link ${link.id} is very short (${content.length} chars from ${contentSource}) - may produce poor summary`);
          addSpanEvent('content.warning', { reason: 'very_short', chars: content.length });
        } else {
          logger.info(`Content extraction successful for link ${link.id}: ${content.length} chars from ${contentSource}`);
        }

        // Build archive URLs
        const archiveUrls = this.linkwardenService.buildArchiveUrls(link);
        const availableFormats = this.linkwardenService.getAvailableFormats(link);
        span.setAttribute('linkwarden.available_formats', availableFormats.join(','));

        // Create a mock message object for the summarization service
        const mockMessage = {
          channel,
          reply: async (options) => {
            if (typeof options === 'string') {
              return channel.send(options);
            }
            return channel.send(options);
          },
          react: () => Promise.resolve()
        };

        // Create a mock user object
        const mockUser = {
          id: 'linkwarden-integration',
          tag: 'Linkwarden',
          username: 'linkwarden'
        };

        // Process through summarization service
        addSpanEvent('summarization.started');
        await this.summarizationService.processLinkwardenLink({
          link,
          content,
          archiveUrls,
          availableFormats,
          message: mockMessage,
          user: mockUser
        });
        addSpanEvent('summarization.completed');

        // Mark as posted in Linkwarden
        addSpanEvent('linkwarden.marking_posted');
        const marked = await this.linkwardenService.markAsPosted(link.id);
        if (!marked) {
          logger.warn(`Failed to mark link ${link.id} as posted - may be processed again`);
          addSpanEvent('linkwarden.mark_posted_failed');
          span.setAttribute('linkwarden.marked_posted', false);
        } else {
          span.setAttribute('linkwarden.marked_posted', true);
        }

        logger.info(`Successfully processed Linkwarden link: ${linkName}`);
        addSpanEvent('processLink.completed');

      } catch (error) {
        logger.error(`Error processing link ${link.id}: ${error.message}`);
        logger.error(error.stack);
        throw error; // Re-throw to let withSpan record the error
      }
    });
  }

  /**
   * Strip HTML tags from content for summarization
   * @param {string} html - HTML content
   * @returns {string} Plain text content
   */
  stripHtml(html) {
    // Remove script and style elements entirely
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    // Replace common block elements with newlines
    text = text.replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, '\n');

    // Remove all remaining HTML tags
    text = text.replace(/<[^>]+>/g, '');

    // Decode common HTML entities
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");

    // Clean up whitespace
    text = text.replace(/\n\s*\n/g, '\n\n');
    text = text.trim();

    return text;
  }

  /**
   * Promise-based delay
   * @param {number} ms - Milliseconds to delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get the current status of the polling service
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isProcessing: this.isProcessing,
      queueLength: this.processingQueue.length,
      pollIntervalMs: this.config.linkwarden?.pollIntervalMs || 60000
    };
  }
}

module.exports = LinkwardenPollingService;
