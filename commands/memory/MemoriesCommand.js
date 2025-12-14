// commands/memory/MemoriesCommand.js
// View your stored memories

const BaseCommand = require('../base/BaseCommand');
const logger = require('../../logger');

// Maximum memories to display
const MAX_MEMORIES_DISPLAY = 20;

class MemoriesCommand extends BaseCommand {
  constructor() {
    super({
      name: 'memories',
      aliases: ['mymemories', 'whatdoyouknow'],
      description: 'View what the bot remembers about you',
      category: 'memory',
      usage: '!memories',
      examples: [
        '!memories',
        '!whatdoyouknow'
      ],
      args: []
    });
  }

  async execute(message, args, context) {
    const mem0Service = context.bot?.mem0Service;

    // Check if Mem0 service is available
    if (!mem0Service) {
      return message.reply({
        content: 'Memory service is not available. Please contact the bot administrator.',
        allowedMentions: { repliedUser: false }
      });
    }

    // Check if Mem0 is enabled
    if (!mem0Service.isEnabled()) {
      return message.reply({
        content: 'Memory feature is not enabled on this bot.',
        allowedMentions: { repliedUser: false }
      });
    }

    const userId = message.author.id;

    try {
      logger.info(`User ${message.author.tag} requested their memories`);

      const result = await mem0Service.getUserMemories(userId, { limit: MAX_MEMORIES_DISPLAY });
      const memories = result.results || [];

      if (memories.length === 0) {
        return message.reply({
          content: '🧠 I have no memories stored about you yet.\n\n' +
                   'Memories are automatically learned from our conversations, ' +
                   'or you can explicitly tell me something with `!remember <fact>`.',
          allowedMentions: { repliedUser: false }
        });
      }

      // Format memories for display
      const memoryList = memories.map((mem, index) => {
        const id = mem.id || `unknown-${index}`;
        const shortId = id.length > 12 ? id.substring(0, 12) + '...' : id;
        return `**${index + 1}.** ${mem.memory}\n   \`ID: ${shortId}\``;
      }).join('\n\n');

      const header = `🧠 **Your Memories** (${memories.length}${memories.length >= MAX_MEMORIES_DISPLAY ? '+' : ''})\n\n`;
      const footer = '\n\n---\n' +
                     '• To delete a specific memory: `!forget <memory_id>`\n' +
                     '• To delete ALL memories: `!forget all`\n' +
                     '• To add a memory: `!remember <fact>`';

      const response = header + memoryList + footer;

      // Handle long responses
      if (response.length > 2000) {
        // Split into multiple messages if needed
        const chunks = this.splitMessage(response, 1900);
        for (const chunk of chunks) {
          await message.channel.send(chunk);
        }
      } else {
        await message.reply({
          content: response,
          allowedMentions: { repliedUser: false }
        });
      }

    } catch (error) {
      logger.error(`Error fetching memories for user ${userId}: ${error.message}`);
      return message.reply({
        content: 'An error occurred while fetching your memories. Please try again later.',
        allowedMentions: { repliedUser: false }
      });
    }
  }

  /**
   * Split a long message into chunks
   * @param {string} text - Text to split
   * @param {number} maxLength - Maximum length per chunk
   * @returns {Array<string>} Array of chunks
   */
  splitMessage(text, maxLength) {
    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      let breakPoint = remaining.lastIndexOf('\n\n', maxLength);
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = remaining.lastIndexOf('\n', maxLength);
      }
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = maxLength;
      }

      chunks.push(remaining.substring(0, breakPoint));
      remaining = remaining.substring(breakPoint).trim();
    }

    return chunks;
  }
}

module.exports = MemoriesCommand;
