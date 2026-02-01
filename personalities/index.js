// personalities/index.js
// Personality loader - automatically loads all personality files from this directory

const fs = require('fs');
const path = require('path');
const logger = require('../logger');

class PersonalityManager {
  constructor() {
    this.personalities = new Map();
    this.loadPersonalities();
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
   * Get a personality by ID
   * @param {string} id - The personality ID
   * @returns {Object|null} The personality or null if not found
   */
  get(id) {
    return this.personalities.get(id) || null;
  }

  /**
   * Get all available personalities
   * @returns {Array} Array of personality objects
   */
  getAll() {
    return Array.from(this.personalities.values());
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
      emoji: p.emoji || '🎭'
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
