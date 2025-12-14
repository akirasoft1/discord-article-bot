// commands/memory/RememberCommand.js
// Explicitly store a memory/fact about yourself

const BaseCommand = require('../base/BaseCommand');
const logger = require('../../logger');

// Maximum length for a fact
const MAX_FACT_LENGTH = 1000;

class RememberCommand extends BaseCommand {
  constructor() {
    super({
      name: 'remember',
      aliases: ['memorize', 'store'],
      description: 'Tell the bot to remember something about you',
      category: 'memory',
      usage: '!remember <fact>',
      examples: [
        '!remember I prefer dark mode',
        '!remember My favorite programming language is Python',
        '!remember I am allergic to peanuts'
      ],
      args: [
        { name: 'fact', required: true, type: 'string' }
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

    // Check if fact was provided
    if (args.length === 0) {
      return message.reply({
        content: '**Usage:** `!remember <fact>`\n\n' +
                 '**Examples:**\n' +
                 '• `!remember I prefer detailed explanations`\n' +
                 '• `!remember My timezone is PST`\n' +
                 '• `!remember I work as a software engineer`',
        allowedMentions: { repliedUser: false }
      });
    }

    const fact = args.join(' ').trim();

    // Validate fact length
    if (fact.length > MAX_FACT_LENGTH) {
      return message.reply({
        content: `Your fact is too long (${fact.length} characters). Please keep it under ${MAX_FACT_LENGTH} characters.`,
        allowedMentions: { repliedUser: false }
      });
    }

    const userId = message.author.id;
    const channelId = message.channel.id;
    const guildId = message.guild?.id || null;

    try {
      logger.info(`User ${message.author.tag} requesting to remember: "${fact.substring(0, 50)}..."`);

      // Format as a conversation so Mem0 can extract the fact
      // We phrase it as if the user is telling us directly
      const messages = [
        { role: 'user', content: `Please remember this about me: ${fact}` },
        { role: 'assistant', content: `Got it! I'll remember that ${fact}` }
      ];

      const result = await mem0Service.addMemory(messages, userId, {
        channelId: channelId,
        guildId: guildId,
        personalityId: 'explicit_memory', // Mark as explicitly stored
        source: 'remember_command'
      });

      const memoriesStored = result.results?.length || 0;

      if (memoriesStored > 0) {
        logger.info(`Stored ${memoriesStored} memory/memories for user ${userId}`);
        return message.reply({
          content: `✅ I've remembered that about you!\n\n` +
                   `> ${fact}\n\n` +
                   `Use \`!memories\` to see everything I remember.`,
          allowedMentions: { repliedUser: false }
        });
      } else {
        // Mem0 might not have extracted anything notable, but we acknowledge it
        logger.info(`Memory request acknowledged for user ${userId}, but Mem0 extracted nothing`);
        return message.reply({
          content: `📝 I've noted that, though I may already know this or it might not be something I can remember long-term.\n\n` +
                   `Use \`!memories\` to see what I currently remember about you.`,
          allowedMentions: { repliedUser: false }
        });
      }

    } catch (error) {
      logger.error(`Error storing memory for user ${userId}: ${error.message}`);
      return message.reply({
        content: 'An error occurred while storing your memory. Please try again later.',
        allowedMentions: { repliedUser: false }
      });
    }
  }
}

module.exports = RememberCommand;
