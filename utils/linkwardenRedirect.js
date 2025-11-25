// utils/linkwardenRedirect.js
// Shared utility for Linkwarden redirect messages in summarization commands

const config = require('../config/config');

/**
 * Check if Linkwarden redirect should be shown
 * @returns {boolean}
 */
function shouldRedirectToLinkwarden() {
  return config.linkwarden && config.linkwarden.enabled;
}

/**
 * Get the Linkwarden redirect message for summarization commands
 * @returns {string}
 */
function getLinkwardenRedirectMessage() {
  const linkwardenUrl = config.linkwarden.baseUrl;

  return `**Article Archiving via Linkwarden**

To archive and share articles (including paywalled content), please use the Linkwarden browser extension:

1. Install the Linkwarden browser extension for your browser
2. Navigate to the article you want to share
3. Click the extension and save to the designated collection
4. The article will be automatically archived and posted here within 1-2 minutes

**Linkwarden Instance:** ${linkwardenUrl}

This workflow ensures articles are properly archived and accessible even if the original goes offline or is behind a paywall.

*Note: Direct URL summarization commands are disabled when Linkwarden integration is active.*`;
}

module.exports = {
  shouldRedirectToLinkwarden,
  getLinkwardenRedirectMessage
};
