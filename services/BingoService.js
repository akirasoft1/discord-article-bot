// ===== services/BingoService.js =====
const logger = require('../logger');

class BingoService {
  constructor(openaiClient) {
    this.openaiClient = openaiClient;
  }

  async generateBingoCard(summary) {
    try {
      const bingoPrompt = `Based on the following article summary, generate 9 common news themes or keywords that could form a 3x3 bingo card. Each theme/keyword should be concise (1-3 words) and relevant to the article's content. Separate each item with a comma.

Summary: """${summary}"""

Themes:`;

      const response = await this.openaiClient.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: bingoPrompt }],
        max_tokens: 100,
        temperature: 0.8,
      });

      const themes = response.choices[0].message.content.trim().split(',').map(item => item.trim());

      if (themes.length < 9) {
        logger.warn(`Not enough themes generated for bingo card. Expected 9, got ${themes.length}`);
        return null;
      }

      // Shuffle themes and pick first 9
      for (let i = themes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [themes[i], themes[j]] = [themes[j], themes[i]];
      }

      const bingoCard = [
        themes.slice(0, 3),
        themes.slice(3, 6),
        themes.slice(6, 9),
      ];

      return bingoCard;
    } catch (error) {
      logger.error('Failed to generate bingo card:', error);
      return null;
    }
  }

  formatBingoCard(bingoCard) {
    if (!bingoCard || bingoCard.length === 0) {
      return '';
    }

    let formattedCard = '```\n';
    formattedCard += '---------------------\n';
    bingoCard.forEach(row => {
      formattedCard += '| ';
      row.forEach(item => {
        formattedCard += item.padEnd(5) + ' | ';
      });
      formattedCard += '\n---------------------\n';
    });
    formattedCard += '```';
    return formattedCard;
  }
}

module.exports = BingoService;
