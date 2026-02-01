// personalities/index.js
// Personality loader - automatically loads all personality files from this directory

const fs = require('fs');
const path = require('path');
const logger = require('../logger');

class PersonalityManager {
  constructor() {
    this.personalities = new Map();
    this.localLlmService = null;
    this.loadPersonalities();
  }

  /**
   * Set the local LLM service reference for filtering personalities
   * @param {Object} localLlmService - The LocalLlmService instance
   */
  setLocalLlmService(localLlmService) {
    this.localLlmService = localLlmService;
  }

  /**
   * Load all personality files from the personalities directory
   */
  loadPersonalities() {
    const personalitiesDir = __dirname;
    const files = fs.readdirSync(personalitiesDir);

    for (const file of files) {
      // Skip index.js and non-JS files
      if (file === 'index.js' || !file.endsWith('.js')) {
        continue;
      }

      try {
        const personality = require(path.join(personalitiesDir, file));

        // Validate personality structure
        if (this.validatePersonality(personality)) {
          this.personalities.set(personality.id, personality);
          logger.debug(`Loaded personality: ${personality.name} (${personality.id})`);
        } else {
          logger.warn(`Invalid personality file: ${file} - missing required fields`);
        }
      } catch (error) {
        logger.error(`Failed to load personality from ${file}: ${error.message}`);
      }
    }

    logger.info(`Loaded ${this.personalities.size} personalities`);
  }

  /**
   * Validate that a personality has all required fields
   * @param {Object} personality - The personality object to validate
   * @returns {boolean} True if valid
   */
  validatePersonality(personality) {
    const requiredFields = ['id', 'name', 'description', 'systemPrompt'];
    return requiredFields.every(field => personality && personality[field]);
  }

  /**
   * Get a personality by ID (only if available)
   * @param {string} id - The personality ID
   * @returns {Object|null} The personality or null if not found/unavailable
   */
  get(id) {
    const personality = this.personalities.get(id);
    if (!personality) return null;

    // Check if personality is available
    if (!this.isPersonalityAvailable(personality)) {
      return null;
    }

    return personality;
  }

  /**
   * Get a personality by ID regardless of availability (for error messages)
   * @param {string} id - The personality ID
   * @returns {Object|null} The personality or null if not found
   */
  getRaw(id) {
    return this.personalities.get(id) || null;
  }

  /**
   * Check if a personality exists but is unavailable due to missing service
   * @param {string} id - The personality ID
   * @returns {{exists: boolean, available: boolean, reason: string|null}}
   */
  checkAvailability(id) {
    const personality = this.personalities.get(id);
    if (!personality) {
      return { exists: false, available: false, reason: null };
    }

    if (personality.useLocalLlm && (!this.localLlmService || !this.localLlmService.isAvailable())) {
      return {
        exists: true,
        available: false,
        reason: 'This personality requires the local LLM service which is currently unavailable'
      };
    }

    return { exists: true, available: true, reason: null };
  }

  /**
   * Check if a personality requiring local LLM should be available
   * @param {Object} personality - The personality to check
   * @returns {boolean} True if the personality should be available
   */
  isPersonalityAvailable(personality) {
    // If personality requires local LLM, check if service is available
    if (personality.useLocalLlm) {
      return this.localLlmService && this.localLlmService.isAvailable();
    }
    return true;
  }

  /**
   * Get all available personalities (filtered by service availability)
   * @returns {Array} Array of personality objects
   */
  getAll() {
    return Array.from(this.personalities.values())
      .filter(p => this.isPersonalityAvailable(p));
  }

  /**
   * Get a list of personality names and descriptions for display
   * @returns {Array} Array of {id, name, description} objects
   */
  list() {
    return this.getAll().map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      emoji: p.emoji || '🎭',
      useLocalLlm: p.useLocalLlm || false
    }));
  }

  /**
   * Check if a personality exists
   * @param {string} id - The personality ID
   * @returns {boolean} True if the personality exists
   */
  exists(id) {
    return this.personalities.has(id);
  }

  /**
   * Get the system prompt for a personality
   * @param {string} id - The personality ID
   * @param {boolean} useUncensored - Whether to return the uncensored variant if available
   * @returns {string|null} The system prompt or null if personality not found
   */
  getSystemPrompt(id, useUncensored = false) {
    const personality = this.get(id);
    if (!personality) return null;

    // Return uncensored prompt if requested and available, otherwise regular prompt
    if (useUncensored && personality.uncensoredSystemPrompt) {
      return personality.uncensoredSystemPrompt;
    }

    return personality.systemPrompt;
  }

  /**
   * Reload all personalities (useful for hot-reloading)
   */
  reload() {
    // Clear require cache for personality files
    const personalitiesDir = __dirname;
    const files = fs.readdirSync(personalitiesDir);

    for (const file of files) {
      if (file !== 'index.js' && file.endsWith('.js')) {
        const filePath = path.join(personalitiesDir, file);
        delete require.cache[require.resolve(filePath)];
      }
    }

    this.personalities.clear();
    this.loadPersonalities();
  }
}

// Export singleton instance
module.exports = new PersonalityManager();
