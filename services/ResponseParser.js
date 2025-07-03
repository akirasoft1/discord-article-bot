// ===== services/ResponseParser.js =====
const logger = require('../logger');

class ResponseParser {
  /**
   * Extract summary text from OpenAI responses API format
   */
  static extractSummaryFromResponse(response) {
    let summary = null;
    
    // Debug logging
    logger.debug('Response structure:', {
      hasOutput: !!response.output,
      outputLength: response.output?.length,
      hasOutputText: !!response.output_text
    });
    
    // Check if response has the expected structure
    if (response.output && response.output.length > 0) {
      const firstOutput = response.output[0];
      if (firstOutput.content && firstOutput.content.length > 0) {
        const textContent = firstOutput.content.find(c => c.type === 'output_text');
        if (textContent && textContent.text) {
          summary = textContent.text.trim();
          logger.debug('Found summary in response.output structure');
        }
      }
    }
    
    // Fallback to old format if needed
    if (!summary && response.output_text) {
      summary = response.output_text.trim();
      logger.debug('Found summary in response.output_text');
    }
    
    if (!summary) {
      logger.error('No summary text found in OpenAI response');
      logger.error('Full response structure:', JSON.stringify(response, null, 2));
      return null;
    }
    
    // Remove links from summary
    return this.sanitizeLinks(summary);
  }

  /**
   * Extract summary from completion API format
   */
  static extractSummaryFromCompletion(completion) {
    const summary = completion.choices[0]?.message?.content?.trim() || null;
    return summary ? this.sanitizeLinks(summary) : null;
  }

  /**
   * Build Discord-friendly response message
   */
  static buildDiscordMessage(result) {
    if (typeof result === 'string') {
      // Backward compatibility
      return `**Summary:** ${result}`;
    }
    
    if (!result.summary) {
      return null;
    }
    
    let message = `**Summary:** ${result.summary}`;

    // Add enhanced summary details if available
    if (result.readingTime || result.topic || result.sentiment) {
      message += '\n\n---\n';
      if (result.readingTime) message += `**Reading Time:** ${result.readingTime}\n`;
      if (result.topic) message += `**Topic:** ${result.topic}\n`;
      if (result.sentiment) message += `**Sentiment:** ${result.sentiment}
`;
      if (result.sourceCredibility) message += `**Source Credibility:** ${result.sourceCredibility}
`;
      if (result.biasAnalysis) message += `**Bias Analysis:** ${result.biasAnalysis}
`;
      if (result.context) message += `**Context:** ${result.context}
`;
      if (result.wasTranslated) message += `**Translated From:** ${result.detectedLanguage}
`;
    }
    
    // Add token and cost information if available
    if (result.tokens && result.costs) {
      message += '\n\n';
      message += `📊 **Token Usage:** Input: ${result.tokens.input.toLocaleString()}`;
      
      if (result.tokens.cached > 0) {
        message += ` (${result.tokens.cached.toLocaleString()} cached)`;
      }
      
      message += `, Output: ${result.tokens.output.toLocaleString()}, `;
      message += `Total: ${result.tokens.total.toLocaleString()}\n`;
      message += `💰 **Cost:** Input: ${result.costs.input}, `;
      message += `Output: ${result.costs.output}, Total: ${result.costs.total}`;
    }

    // Add related articles if available
    if (result.relatedArticles && result.relatedArticles.length > 0) {
      message += '\n\n---\n';
      message += '**Related Articles:**\n';
      result.relatedArticles.forEach((article, index) => {
        message += `${index + 1}. [${article.url}]\n`;
      });
    }
    
    return message;
  }

  /**
   * Remove or sanitize links from text to prevent Discord auto-expansion
   */
  static sanitizeLinks(text) {
    if (!text) return text;
    
    // Count links before removal for logging
    const linkCount = (text.match(/https?:\/\/[^\s]+/gi) || []).length;
    
    // First, handle markdown-style links: [text](url) -> [text]
    let sanitized = text.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gi, '[$1]');
    
    // Then handle any remaining plain URLs
    sanitized = sanitized.replace(/https?:\/\/(www\.)?([^\s\/]+)[^\s]*/gi, (match, www, domain) => {
      return `[${domain}]`;
    });
    
    // Clean up any potential double brackets or malformed remnants
    sanitized = sanitized.replace(/\[\[/g, '[').replace(/\]\]/g, ']');
    
    // Remove any orphaned parentheses that might be left
    sanitized = sanitized.replace(/\(\[([^\]]+)\]\)/g, '[$1]');
    
    if (linkCount > 0) {
      logger.info(`Sanitized ${linkCount} link(s) from summary`);
    }
    
    return sanitized;
  }
}

module.exports = ResponseParser;