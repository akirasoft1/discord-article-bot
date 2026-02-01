# Linkwarden Integration Implementation Plan

## Overview

This document outlines the implementation plan to integrate the Discord Article Bot with Linkwarden for article archiving. The current archive.today integration is non-functional and will be replaced with a self-hosted Linkwarden solution that supports authenticated content.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  User's Browser (logged into news sites)                         │
│  └─► Linkwarden Extension captures full page with auth context   │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  Linkwarden Instance (self-hosted)                               │
│  • Archives to: screenshot, PDF, readable text, monolith HTML    │
│  • Stores in "Discord Share" collection                          │
│  • AI auto-tagging (optional)                                    │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (bot polls every 1-2 min)
┌──────────────────────────────────────────────────────────────────┐
│  Discord Article Bot (updated)                                   │
│  • NEW: LinkwardenService - polls API for new links              │
│  • KEEP: SummarizationService - summarizes readable content      │
│  • KEEP: Analytics, subscriptions, RSS, all other features       │
│  • REMOVE: ArchiveService (archive.today - broken)               │
│  • Posts summary + Linkwarden link to Discord                    │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  Discord Channel                                                 │
│  • Summary embed with metadata                                   │
│  • Link to Linkwarden archived view                              │
│  • All archive formats accessible (PDF, screenshot, etc.)        │
└──────────────────────────────────────────────────────────────────┘
```

## User Workflow

1. **Find article** in browser (logged into news site if needed)
2. **Click Linkwarden extension** → save to "Discord Share" collection
3. **Linkwarden archives** automatically (10-30 seconds)
4. **Bot detects new link** (polls every 1-2 min)
5. **Bot posts to Discord**:
   - AI-generated summary (from readable content)
   - Link to view archived version in Linkwarden
   - Metadata (reading time, topic, source, etc.)
6. **Bot marks as posted** (moves to "Posted" collection or adds "posted" tag)

---

## Implementation Details

### Phase 1: New Files to Create

#### 1. `services/LinkwardenService.js`

```javascript
// services/LinkwardenService.js
const axios = require('axios');
const logger = require('../logger');

class LinkwardenService {
  constructor(config) {
    this.config = config.linkwarden;
    this.baseUrl = this.config.baseUrl;
    this.apiToken = this.config.apiToken;
    this.sourceCollectionId = this.config.sourceCollectionId;
    this.postedTagId = this.config.postedTagId;
    this.lastProcessedId = null;

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
  }

  /**
   * Fetch new links from the source collection that haven't been posted yet
   * @returns {Promise<Array>} Array of new links ready to post
   */
  async getNewLinks() {
    try {
      // Get links from the source collection, sorted newest first
      const response = await this.client.get('/api/v1/links', {
        params: {
          collectionId: this.sourceCollectionId,
          sort: 0 // DateNewestFirst
        }
      });

      if (response.data?.response) {
        const links = response.data.response;

        // Filter out links that already have the "posted" tag
        const unpostedLinks = links.filter(link => {
          const hasPostedTag = link.tags?.some(tag =>
            tag.id === this.postedTagId || tag.name === 'posted'
          );
          return !hasPostedTag && this.isArchiveComplete(link);
        });

        logger.info(`Found ${unpostedLinks.length} new unposted links in Linkwarden`);
        return unpostedLinks;
      }

      return [];
    } catch (error) {
      logger.error(`Error fetching links from Linkwarden: ${error.message}`);
      return [];
    }
  }

  /**
   * Check if a link's archive is complete (has readable content)
   * @param {Object} link - Linkwarden link object
   * @returns {boolean}
   */
  isArchiveComplete(link) {
    // Check if lastPreserved is set and readable content exists
    return link.lastPreserved &&
           link.lastPreserved !== '1970-01-01T00:00:00.000Z' &&
           (link.readable || link.textContent || link.monolith);
  }

