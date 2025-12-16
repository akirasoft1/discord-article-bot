// services/NickMappingService.js
// Maps Discord users to their historical IRC nicks

const fs = require('fs');
const path = require('path');
const logger = require('../logger');

class NickMappingService {
  constructor(mappingsPath = null) {
    this.mappings = [];
    this.nickToDiscord = new Map(); // lowercase nick -> mapping entry
    this.discordToNicks = new Map(); // discord ID -> mapping entry

    const filePath = mappingsPath || path.join(__dirname, '../config/nick_mappings.json');
    this._loadMappings(filePath);
  }

  _loadMappings(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        logger.warn(`Nick mappings file not found: ${filePath}`);
        return;
      }

      const data = fs.readFileSync(filePath, 'utf-8');
      this.mappings = JSON.parse(data);

      // Build lookup indexes
      for (const mapping of this.mappings) {
        const discordId = mapping.discord?.id;
        if (!discordId) continue;

        // Index by Discord ID
        this.discordToNicks.set(discordId, mapping);

        // Index by each IRC nick (lowercase for case-insensitive lookup)
        for (const nick of mapping.irc_nicks || []) {
          this.nickToDiscord.set(nick.toLowerCase(), mapping);
        }
      }

      logger.info(`Loaded ${this.mappings.length} nick mappings with ${this.nickToDiscord.size} IRC nicks`);
    } catch (error) {
      logger.error(`Failed to load nick mappings: ${error.message}`);
      this.mappings = [];
    }
  }

  /**
   * Get all IRC nicks associated with a Discord user ID
   * @param {string} discordId - Discord user ID
   * @returns {string[]} Array of IRC nicks
   */
  getIrcNicks(discordId) {
    const mapping = this.discordToNicks.get(discordId);
    return mapping?.irc_nicks || [];
  }

  /**
   * Get Discord user info for an IRC nick
   * @param {string} nick - IRC nick (case-insensitive)
   * @returns {Object|null} Discord user info or null
   */
  getDiscordUser(nick) {
    const mapping = this.nickToDiscord.get(nick.toLowerCase());
    return mapping?.discord || null;
  }

  /**
   * Check if an IRC nick belongs to a specific Discord user
   * @param {string} nick - IRC nick
   * @param {string} discordId - Discord user ID
   * @returns {boolean}
   */
  isNickOwnedBy(nick, discordId) {
    const mapping = this.nickToDiscord.get(nick.toLowerCase());
    return mapping?.discord?.id === discordId;
  }

  /**
   * Get all IRC nicks that have Discord mappings
   * @returns {string[]} Array of all mapped IRC nicks
   */
  getAllMappedNicks() {
    const nicks = [];
    for (const mapping of this.mappings) {
      nicks.push(...(mapping.irc_nicks || []));
    }
    return nicks;
  }

  /**
   * Search for nicks matching a pattern
   * @param {string} pattern - Search pattern (case-insensitive)
   * @returns {Array<{nick: string, discord: Object}>} Matching nicks with their Discord info
   */
  searchNicks(pattern) {
    const results = [];
    const lowerPattern = pattern.toLowerCase();

    for (const mapping of this.mappings) {
      for (const nick of mapping.irc_nicks || []) {
        if (nick.toLowerCase().includes(lowerPattern)) {
          results.push({
            nick,
            discord: mapping.discord
          });
        }
      }
    }

    return results;
  }

  /**
   * Get full mapping entry for a Discord user
   * @param {string} discordId - Discord user ID
   * @returns {Object|null} Full mapping entry or null
   */
  getMapping(discordId) {
    return this.discordToNicks.get(discordId) || null;
  }
}

module.exports = NickMappingService;
