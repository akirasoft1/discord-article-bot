// commands/memory/ForgetCommand.js
// Delete memories (specific or all)

const BaseCommand = require('../base/BaseCommand');
const logger = require('../../logger');

// Confirmation timeout in milliseconds
const CONFIRMATION_TIMEOUT = 30000;

class ForgetCommand extends BaseCommand {
  constructor() {
    super({
      name: 'forget',
      aliases: ['forgetme', 'deletememory'],
      description: 'Delete your stored memories (specific or all)',
      category: 'memory',
      usage: '!forget <memory_id | all>',
      examples: [
        '!forget mem-abc123',
        '!forget all',
        '!forgetme'
      ],
      args: [
        { name: 'memory_id', required: false, type: 'string' }
      ]
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

    // No arguments - show usage
    if (args.length === 0) {
      return message.reply({
        content: '**Usage:** `!forget <memory_id>` or `!forget all`\n\n' +
                 '• To delete a specific memory, use its ID from `!memories`\n' +
                 '• To delete ALL your memories, use `!forget all`\n\n' +
                 'Run `!memories` first to see your memory IDs.',
        allowedMentions: { repliedUser: false }
      });
    }

    const target = args[0].toLowerCase();

    // Delete all memories
    if (target === 'all') {
      return this.deleteAllMemories(message, mem0Service, userId);
    }

    // Delete specific memory
    return this.deleteSpecificMemory(message, mem0Service, args[0]);
  }

  /**
   * Delete a specific memory by ID
   */
  async deleteSpecificMemory(message, mem0Service, memoryId) {
    try {
      logger.info(`User ${message.author.tag} deleting memory: ${memoryId}`);

      await mem0Service.deleteMemory(memoryId);

      return message.reply({
        content: `✅ Memory \`${memoryId}\` has been deleted.\n\n` +
                 `Use \`!memories\` to see your remaining memories.`,
        allowedMentions: { repliedUser: false }
      });

    } catch (error) {
      logger.error(`Error deleting memory ${memoryId}: ${error.message}`);
      return message.reply({
        content: `An error occurred while deleting that memory. ` +
                 `Please check the memory ID is correct using \`!memories\`.`,
        allowedMentions: { repliedUser: false }
      });
    }
  }

  /**
   * Delete all memories for a user (with confirmation)
   */
  async deleteAllMemories(message, mem0Service, userId) {
    try {
      // First, check how many memories they have
      const result = await mem0Service.getUserMemories(userId, { limit: 100 });
      const memoryCount = result.results?.length || 0;

      if (memoryCount === 0) {
        return message.reply({
          content: 'You have no memories to delete.',
          allowedMentions: { repliedUser: false }
        });
      }

      // Ask for confirmation
      await message.reply({
        content: `⚠️ **Warning: This will delete ALL ${memoryCount}+ memories I have about you.**\n\n` +
                 `This action cannot be undone.\n\n` +
                 `Type **yes** to confirm, or anything else to cancel. ` +
                 `(Timeout: 30 seconds)`,
        allowedMentions: { repliedUser: false }
      });

      // Wait for confirmation
      const filter = (m) => m.author.id === userId;
      const collected = await message.channel.awaitMessages({
        filter,
        max: 1,
        time: CONFIRMATION_TIMEOUT,
        errors: ['time']
      }).catch(() => ({ size: 0 }));

      if (collected.size === 0) {
        return message.reply({
          content: '⏱️ Confirmation timed out. No memories were deleted.',
          allowedMentions: { repliedUser: false }
        });
      }

      const response = collected.first();
      if (response.content.toLowerCase() !== 'yes') {
        return message.reply({
          content: '❌ Cancelled. No memories were deleted.',
          allowedMentions: { repliedUser: false }
        });
      }

      // Delete all memories
      logger.info(`User ${message.author.tag} confirmed deletion of all memories`);
      await mem0Service.deleteAllUserMemories(userId);

      return message.reply({
        content: `✅ All your memories have been deleted.\n\n` +
                 `I no longer remember anything about you. ` +
                 `New memories will be created as we chat.`,
        allowedMentions: { repliedUser: false }
      });

    } catch (error) {
      logger.error(`Error deleting all memories for user ${userId}: ${error.message}`);
      return message.reply({
        content: 'An error occurred while deleting your memories. Please try again later.',
        allowedMentions: { repliedUser: false }
      });
    }
  }
}

module.exports = ForgetCommand;
