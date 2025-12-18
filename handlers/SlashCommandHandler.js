// handlers/SlashCommandHandler.js
// Handles registration and execution of Discord slash commands

const { Collection } = require('discord.js');
const logger = require('../logger');

/**
 * Handler for Discord slash commands
 * Manages command registration, execution, and error handling
 */
class SlashCommandHandler {
  /**
   * @param {Object} config - Bot configuration
   */
  constructor(config) {
    this.config = config;
    // Collection of slash commands keyed by name
    this.commands = new Collection();
  }

  /**
   * Register a slash command
   * @param {BaseSlashCommand} command - The command instance to register
   */
  register(command) {
    if (!command.data || !command.data.name) {
      throw new Error('Command must have a data property with a name');
    }

    const name = command.data.name;

    if (this.commands.has(name)) {
      logger.warn(`Slash command /${name} is already registered, overwriting`);
    }

    this.commands.set(name, command);
    logger.debug(`Registered slash command: /${name}`);
  }

  /**
   * Register multiple commands at once
   * @param {BaseSlashCommand[]} commands - Array of command instances
   */
  registerAll(commands) {
    for (const command of commands) {
      this.register(command);
    }
  }

  /**
   * Get all command builders for REST API registration
   * @returns {Object[]} Array of command JSON objects for Discord API
   */
  getCommandBuilders() {
    return Array.from(this.commands.values()).map(cmd => cmd.data.toJSON());
  }

  /**
   * Get a command by name
   * @param {string} name - Command name
   * @returns {BaseSlashCommand|undefined}
   */
  get(name) {
    return this.commands.get(name);
  }

  /**
   * Check if a command exists
   * @param {string} name - Command name
   * @returns {boolean}
   */
  has(name) {
    return this.commands.has(name);
  }

  /**
   * Get all registered commands
   * @returns {Collection<string, BaseSlashCommand>}
   */
  getAll() {
    return this.commands;
  }

  /**
   * Execute a slash command from an interaction
   * @param {CommandInteraction} interaction - The interaction to handle
   * @param {Object} context - Additional context (services, etc.)
   * @returns {Promise<boolean>} True if command was executed, false otherwise
   */
  async execute(interaction, context) {
    const commandName = interaction.commandName;
    const command = this.commands.get(commandName);

    if (!command) {
      logger.warn(`Unknown slash command: /${commandName}`);
      await interaction.reply({
        content: 'Unknown command.',
        ephemeral: true
      });
      return false;
    }

    // Check admin-only permission
    if (command.adminOnly) {
      const isAdmin = this.config.discord.adminUserIds.includes(interaction.user.id);
      if (!isAdmin) {
        await interaction.reply({
          content: 'This command requires administrator permissions.',
          ephemeral: true
        });
        return false;
      }
    }

    // Check cooldown
    const remainingCooldown = command.checkCooldown(interaction.user.id);
    if (remainingCooldown) {
      await interaction.reply({
        content: `Please wait ${remainingCooldown} seconds before using this command again.`,
        ephemeral: true
      });
      return false;
    }

    try {
      // Auto-defer if command requests it
      if (command.deferReply && !interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: command.ephemeral });
      }

      // Execute the command
      await command.execute(interaction, context);

      // Set cooldown after successful execution
      command.setCooldown(interaction.user.id);

      return true;
    } catch (error) {
      logger.error(`Error executing slash command /${commandName}: ${error.message}`);
      logger.debug(error.stack);

      // Try to send error response
      try {
        const errorMessage = 'An error occurred while executing this command.';

        if (interaction.deferred) {
          await interaction.editReply({ content: errorMessage });
        } else if (interaction.replied) {
          await interaction.followUp({ content: errorMessage, ephemeral: true });
        } else {
          await interaction.reply({ content: errorMessage, ephemeral: true });
        }
      } catch (replyError) {
        logger.error(`Failed to send error response: ${replyError.message}`);
      }

      return false;
    }
  }

  /**
   * Handle an interaction (entry point from bot.js)
   * Routes to appropriate handler based on interaction type
   * @param {Interaction} interaction - The interaction to handle
   * @param {Object} context - Additional context
   */
  async handleInteraction(interaction, context) {
    // Handle slash commands
    if (interaction.isChatInputCommand()) {
      return this.execute(interaction, context);
    }

    // Handle autocomplete (for commands with choices)
    if (interaction.isAutocomplete()) {
      return this.handleAutocomplete(interaction, context);
    }

    // Other interaction types (buttons, modals) can be added here
    // For now, return false to indicate not handled
    return false;
  }

  /**
   * Handle autocomplete interactions
   * @param {AutocompleteInteraction} interaction
   * @param {Object} context
   */
  async handleAutocomplete(interaction, context) {
    const command = this.commands.get(interaction.commandName);

    if (!command) {
      return false;
    }

    // If command has an autocomplete method, call it
    if (typeof command.autocomplete === 'function') {
      try {
        await command.autocomplete(interaction, context);
        return true;
      } catch (error) {
        logger.error(`Autocomplete error for /${interaction.commandName}: ${error.message}`);
        return false;
      }
    }

    return false;
  }

  /**
   * Get command count
   * @returns {number}
   */
  get size() {
    return this.commands.size;
  }

  /**
   * Get list of command names
   * @returns {string[]}
   */
  getCommandNames() {
    return Array.from(this.commands.keys());
  }
}

module.exports = SlashCommandHandler;
