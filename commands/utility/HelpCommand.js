const BaseCommand = require('../base/BaseCommand');
const { EmbedBuilder } = require('discord.js');

class HelpCommand extends BaseCommand {
  constructor(commandHandler) {
    super({
      name: 'help',
      aliases: ['h', 'commands'],
      description: 'Display available commands',
      category: 'utility',
      usage: '!help [command]',
      examples: [
        '!help',
        '!help summarize',
        '!help subscription'
      ],
      args: [
        { name: 'command', required: false, type: 'string' }
      ]
    });
    this.commandHandler = commandHandler;
  }

  async execute(message, args) {
    const [commandName] = args;

    if (commandName) {
      // Show specific command help
      const command = this.commandHandler.getCommand(commandName);
      
      if (!command) {
        return message.reply(`Command '${commandName}' not found. Use !help to see all commands.`);
      }

      const embed = new EmbedBuilder()
        .setTitle(`Command: ${command.name}`)
        .setDescription(command.description)
        .addFields(
          { name: 'Usage', value: command.usage, inline: false },
          { name: 'Category', value: command.category, inline: true }
        )
        .setColor(0x0099FF);

      if (command.aliases.length > 0) {
        embed.addFields({ name: 'Aliases', value: command.aliases.join(', '), inline: true });
      }

      if (command.examples.length > 0) {
        embed.addFields({ name: 'Examples', value: command.examples.join('\n'), inline: false });
      }

      return message.channel.send({ embeds: [embed] });
    }

    // Show all commands grouped by category
    const categories = this.commandHandler.getHelp();
    const embed = new EmbedBuilder()
      .setTitle('Available Commands')
      .setDescription('Use `!help <command>` for detailed information about a specific command.')
      .setColor(0x0099FF)
      .setFooter({ text: 'Discord Article Bot v0.6' });

    categories.forEach(([category, commands]) => {
      const commandList = commands
        .map(cmd => `\`${cmd.name}\` - ${cmd.description}`)
        .join('\n');
      
      embed.addFields({
        name: category.charAt(0).toUpperCase() + category.slice(1),
        value: commandList || 'No commands in this category',
        inline: false
      });
    });

    return message.channel.send({ embeds: [embed] });
  }
}

module.exports = HelpCommand;