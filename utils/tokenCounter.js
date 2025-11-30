// utils/tokenCounter.js
// Token counting utility for chat memory management

const { encoding_for_model } = require('tiktoken');
const logger = require('../logger');

// Lazy-loaded encoder instance
let encoder = null;

/**
 * Get or initialize the tiktoken encoder
 * @returns {Object|null} Encoder instance or null if initialization fails
 */
function getEncoder() {
  if (encoder) return encoder;

  try {
    encoder = encoding_for_model('gpt-4o');
    logger.debug('Token counter encoder initialized (gpt-4o)');
    return encoder;
  } catch (error) {
    logger.error('Failed to initialize token counter encoder:', error.message);
    return null;
  }
}

/**
 * Count tokens in a text string
 * @param {string} text - Text to count tokens for
 * @returns {number} Token count, or 0 if counting fails
 */
function countTokens(text) {
  if (!text || typeof text !== 'string') return 0;

  const enc = getEncoder();
  if (!enc) return 0;

  try {
    const tokens = enc.encode(text);
    return tokens.length;
  } catch (error) {
    logger.error('Error counting tokens:', error.message);
    return 0;
  }
}

/**
 * Count total tokens in an array of chat messages
 * Accounts for message formatting overhead
 * @param {Array} messages - Array of {role, content} message objects
 * @returns {number} Total token count
 */
function countMessageTokens(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return 0;

  let totalTokens = 0;

  // Per-message overhead (role tokens + formatting)
  const MESSAGE_OVERHEAD = 4;

  for (const message of messages) {
    totalTokens += MESSAGE_OVERHEAD;

    if (message.role) {
      totalTokens += countTokens(message.role);
    }

    if (message.content) {
      totalTokens += countTokens(message.content);
    }
  }

  // Reply priming overhead
  totalTokens += 3;

  return totalTokens;
}

/**
 * Check if adding new tokens would exceed the limit
 * @param {number} currentCount - Current token count
 * @param {number} newTokens - Tokens to add
 * @param {number} limit - Maximum token limit (default: 150000)
 * @returns {boolean} True if adding would exceed limit
 */
function wouldExceedLimit(currentCount, newTokens, limit = 150000) {
  return (currentCount + newTokens) > limit;
}

/**
 * Estimate tokens for a new user message with username prefix
 * @param {string} username - Discord username
 * @param {string} content - Message content
 * @returns {number} Estimated token count
 */
function estimateUserMessageTokens(username, content) {
  const formattedMessage = `[${username}]: ${content}`;
  return countTokens(formattedMessage) + 4; // Add message overhead
}

/**
 * Get token budget remaining
 * @param {number} currentCount - Current token count
 * @param {number} limit - Maximum token limit (default: 150000)
 * @returns {number} Remaining tokens
 */
function getRemainingBudget(currentCount, limit = 150000) {
  return Math.max(0, limit - currentCount);
}

module.exports = {
  countTokens,
  countMessageTokens,
  wouldExceedLimit,
  estimateUserMessageTokens,
  getRemainingBudget
};
