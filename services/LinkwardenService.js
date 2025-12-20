// services/LinkwardenService.js
// Service for interacting with the Linkwarden API to fetch archived links
const axios = require('axios');
const logger = require('../logger');
const { withSpan } = require('../tracing');
const { LINKWARDEN, HTTP, ERROR } = require('../tracing-attributes');

class LinkwardenService {
  constructor(config) {
    this.config = config.linkwarden;
    this.baseUrl = this.config.baseUrl;
    this.externalUrl = this.config.externalUrl || this.baseUrl;
    this.apiToken = this.config.apiToken;
    this.sourceCollectionId = this.config.sourceCollectionId;
    this.postedTagName = this.config.postedTagName || 'posted';

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    logger.info(`LinkwardenService initialized with baseUrl: ${this.baseUrl}`);
  }

  /**
   * Fetch new links from the source collection that haven't been posted yet
   * Links must have completed archiving (lastPreserved set) and not have the "posted" tag
   * @returns {Promise<Array>} Array of new links ready to post
   */
  async getNewLinks() {
    return withSpan('linkwarden.getNewLinks', {
      [LINKWARDEN.OPERATION]: 'getNewLinks',
      [LINKWARDEN.COLLECTION_ID]: this.sourceCollectionId,
      [HTTP.METHOD]: 'GET',
      [HTTP.URL]: `${this.baseUrl}/api/v1/links`,
    }, async (span) => {
      try {
        // Get links from the source collection, sorted newest first
        const response = await this.client.get('/api/v1/links', {
          params: {
            collectionId: this.sourceCollectionId,
            sort: 0 // DateNewestFirst (from Linkwarden Sort enum)
          }
        });

        span.setAttribute(HTTP.STATUS_CODE, response.status);

        if (response.data?.response) {
          const links = response.data.response;
          span.setAttribute('linkwarden.total_links', links.length);

          // Filter out links that already have the "posted" tag or aren't fully archived
          const unpostedLinks = links.filter(link => {
            const hasPostedTag = link.tags?.some(tag =>
              tag.name.toLowerCase() === this.postedTagName.toLowerCase()
            );
            const isArchived = this.isArchiveComplete(link);

            if (hasPostedTag) {
              logger.debug(`Skipping link ${link.id} - already posted`);
            } else if (!isArchived) {
              logger.debug(`Skipping link ${link.id} - archive not complete yet`);
            }

            return !hasPostedTag && isArchived;
          });

          span.setAttribute(LINKWARDEN.LINKS_COUNT, unpostedLinks.length);

          if (unpostedLinks.length > 0) {
            logger.info(`Found ${unpostedLinks.length} new unposted links in Linkwarden`);
          }

          return unpostedLinks;
        }

        return [];
      } catch (error) {
        span.setAttributes({
          [ERROR.TYPE]: error.name || 'LinkwardenError',
          [ERROR.MESSAGE]: error.message,
          [HTTP.STATUS_CODE]: error.response?.status || 0,
        });
        logger.error(`Error fetching links from Linkwarden: ${error.message}`);
        if (error.response) {
          logger.error(`Response status: ${error.response.status}`);
          logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
        }
        return [];
      }
    });
  }

