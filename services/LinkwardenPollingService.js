// services/LinkwardenPollingService.js
// Polling service that monitors Linkwarden for new archived links
// and triggers summarization and posting to Discord
const logger = require('../logger');

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
    try {
      logger.debug('Polling Linkwarden for new links...');
      const newLinks = await this.linkwardenService.getNewLinks();

      if (newLinks.length === 0) {
        logger.debug('No new links to process from Linkwarden');
        return;
      }

      logger.info(`Found ${newLinks.length} new links from Linkwarden`);

      // Add to queue and start processing
      for (const link of newLinks) {
        // Check if link is already in queue
        const alreadyQueued = this.processingQueue.some(q => q.id === link.id);
        if (!alreadyQueued) {
          this.processingQueue.push(link);
          logger.debug(`Added link ${link.id} to processing queue`);
        }
      }

      // Process queue if not already processing
      if (!this.isProcessing) {
        await this.processQueue();
      }
    } catch (error) {
      logger.error(`Error during Linkwarden poll: ${error.message}`);
      logger.error(error.stack);
    }
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
    logger.info(`Processing Linkwarden link: ${linkName}`);

    try {
      // Get the target Discord channel
      const channelId = this.config.linkwarden.discordChannelId;
      const channel = await this.discordClient.channels.fetch(channelId);

      if (!channel || !channel.isTextBased()) {
        logger.error(`Invalid Discord channel: ${channelId}`);
        return;
      }

      // Try to get readable content for summarization
      let content = link.textContent;

      // If no textContent, try to fetch the readable archive
      if (!content && link.readable && link.readable !== 'unavailable') {
        logger.debug(`Fetching readable content for link ${link.id}`);
        content = await this.linkwardenService.getReadableContent(link.id);
      }

      // If still no content, try monolith
      if (!content && link.monolith && link.monolith !== 'unavailable') {
        logger.debug(`Fetching monolith content for link ${link.id}`);
        content = await this.linkwardenService.getMonolithContent(link.id);
        // Strip HTML tags for summarization
        if (content) {
          content = this.stripHtml(content);
        }
      }

      // Build archive URLs
      const archiveUrls = this.linkwardenService.buildArchiveUrls(link);
      const availableFormats = this.linkwardenService.getAvailableFormats(link);

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
      await this.summarizationService.processLinkwardenLink({
        link,
        content,
        archiveUrls,
        availableFormats,
        message: mockMessage,
        user: mockUser
      });

      // Mark as posted in Linkwarden
      const marked = await this.linkwardenService.markAsPosted(link.id);
      if (!marked) {
        logger.warn(`Failed to mark link ${link.id} as posted - may be processed again`);
      }

      logger.info(`Successfully processed Linkwarden link: ${linkName}`);

    } catch (error) {
      logger.error(`Error processing link ${link.id}: ${error.message}`);
      logger.error(error.stack);
      throw error;
    }
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
