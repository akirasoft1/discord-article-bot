// services/QdrantService.js
// Queries Qdrant vector database for IRC history search

const { QdrantClient } = require('@qdrant/js-client-rest');
const logger = require('../logger');
const { withSpan } = require('../tracing');
const { VECTOR_DB, GEN_AI, ERROR } = require('../tracing-attributes');

class QdrantService {
  constructor(openaiClient, config) {
    this.openai = openaiClient;
    this.config = config.qdrant || {};
    this.collection = this.config.collection || 'irc_history';

    this.client = new QdrantClient({
      host: this.config.host || 'localhost',
      port: this.config.port || 6333,
    });

    logger.info(`QdrantService initialized for collection: ${this.collection}`);
  }

  /**
   * Generate embedding for text using OpenAI
   * @param {string} text - Text to embed
   * @returns {Promise<number[]>} Embedding vector
   */
  async getEmbedding(text) {
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text
    });
    return response.data[0].embedding;
  }

  /**
   * Build Qdrant filter from options
   * @param {Object} options - Filter options
   * @returns {Object} Qdrant filter object
   */
  _buildFilter(options = {}) {
    const filter = { must: [], should: [] };

    // Filter by participants (OR - any of these)
    if (options.participants && options.participants.length > 0) {
      for (const participant of options.participants) {
        filter.should.push({
          key: 'participants',
          match: { value: participant }
        });
      }
    }

    // Filter by year (exact match)
    if (options.year) {
      filter.must.push({
        key: 'year',
        match: { value: options.year }
      });
    }

    // Filter by decade
    if (options.decade) {
      filter.must.push({
        key: 'decade',
        match: { value: options.decade }
      });
    }

    // Filter by channel
    if (options.channel) {
      filter.must.push({
        key: 'channel',
        match: { value: options.channel }
      });
    }

    // Filter by month/day for throwback feature
    if (options.month && options.day) {
      // Use text search on start_time field for month-day pattern
      const monthStr = String(options.month).padStart(2, '0');
      const dayStr = String(options.day).padStart(2, '0');
      filter.must.push({
        key: 'start_time',
        match: { text: `-${monthStr}-${dayStr}` }
      });
    }

    // Clean up empty arrays
    if (filter.must.length === 0) delete filter.must;
    if (filter.should.length === 0) delete filter.should;

    return Object.keys(filter).length > 0 ? filter : null;
  }

  /**
   * Semantic search for IRC conversations
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Search results
   */
  async search(query, options = {}) {
    return withSpan('qdrant.search', {
      [VECTOR_DB.SYSTEM]: 'qdrant',
      [VECTOR_DB.OPERATION]: 'search',
      [VECTOR_DB.COLLECTION]: this.collection,
      [VECTOR_DB.TOP_K]: options.limit || 5,
      [VECTOR_DB.SCORE_THRESHOLD]: options.scoreThreshold || 0.3,
      [VECTOR_DB.EMBEDDING_MODEL]: 'text-embedding-3-small',
      'search.query_length': query.length,
    }, async (span) => {
      try {
        const embedding = await this.getEmbedding(query);
        const filter = this._buildFilter(options);

        span.setAttribute(VECTOR_DB.HAS_FILTER, !!filter);

        const searchParams = {
          vector: embedding,
          limit: options.limit || 5,
          with_payload: true,
          score_threshold: options.scoreThreshold || 0.3  // Lowered from 0.5 - IRC conversations have lower semantic similarity
        };

        if (filter) {
          searchParams.filter = filter;
        }

        const results = await this.client.search(this.collection, searchParams);

        span.setAttribute(VECTOR_DB.RESULTS_COUNT, results.length);
        logger.debug(`IRC search for "${query}" returned ${results.length} results`);
        return results;
      } catch (error) {
        span.setAttributes({
          [ERROR.TYPE]: error.name || 'QdrantError',
          [ERROR.MESSAGE]: error.message,
        });
        logger.error(`QdrantService search error: ${error.message}`);
        throw error;
      }
    });
  }

  /**
   * Get random conversation from a specific month/day (for throwback)
   * @param {number} month - Month (1-12)
   * @param {number} day - Day (1-31)
   * @returns {Promise<Object|null>} Random conversation or null
   */
  async getRandomFromDate(month, day) {
    return withSpan('qdrant.scroll', {
      [VECTOR_DB.SYSTEM]: 'qdrant',
      [VECTOR_DB.OPERATION]: 'scroll',
      [VECTOR_DB.COLLECTION]: this.collection,
      'throwback.month': month,
      'throwback.day': day,
    }, async (span) => {
      try {
        // Build a date pattern to match
        const monthStr = String(month).padStart(2, '0');
        const dayStr = String(day).padStart(2, '0');

        // Scroll through matching records
        const response = await this.client.scroll(this.collection, {
          filter: {
            must: [{
              key: 'start_time',
              match: { text: `-${monthStr}-${dayStr}` }
            }]
          },
          limit: 100,
          with_payload: true
        });

        if (!response.points || response.points.length === 0) {
          span.setAttribute(VECTOR_DB.RESULTS_COUNT, 0);
          return null;
        }

        span.setAttribute(VECTOR_DB.RESULTS_COUNT, response.points.length);

        // Pick a random one
        const randomIndex = Math.floor(Math.random() * response.points.length);
        return response.points[randomIndex];
      } catch (error) {
        span.setAttributes({
          [ERROR.TYPE]: error.name || 'QdrantError',
          [ERROR.MESSAGE]: error.message,
        });
        logger.error(`QdrantService getRandomFromDate error: ${error.message}`);
        return null;
      }
    });
  }

  /**
   * Get conversations involving specific participants
   * @param {string[]} participants - IRC nicks to search for
   * @param {Object} options - Additional options
   * @returns {Promise<Array>} Matching conversations
   */
  async getByParticipants(participants, options = {}) {
    return withSpan('qdrant.scroll', {
      [VECTOR_DB.SYSTEM]: 'qdrant',
      [VECTOR_DB.OPERATION]: 'scroll',
      [VECTOR_DB.COLLECTION]: this.collection,
      [VECTOR_DB.HAS_FILTER]: true,
      'search.participants_count': participants.length,
    }, async (span) => {
      try {
        const filter = {
          should: participants.map(p => ({
            key: 'participants',
            match: { value: p }
          }))
        };

        const response = await this.client.scroll(this.collection, {
          filter,
          limit: options.limit || 20,
          with_payload: true
        });

        const results = response.points || [];
        span.setAttribute(VECTOR_DB.RESULTS_COUNT, results.length);
        return results;
      } catch (error) {
        span.setAttributes({
          [ERROR.TYPE]: error.name || 'QdrantError',
          [ERROR.MESSAGE]: error.message,
        });
        logger.error(`QdrantService getByParticipants error: ${error.message}`);
        return [];
      }
    });
  }

  /**
   * Format a search result for Discord display
   * @param {Object} result - Qdrant search result
   * @param {Object} options - Formatting options
   * @returns {string} Formatted string
   */
  formatResult(result, options = {}) {
    const payload = result.payload || {};
    const maxLength = options.maxLength || 500;

    const year = payload.year || '????';
    const channel = payload.channel || 'DM';
    const participants = (payload.participants || []).slice(0, 5).join(', ');
    const score = result.score ? ` (${Math.round(result.score * 100)}% match)` : '';

    let text = payload.text || '';
    if (text.length > maxLength) {
      text = text.substring(0, maxLength) + '...';
    }

    // Format timestamp if available
    let dateStr = '';
    if (payload.start_time) {
      try {
        const date = new Date(payload.start_time);
        dateStr = date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });
      } catch {
        dateStr = String(year);
      }
    } else {
      dateStr = String(year);
    }

    return `**${dateStr}** - ${channel}${score}\n*${participants}*\n\`\`\`\n${text}\n\`\`\``;
  }

  /**
   * Check if the service is available
   * @returns {Promise<boolean>}
   */
  async isHealthy() {
    try {
      await this.client.getCollection(this.collection);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = QdrantService;