  /**
   * Get a single link by ID with full details
   * @param {number} linkId
   * @returns {Promise<Object|null>}
   */
  async getLinkById(linkId) {
    try {
      const response = await this.client.get(`/api/v1/links/${linkId}`);
      return response.data?.response || null;
    } catch (error) {
      logger.error(`Error fetching link ${linkId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Fetch the readable content for a link
   * @param {number} linkId
   * @param {number} collectionId
   * @returns {Promise<string|null>}
   */
  async getReadableContent(linkId, collectionId) {
    try {
      // ArchivedFormat.readability = 3
      const response = await this.client.get(`/api/v1/archives/${linkId}`, {
        params: {
          format: 3 // readability format
        },
        responseType: 'text'
      });
      return response.data;
    } catch (error) {
      logger.error(`Error fetching readable content for link ${linkId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Mark a link as posted by adding the "posted" tag
   * @param {number} linkId
   * @returns {Promise<boolean>}
   */
  async markAsPosted(linkId) {
    try {
      const link = await this.getLinkById(linkId);
      if (!link) return false;

      // Add the "posted" tag to existing tags
      const existingTagIds = link.tags?.map(t => ({ id: t.id })) || [];
      const updatedTags = [...existingTagIds, { name: 'posted' }];

      await this.client.put(`/api/v1/links/${linkId}`, {
        tags: updatedTags
      });

      logger.info(`Marked link ${linkId} as posted`);
      return true;
    } catch (error) {
      logger.error(`Error marking link ${linkId} as posted: ${error.message}`);
      return false;
    }
  }

  /**
   * Build the public URL to view an archived link in Linkwarden
   * @param {Object} link - Linkwarden link object
   * @returns {string}
   */
  buildLinkwardenUrl(link) {
    return `${this.baseUrl}/links/${link.id}`;
  }

  /**
   * Build URLs for different archive formats
   * @param {Object} link - Linkwarden link object
   * @returns {Object}
   */
  buildArchiveUrls(link) {
    const base = `${this.baseUrl}/api/v1/archives/${link.id}`;
    return {
      screenshot: link.image ? `${base}?format=0` : null,  // PNG
      pdf: link.pdf ? `${base}?format=2` : null,
      readable: link.readable ? `${base}?format=3` : null,
      monolith: link.monolith ? `${base}?format=4` : null,
      linkwardenView: `${this.baseUrl}/links/${link.id}`
    };
  }

  /**
   * Test the connection to Linkwarden
   * @returns {Promise<boolean>}
   */
  async testConnection() {
    try {
      const response = await this.client.get('/api/v1/users/me');
      if (response.data?.response) {
        logger.info(`Connected to Linkwarden as: ${response.data.response.username}`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`Failed to connect to Linkwarden: ${error.message}`);
      return false;
    }
  }
}

module.exports = LinkwardenService;
```

#### 2. `services/LinkwardenPollingService.js`

```javascript
// services/LinkwardenPollingService.js
const logger = require('../logger');

class LinkwardenPollingService {
  constructor(linkwardenService, summarizationService, discordClient, config) {
    this.linkwardenService = linkwardenService;
    this.summarizationService = summarizationService;
    this.discordClient = discordClient;
    this.config = config;
    this.isRunning = false;
    this.pollInterval = null;
  }

  /**
   * Start the polling service
   */
  async start() {
    if (!this.config.linkwarden.enabled) {
      logger.info('Linkwarden integration is disabled');
      return;
    }

    // Test connection first
    const connected = await this.linkwardenService.testConnection();
    if (!connected) {
      logger.error('Failed to connect to Linkwarden. Polling will not start.');
      return;
    }

    const intervalMs = this.config.linkwarden.pollIntervalMs || 60000;
    logger.info(`Starting Linkwarden polling service (interval: ${intervalMs}ms)`);

    // Run immediately on start
    await this.poll();

    // Then set up interval
    this.pollInterval = setInterval(() => this.poll(), intervalMs);
    this.isRunning = true;
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
   * Poll for new links and process them
   */
  async poll() {
    try {
      const newLinks = await this.linkwardenService.getNewLinks();

      if (newLinks.length === 0) {
        logger.debug('No new links to process from Linkwarden');
        return;
      }

      logger.info(`Processing ${newLinks.length} new links from Linkwarden`);

      for (const link of newLinks) {
        await this.processLink(link);
      }
    } catch (error) {
      logger.error(`Error during Linkwarden poll: ${error.message}`);
    }
  }

  /**
   * Process a single link from Linkwarden
   * @param {Object} link - Linkwarden link object
   */
  async processLink(link) {
    try {
      logger.info(`Processing Linkwarden link: ${link.name || link.url}`);

      // Get the target Discord channel
      const channelId = this.config.linkwarden.discordChannelId;
      const channel = await this.discordClient.channels.fetch(channelId);

      if (!channel || !channel.isTextBased()) {
        logger.error(`Invalid Discord channel: ${channelId}`);
        return;
      }

      // Get readable content for summarization
      let content = link.textContent;
      if (!content && link.readable) {
        content = await this.linkwardenService.getReadableContent(
          link.id,
          link.collectionId
        );
      }

      // Build archive URLs
      const archiveUrls = this.linkwardenService.buildArchiveUrls(link);

      // Create a mock message object for the summarization service
      const mockMessage = {
        channel,
        reply: (options) => channel.send(options),
        react: () => Promise.resolve()
      };

      // Create a mock user object
      const mockUser = {
        id: 'linkwarden-bot',
        tag: 'Linkwarden Integration',
        username: 'linkwarden'
      };

      // Process through summarization service with Linkwarden context
      await this.summarizationService.processLinkwardenLink({
        link,
        content,
        archiveUrls,
        message: mockMessage,
        user: mockUser
      });

      // Mark as posted
      await this.linkwardenService.markAsPosted(link.id);

    } catch (error) {
      logger.error(`Error processing link ${link.id}: ${error.message}`);
    }
  }
}

module.exports = LinkwardenPollingService;
```

---

### Phase 2: Files to Modify

#### 1. `config/config.js` - Add Linkwarden Configuration

Add to the config object:

```javascript
linkwarden: {
  enabled: process.env.LINKWARDEN_ENABLED === 'true' || false,
  baseUrl: process.env.LINKWARDEN_URL || 'http://localhost:3000',
  apiToken: process.env.LINKWARDEN_API_TOKEN || '',
  sourceCollectionId: parseInt(process.env.LINKWARDEN_SOURCE_COLLECTION_ID || '0', 10),
  postedTagId: parseInt(process.env.LINKWARDEN_POSTED_TAG_ID || '0', 10),
  discordChannelId: process.env.LINKWARDEN_DISCORD_CHANNEL_ID || '',
  pollIntervalMs: parseInt(process.env.LINKWARDEN_POLL_INTERVAL_MS || '60000', 10),
}
```

#### 2. `bot.js` - Add Linkwarden Service Integration

Add imports:
```javascript
const LinkwardenService = require('./services/LinkwardenService');
const LinkwardenPollingService = require('./services/LinkwardenPollingService');
```

Add to constructor:
```javascript
// Initialize Linkwarden services
if (config.linkwarden.enabled) {
  this.linkwardenService = new LinkwardenService(config);
  this.linkwardenPollingService = new LinkwardenPollingService(
    this.linkwardenService,
    this.summarizationService,
    this.client,
    config
  );
}
```

Add to `setupEventHandlers` in the `ready` event:
```javascript
// Start Linkwarden polling
if (config.linkwarden.enabled) {
  this.linkwardenPollingService.start();
}
```

#### 3. `services/SummarizationService.js` - Add Linkwarden Processing Method

Add new method:

```javascript
/**
 * Process a link from Linkwarden (content already archived)
 * @param {Object} options - Link data from Linkwarden
 */
async processLinkwardenLink({ link, content, archiveUrls, message, user }) {
  if (this.isProcessing) {
    logger.info('Already processing a URL, queuing Linkwarden link.');
    // Consider implementing a queue here
    return;
  }

  this.isProcessing = true;

  try {
    const url = link.url;
    logger.info(`Processing Linkwarden link: ${url}`);

    // Check for duplicates in our MongoDB
    const existingArticle = await this.mongoService.findArticleByUrl(url);
    if (existingArticle) {
      logger.info(`Linkwarden link already processed: ${url}`);
      this.isProcessing = false;
      return;
    }

    // Use the readable content from Linkwarden for summarization
    let textContent = content;

    // If no content, we can't summarize
    if (!textContent) {
      logger.warn(`No readable content available for Linkwarden link: ${url}`);
      const noContentMessage = `New article archived: **${link.name || 'Untitled'}**\n${archiveUrls.linkwardenView}\n\n_No readable content available for summary._`;
      await message.channel.send(noContentMessage);
      this.isProcessing = false;
      return;
    }

    // Handle translation if needed
    let wasTranslated = false;
    let detectedLanguage = 'N/A';
    if (this.config.bot.autoTranslation.enabled) {
      const translationResult = await this.detectAndTranslate(textContent);
      textContent = translationResult.translatedText;
      wasTranslated = translationResult.wasTranslated;
      detectedLanguage = translationResult.detectedLanguage;
    }

    // Generate summary
    const result = await this.generateSummary(textContent, url, null, null, null, null);

    if (!result) {
      const errorMessage = `New article archived but summary failed: **${link.name || 'Untitled'}**\n${archiveUrls.linkwardenView}`;
      await message.channel.send(errorMessage);
      this.isProcessing = false;
      return;
    }

    // Enhance the summary
    const enhancedResult = await this.enhanceSummary(result.summary, textContent);

    // Find related articles
    let relatedArticles = [];
    if (enhancedResult.topic) {
      relatedArticles = await this.mongoService.findRelatedArticles(enhancedResult.topic, url);
    }

    // Get source credibility
    const sourceCredibility = this.sourceCredibilityService.rateSource(url);

    // Build response with Linkwarden-specific formatting
    const responseMessage = this.buildLinkwardenResponse({
      link,
      archiveUrls,
      summary: result.summary,
      ...enhancedResult,
      relatedArticles,
      sourceCredibility,
      wasTranslated,
      detectedLanguage,
    });

    // Persist to MongoDB
    await this.mongoService.persistData({
      userId: user.id,
      username: user.tag,
      url,
      inputTokens: result.tokens?.input || 0,
      outputTokens: result.tokens?.output || 0,
      topic: enhancedResult.topic,
      source: 'linkwarden'
    });

    // Send to Discord
    await message.channel.send(responseMessage);

    // Check for follow-ups
    if (enhancedResult.topic) {
      await this.checkAndNotifyFollowUps(url, enhancedResult.topic, result.summary);
    }

  } catch (error) {
    logger.error(`Error processing Linkwarden link: ${error.message}`);
    await message.channel.send(`An error occurred while processing the archived article.`);
  } finally {
    this.isProcessing = false;
  }
}

/**
 * Build Discord message for Linkwarden-archived content
 */
buildLinkwardenResponse({ link, archiveUrls, summary, readingTime, topic, sentiment, sourceCredibility, relatedArticles, wasTranslated, detectedLanguage }) {
  let response = '';

  // Title
  response += `**${link.name || 'Archived Article'}**\n\n`;

  // Summary
  response += `${summary}\n\n`;

  // Archive links
  response += `**Archived Version:** ${archiveUrls.linkwardenView}\n`;

  // Original URL
  if (link.url) {
    response += `**Original:** <${link.url}>\n`;
  }

  // Metadata
  response += `\n**Reading Time:** ${readingTime || 'N/A'}`;
  if (topic) response += ` | **Topic:** ${topic}`;
  if (sentiment) response += ` | **Sentiment:** ${sentiment}`;
  if (sourceCredibility) response += `\n**Source Rating:** ${sourceCredibility}`;

  // Translation info
  if (wasTranslated) {
    response += `\n*Translated from ${detectedLanguage}*`;
  }

  // Available formats
  const formats = [];
  if (archiveUrls.pdf) formats.push('PDF');
  if (archiveUrls.screenshot) formats.push('Screenshot');
  if (archiveUrls.readable) formats.push('Readable');
  if (archiveUrls.monolith) formats.push('Full Page');
  if (formats.length > 0) {
    response += `\n**Available Formats:** ${formats.join(', ')}`;
  }

  // Related articles
  if (relatedArticles && relatedArticles.length > 0) {
    response += `\n\n**Related Articles:**\n`;
    relatedArticles.slice(0, 3).forEach(article => {
      response += `• <${article.url}>\n`;
    });
  }

  return response;
}
```

Remove the archive.today references in `preprocessUrl` and `fetchContent` methods.

#### 4. Modify Summarization Commands to Redirect

Update `commands/summarization/SummarizeCommand.js`:

```javascript
const BaseCommand = require('../base/BaseCommand');
const config = require('../../config/config');

class SummarizeCommand extends BaseCommand {
  constructor(summarizationService) {
    super({
      name: 'summarize',
      aliases: ['sum'],
      description: 'Summarize an article from a URL',
      category: 'summarization',
      usage: '!summarize <url> [style]',
      examples: [
        '!summarize https://example.com/article',
      ],
      args: [
        { name: 'url', required: false, type: 'url' },
        { name: 'style', required: false, type: 'string' }
      ]
    });
    this.summarizationService = summarizationService;
  }

  async execute(message, args) {
    // Redirect to Linkwarden workflow
    if (config.linkwarden.enabled) {
      const linkwardenUrl = config.linkwarden.baseUrl;
      const redirectMessage = `**Article Archiving via Linkwarden**

To archive and share articles (including paywalled content), please use the Linkwarden browser extension:

1. Install the Linkwarden extension for your browser
2. Navigate to the article you want to share
3. Click the extension and save to the "Discord Share" collection
4. The article will be automatically archived and posted here within 1-2 minutes

**Linkwarden Instance:** ${linkwardenUrl}

This workflow ensures articles are properly archived and accessible even if the original goes offline or is behind a paywall.`;

      return message.reply(redirectMessage);
    }

    // Fallback to original behavior if Linkwarden is not enabled
    const [url, style] = args;

    if (!url) {
      return message.reply('Please provide a URL to summarize.');
    }

    if (style && !config.bot.summaryStyles.styles[style]) {
      const availableStyles = Object.keys(config.bot.summaryStyles.styles).join(', ');
      return message.reply(`Invalid summary style. Available styles: ${availableStyles}`);
    }

    return this.summarizationService.processUrl(url, message, message.author, style);
  }
}

module.exports = SummarizeCommand;
```

Apply similar changes to other summarization commands:
- `ReSummarizeCommand.js`
- `MoodSummarizeCommand.js`
- `NarrateSummarizeCommand.js`
- `HistoricalSummarizeCommand.js`
- `PerspectiveSummarizeCommand.js`
- `LearnLanguageCommand.js`
- `CulturalSummarizeCommand.js`
- `SummarizeWithContextCommand.js`

---

### Phase 3: Files to Remove

1. **`services/ArchiveService.js`** - No longer needed (archive.today integration)

2. **`utils/urlUtils.js`** - Remove or modify the `isArchiveUrl` function (only if it's solely for archive.today)

---

### Phase 4: Environment Variables

Add to `.env` or `configmap.yaml`:

```env
# Linkwarden Integration
LINKWARDEN_ENABLED=true
LINKWARDEN_URL=https://links.yourdomain.com
LINKWARDEN_API_TOKEN=your_api_token_here
LINKWARDEN_SOURCE_COLLECTION_ID=1
LINKWARDEN_POSTED_TAG_ID=1
LINKWARDEN_DISCORD_CHANNEL_ID=123456789012345678
LINKWARDEN_POLL_INTERVAL_MS=60000
```

---

## Setup Instructions

### 1. Linkwarden Configuration

1. Log into your Linkwarden instance
2. Create a new collection called "Discord Share"
3. Note the collection ID (visible in URL when viewing collection)
4. Create a tag called "posted" (this will mark processed articles)
5. Go to Settings → Access Tokens
6. Create a new token with "Never" expiry
7. Copy the secret key for use in the bot

### 2. Browser Extension Setup

1. Install the Linkwarden browser extension
2. Configure it to connect to your Linkwarden instance
3. Set the default collection to "Discord Share"

### 3. Bot Deployment

1. Add environment variables to your deployment
2. Deploy the updated bot
3. Verify the bot connects to Linkwarden on startup (check logs)

---

## Testing Checklist

- [ ] Bot starts successfully with Linkwarden enabled
- [ ] Bot connects to Linkwarden API on startup
- [ ] Bot polls Linkwarden at configured interval
- [ ] New links in "Discord Share" collection are detected
- [ ] Links without completed archives are skipped
- [ ] Readable content is fetched for summarization
- [ ] Summary is generated and posted to Discord
- [ ] Links are marked with "posted" tag after processing
- [ ] Duplicate links are not re-processed
- [ ] Commands redirect users to Linkwarden workflow
- [ ] All existing features (analytics, subscriptions) still work

---

## Migration Notes

1. **No data migration required** - MongoDB schema remains the same
2. **Existing analytics preserved** - New articles from Linkwarden will be tracked with `source: 'linkwarden'`
3. **RSS feeds still work** - The RSS service remains independent
4. **Reaction-based summarization** - Will redirect to Linkwarden instructions

---

## Future Enhancements

1. **Queue system** - Handle multiple links arriving simultaneously
2. **Webhook support** - If Linkwarden adds webhooks, switch from polling
3. **Collection-based channels** - Route different Linkwarden collections to different Discord channels
4. **Format preferences** - Let users choose which archive format to display
5. **Status updates** - Post progress messages while archiving is in progress
