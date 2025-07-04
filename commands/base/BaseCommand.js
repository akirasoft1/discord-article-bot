class BaseCommand {
  constructor(options) {
    this.name = options.name;
    this.aliases = options.aliases || [];
    this.description = options.description;
    this.category = options.category;
    this.usage = options.usage;
    this.examples = options.examples || [];
    this.args = options.args || [];
    this.permissions = options.permissions || [];
    this.cooldown = options.cooldown || 0;
  }

  validateArgs(args) {
    const requiredArgs = this.args.filter(arg => arg.required);
    
    // Check if we have enough arguments
    if (args.length < requiredArgs.length) {
      return false;
    }

    // Validate specific argument types
    for (let i = 0; i < this.args.length && i < args.length; i++) {
      const argDef = this.args[i];
      const argValue = args[i];

      if (argDef.type === 'url' && argValue) {
        try {
          new URL(argValue);
        } catch {
          return false;
        }
      }
    }

    return true;
  }

  getUsage() {
    const argString = this.args
      .map(arg => arg.required ? `<${arg.name}>` : `[${arg.name}]`)
      .join(' ');
    return `Usage: !${this.name} ${argString}`;
  }

  getHelp() {
    let helpText = `**${this.name}**\n`;
    helpText += `Description: ${this.description}\n`;
    helpText += `${this.getUsage()}\n`;
    
    if (this.aliases.length > 0) {
      helpText += `Aliases: ${this.aliases.join(', ')}\n`;
    }
    
    if (this.examples.length > 0) {
      helpText += `Examples:\n`;
      this.examples.forEach(example => {
        helpText += `  ${example}\n`;
      });
    }
    
    return helpText;
  }

  async execute(message, args, context) {
    throw new Error(`Command ${this.name} must implement execute method`);
  }

  /**
   * Helper method to send a reply using MessageService if available
   */
  async sendReply(message, content, context, options = {}) {
    if (context.bot?.messageService) {
      return context.bot.messageService.replyToMessage(message, content, options);
    } else {
      return message.reply({ content, ...options });
    }
  }

  /**
   * Helper method to send a message using MessageService if available
   */
  async sendMessage(channel, content, context, options = {}) {
    if (context.bot?.messageService) {
      return context.bot.messageService.sendMessage(channel, content, options);
    } else {
      return channel.send({ content, ...options });
    }
  }
}

module.exports = BaseCommand;