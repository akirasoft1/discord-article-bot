const logger = require('../logger');

class CommandHandler {
  constructor() {
    this.commands = new Map();
    this.categories = new Map();
    this.cooldowns = new Map();
  }

  register(command) {
    // Register main command name
    this.commands.set(command.name, command);
    
    // Register aliases
    command.aliases.forEach(alias => {
      this.commands.set(alias, command);
    });

    // Organize by category
    if (!this.categories.has(command.category)) {
      this.categories.set(command.category, []);
    }
    
    // Only add to category list if it's not an alias
    const categoryCommands = this.categories.get(command.category);
    if (!categoryCommands.find(cmd => cmd.name === command.name)) {
      categoryCommands.push(command);
    }

    logger.info(`Registered command: ${command.name} (${command.category})`);
  }

  getCommand(name) {
    return this.commands.get(name);
  }

  async execute(message, commandName, args, context) {
    const command = this.commands.get(commandName);
    
    if (!command) {
      return null; // Unknown command
    }

    try {
      // Check permissions
      if (command.permissions.length > 0 && message.member) {
        const hasPermission = command.permissions.every(perm => 
          message.member.permissions.has(perm)
        );
        if (!hasPermission) {
          return message.reply('You do not have permission to use this command.');
        }
      }

      // Check cooldown
      if (command.cooldown > 0) {
        const cooldownKey = `${command.name}-${message.author.id}`;
        const cooldownTime = this.cooldowns.get(cooldownKey);
        
        if (cooldownTime && Date.now() < cooldownTime) {
          const timeLeft = Math.ceil((cooldownTime - Date.now()) / 1000);
          return message.reply(`Please wait ${timeLeft} seconds before using this command again.`);
        }
        
        this.cooldowns.set(cooldownKey, Date.now() + command.cooldown * 1000);
      }

      // Validate arguments
      if (!command.validateArgs(args)) {
        return message.reply(command.getUsage());
      }

      // Execute command
      logger.info(`Executing command: ${commandName} by ${message.author.tag}`);
      return await command.execute(message, args, context);
      
    } catch (error) {
      logger.error(`Error executing command ${commandName}:`, error);
      return message.reply('An error occurred while executing that command.');
    }
  }

  getHelp(category = null) {
    if (category) {
      return this.categories.get(category) || [];
    }
    return Array.from(this.categories.entries());
  }

  getAllCommands() {
    const uniqueCommands = new Map();
    this.commands.forEach((command, name) => {
      if (command.name === name) { // Skip aliases
        uniqueCommands.set(name, command);
      }
    });
    return Array.from(uniqueCommands.values());
  }
}

module.exports = CommandHandler;