  /**
   * Check if a link's archive is complete
   * A link is considered complete if it has been preserved and has readable content
   * @param {Object} link - Linkwarden link object
   * @returns {boolean}
   */
  isArchiveComplete(link) {
    // Check if lastPreserved is set to a real date (not epoch)
    const hasBeenPreserved = link.lastPreserved &&
      link.lastPreserved !== '1970-01-01T00:00:00.000Z' &&
      new Date(link.lastPreserved).getTime() > 0;

    // Check if any readable content exists
    const hasContent = !!(link.readable || link.textContent || link.monolith || link.pdf);

    return hasBeenPreserved && hasContent;
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
   * Tries to get the readability-parsed content first, falls back to textContent
   * @param {number} linkId
   * @returns {Promise<string|null>}
   */
  async getReadableContent(linkId) {
    return withSpan('linkwarden.getReadableContent', {
      [LINKWARDEN.OPERATION]: 'getReadableContent',
      [LINKWARDEN.LINK_ID]: linkId,
      [LINKWARDEN.CONTENT_FORMAT]: 'readability',
      [HTTP.METHOD]: 'GET',
    }, async (span) => {
      try {
        // ArchivedFormat.readability = 3 in Linkwarden
        const response = await this.client.get(`/api/v1/archives/${linkId}`, {
          params: {
            format: 3 // readability format
          },
          responseType: 'text',
          // Don't throw on 404 - just return null
          validateStatus: (status) => status < 500
        });

        span.setAttribute(HTTP.STATUS_CODE, response.status);

        if (response.status === 200 && response.data) {
          const contentLength = response.data.length;
          span.setAttribute(LINKWARDEN.CONTENT_LENGTH, contentLength);
          logger.info(`Retrieved readable content for link ${linkId} (${contentLength} chars)`);

          // Log a preview of the content for debugging (first 200 chars)
          if (contentLength > 0) {
            const preview = response.data.substring(0, 200).replace(/\n/g, ' ');
            logger.debug(`Readable content preview for link ${linkId}: "${preview}..."`);
          }

          return response.data;
        }

        span.setAttribute(LINKWARDEN.CONTENT_LENGTH, 0);
        logger.debug(`No readable content available for link ${linkId} (status: ${response.status})`);
        return null;
      } catch (error) {
        span.setAttributes({
          [ERROR.TYPE]: error.name || 'LinkwardenError',
          [ERROR.MESSAGE]: error.message,
        });
        logger.error(`Error fetching readable content for link ${linkId}: ${error.message}`);
        return null;
      }
    });
  }

  /**
   * Fetch the monolith HTML content for a link
   * @param {number} linkId
   * @returns {Promise<string|null>}
   */
  async getMonolithContent(linkId) {
    try {
      // ArchivedFormat.monolith = 4 in Linkwarden
      const response = await this.client.get(`/api/v1/archives/${linkId}`, {
        params: {
          format: 4 // monolith format
        },
        responseType: 'text',
        validateStatus: (status) => status < 500
      });

      if (response.status === 200 && response.data) {
        const contentLength = response.data.length;
        logger.info(`Retrieved monolith content for link ${linkId} (${contentLength} chars)`);

        // Check for common paywall/error indicators in the HTML
        const lowerContent = response.data.toLowerCase();
        if (lowerContent.includes('subscribe') && lowerContent.includes('paywall') ||
            lowerContent.includes('sign in to read') ||
            lowerContent.includes('create a free account')) {
          logger.warn(`Monolith content for link ${linkId} may contain paywall - detected paywall-related keywords`);
        }

        return response.data;
      }

      logger.debug(`No monolith content available for link ${linkId} (status: ${response.status})`);
      return null;
    } catch (error) {
      logger.error(`Error fetching monolith content for link ${linkId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Mark a link as posted by adding the "posted" tag
   * @param {number} linkId
   * @returns {Promise<boolean>}
   */
  async markAsPosted(linkId) {
    return withSpan('linkwarden.markAsPosted', {
      [LINKWARDEN.OPERATION]: 'markAsPosted',
      [LINKWARDEN.LINK_ID]: linkId,
      [HTTP.METHOD]: 'PUT',
    }, async (span) => {
      try {
        const link = await this.getLinkById(linkId);
        if (!link) {
          span.setAttribute('linkwarden.link_found', false);
          logger.error(`Cannot mark link ${linkId} as posted - link not found`);
          return false;
        }

        span.setAttributes({
          'linkwarden.link_found': true,
          [LINKWARDEN.LINK_URL]: link.url,
        });

        // Build updated tags array - keep existing tags and add "posted"
        const existingTags = link.tags?.map(t => ({ name: t.name })) || [];
        const hasPostedTag = existingTags.some(t =>
          t.name.toLowerCase() === this.postedTagName.toLowerCase()
        );

        if (hasPostedTag) {
          span.setAttribute('linkwarden.already_posted', true);
          logger.debug(`Link ${linkId} already has posted tag`);
          return true;
        }

        const updatedTags = [...existingTags, { name: this.postedTagName }];

        // Include id and other fields in the body as the API seems to require 'id'
        // and might treat PUT as a full replacement
        const response = await this.client.put(`/api/v1/links/${linkId}`, {
          id: linkId,
          name: link.name,
          description: link.description,
          url: link.url,
          type: link.type,
          collectionId: link.collectionId,
          collection: link.collection,
          tags: updatedTags
        });

        span.setAttribute(HTTP.STATUS_CODE, response.status);
        logger.info(`Marked link ${linkId} as posted`);
        return true;
      } catch (error) {
        span.setAttributes({
          [ERROR.TYPE]: error.name || 'LinkwardenError',
          [ERROR.MESSAGE]: error.message,
          [HTTP.STATUS_CODE]: error.response?.status || 0,
        });
        logger.error(`Error marking link ${linkId} as posted: ${error.message}`);
        if (error.response) {
          logger.error(`Response: ${JSON.stringify(error.response.data)}`);
        }
        return false;
      }
    });
  }

  /**
   * Build the URL to view an archived link in Linkwarden
   * @param {Object} link - Linkwarden link object
   * @returns {string}
   */
  buildLinkwardenUrl(link) {
    // Check if monolith archive (format=4) is available, otherwise fallback to readable (format=2)
    const format = link.monolith && link.monolith !== 'unavailable' ? 4 : 2;
    return `${this.externalUrl}/preserved/${link.id}?format=${format}`;
  }

  /**
   * Build URLs for different archive formats
   * @param {Object} link - Linkwarden link object
   * @returns {Object} Object with URLs for each available format
   */
  buildArchiveUrls(link) {
    const base = `${this.externalUrl}/api/v1/archives/${link.id}`;

    return {
      // Screenshot (PNG format = 0)
      screenshot: link.image && link.image !== 'unavailable'
        ? `${base}?format=0`
        : null,
      // PDF format = 2
      pdf: link.pdf && link.pdf !== 'unavailable'
        ? `${base}?format=2`
        : null,
      // Readable format = 3
      readable: link.readable && link.readable !== 'unavailable'
        ? `${base}?format=3`
        : null,
      // Monolith format = 4
      monolith: link.monolith && link.monolith !== 'unavailable'
        ? `${base}?format=4`
        : null,
      // Direct link to view in Linkwarden UI
      linkwardenView: this.buildLinkwardenUrl(link)
    };
  }

  /**
   * Get available archive formats for a link as human-readable list
   * @param {Object} link - Linkwarden link object
   * @returns {string[]} Array of format names
   */
  getAvailableFormats(link) {
    const formats = [];

    if (link.image && link.image !== 'unavailable') formats.push('Screenshot');
    if (link.pdf && link.pdf !== 'unavailable') formats.push('PDF');
    if (link.readable && link.readable !== 'unavailable') formats.push('Readable');
    if (link.monolith && link.monolith !== 'unavailable') formats.push('Full Page');

    return formats;
  }

  /**
   * Test the connection to Linkwarden
   * @returns {Promise<{success: boolean, username?: string, error?: string}>}
   */
  async testConnection() {
    try {
      const response = await this.client.get('/api/v1/users/me');

      if (response.data?.response) {
        const user = response.data.response;
        logger.info(`Connected to Linkwarden as: ${user.username || user.email}`);
        return {
          success: true,
          username: user.username || user.email
        };
      }

      return {
        success: false,
        error: 'Invalid response from Linkwarden'
      };
    } catch (error) {
      const errorMessage = error.response?.data?.response || error.message;
      logger.error(`Failed to connect to Linkwarden: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Verify the source collection exists and is accessible
   * @returns {Promise<{success: boolean, collection?: Object, error?: string}>}
   */
  async verifySourceCollection() {
    try {
      const response = await this.client.get(`/api/v1/collections/${this.sourceCollectionId}`);

      if (response.data?.response) {
        const collection = response.data.response;
        logger.info(`Source collection verified: "${collection.name}" (ID: ${collection.id})`);
        return {
          success: true,
          collection
        };
      }

      return {
        success: false,
        error: 'Collection not found'
      };
    } catch (error) {
      const errorMessage = error.response?.data?.response || error.message;
      logger.error(`Failed to verify source collection: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage
      };
    }
  }
}

module.exports = LinkwardenService;
