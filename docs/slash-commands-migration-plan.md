# Slash Commands Migration Plan

## Overview

This document outlines the migration from prefix-based commands (`!command`) to Discord slash commands (`/command`) for the discord-article-bot.

**Discord.js Version:** 14.25.1 (full slash command support)
**Current Commands:** 21 across 8 categories
**Estimated Effort:** Medium-High

---

## Reply Context Problem

### Current Behavior

The bot has a `ReplyHandler` that provides seamless conversation continuation:

1. **Personality Chat Replies**: User replies to a bot message → bot detects personality from emoji/name header → continues conversation without needing `!chat personality`

2. **Summarization Follow-ups**: User replies to a summary → bot extracts article context → answers follow-up questions about the article

This is a significant UX feature that allows natural conversation flow using Discord's native reply mechanism.

### The Challenge

Slash commands are **interaction-based**, not message-based. When a user types `/chat`, they get a structured form response—there's no "message" to reply to in the traditional sense. We need to preserve the ability to continue conversations without re-invoking the slash command.

---

## Solution Options for Reply Context

### Solution A: Keep `messageCreate` for Replies (Recommended)

**Approach:** Use slash commands for initiating interactions, but keep the `messageCreate` listener specifically for handling replies to bot messages.

```
┌─────────────────────────────────────────────────────────────┐
│  User types /chat → Slash command handler → Bot responds    │
│                                                             │
│  User replies to bot message → messageCreate fires          │
│  → ReplyHandler detects it's a reply to bot                 │
│  → Continues conversation seamlessly                        │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**
```javascript
// bot.js - Keep BOTH handlers
client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    await slashCommandHandler.execute(interaction);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Only handle replies to bot messages
  if (message.reference) {
    const referenced = await message.channel.messages.fetch(message.reference.messageId);
    if (referenced.author.id === client.user.id) {
      await replyHandler.handleReply(message, referenced);
    }
  }
});
```

**Pros:**
- Zero changes to ReplyHandler
- Maintains exact current UX for replies
- Clean separation: slash commands for new interactions, replies for continuations

**Cons:**
- Hybrid approach (two event handlers)
- Users might try to use `!chat` out of habit (but it just won't work)

**Verdict:** This is the cleanest solution that preserves the best UX with minimal changes.

---

### Solution B: Thread-Based Conversations

**Approach:** When a user starts a `/chat` conversation, automatically create a Discord thread. All messages in that thread are treated as continuations.

```
┌─────────────────────────────────────────────────────────────┐
│  User: /chat personality:clair message:Hello!               │
│                                                             │
│  Bot creates thread: "Chat with Clair"                      │
│  Bot posts first response in thread                         │
│                                                             │
│  [Inside thread]                                            │
│  User: "What's your favorite color?" (no command needed)    │
│  Bot: Responds as Clair                                     │
│  User: "Tell me more"                                       │
│  Bot: Continues conversation                                │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**
```javascript
// In ChatSlashCommand execute()
async execute(interaction) {
  const personality = interaction.options.getString('personality');
  const message = interaction.options.getString('message');

  // Create a thread for this conversation
  const thread = await interaction.channel.threads.create({
    name: `Chat with ${personality.name}`,
    autoArchiveDuration: 60, // Archive after 1 hour of inactivity
    reason: `Conversation started by ${interaction.user.tag}`
  });

  // Respond in the thread
  await interaction.reply({
    content: `Started a conversation with ${personality.emoji} **${personality.name}** in ${thread}`,
    ephemeral: true
  });

  const response = await chatService.chat(...);
  await thread.send(formatResponse(response));

  // Store thread<->personality mapping
  activeThreads.set(thread.id, { personalityId: personality.id, userId: interaction.user.id });
}

// In messageCreate handler
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Check if this is in an active chat thread
  if (message.channel.isThread() && activeThreads.has(message.channel.id)) {
    const { personalityId, userId } = activeThreads.get(message.channel.id);
    // Continue conversation...
  }
});
```

**Pros:**
- Conversations are organized in threads (easy to find later)
- Clear visual separation between different chats
- Works well for long conversations
- Thread auto-archive handles cleanup

**Cons:**
- Creates many threads (could clutter channel)
- Requires thread permission management
- Slightly heavier UX for quick one-off questions
- Need to track thread<->personality mappings

**Verdict:** Good for power users who have long conversations; may be overkill for quick interactions.

---

### Solution C: Message Components (Buttons + Modals)

**Approach:** Each bot response includes a "Continue" button. Clicking it opens a modal (text input form) for the next message.

```
┌─────────────────────────────────────────────────────────────┐
│  🕵️ **Jack Shadows**                                        │
│                                                             │
│  The dame walked in like trouble wearing heels...           │
│                                                             │
│  [Continue Conversation] [End Chat]                         │
└─────────────────────────────────────────────────────────────┘

User clicks [Continue Conversation]

┌─────────────────────────────────────────────────────────────┐
│  Continue with Jack Shadows                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Your message:                                        │   │
│  │ _____________________________________________        │   │
│  │                                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                    [Cancel] [Send]          │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**
```javascript
const { ActionRowBuilder, ButtonBuilder, ModalBuilder, TextInputBuilder } = require('discord.js');

// When responding to /chat
const row = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId(`continue_chat:${personalityId}:${channelId}`)
    .setLabel('Continue Conversation')
    .setStyle(ButtonStyle.Primary),
  new ButtonBuilder()
    .setCustomId(`end_chat:${personalityId}:${channelId}`)
    .setLabel('End Chat')
    .setStyle(ButtonStyle.Secondary)
);

await interaction.reply({ content: response, components: [row] });

// Handle button click
client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton() && interaction.customId.startsWith('continue_chat:')) {
    const [_, personalityId, channelId] = interaction.customId.split(':');

    const modal = new ModalBuilder()
      .setCustomId(`chat_modal:${personalityId}:${channelId}`)
      .setTitle(`Continue with ${personalityName}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('message')
            .setLabel('Your message')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
        )
      );

    await interaction.showModal(modal);
  }
});

// Handle modal submit
client.on('interactionCreate', async (interaction) => {
  if (interaction.isModalSubmit() && interaction.customId.startsWith('chat_modal:')) {
    const message = interaction.fields.getTextInputValue('message');
    // Continue conversation...
  }
});
```

**Pros:**
- Fully slash-command-native approach
- Clear call-to-action for users
- Works well on mobile (tap to continue)
- Personality context embedded in button ID

**Cons:**
- More clicks than just replying (worse UX for fast typists)
- Buttons expire after 15 minutes (need to handle stale buttons)
- Modal text input is limited to 4000 characters
- Modals feel more "form-like" than conversational

**Verdict:** Good fallback option, but adds friction compared to native replies.

---

### Solution D: Context Menu Commands

**Approach:** Add a right-click context menu option on bot messages: "Continue Conversation"

```
User right-clicks bot message → Apps → Continue Conversation
```

**Implementation:**
```javascript
const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');

const contextMenu = new ContextMenuCommandBuilder()
  .setName('Continue Conversation')
  .setType(ApplicationCommandType.Message);

// Handle context menu
client.on('interactionCreate', async (interaction) => {
  if (interaction.isMessageContextMenuCommand()) {
    if (interaction.commandName === 'Continue Conversation') {
      const targetMessage = interaction.targetMessage;

      // Detect personality from message content
      const personalityInfo = detectPersonalityFromMessage(targetMessage.content);

      if (personalityInfo) {
        // Show modal to get user's message
        const modal = new ModalBuilder()...
        await interaction.showModal(modal);
      }
    }
  }
});
```

**Pros:**
- Discoverable via right-click menu
- Works on any historical bot message
- No buttons cluttering responses

**Cons:**
- Less discoverable than buttons
- Still requires modal for input
- Right-click → Apps → option is 3 clicks
- Mobile UX is tap-and-hold, then navigate

**Verdict:** Nice complement to other solutions, but not a primary approach.

---

## Recommended Approach: Solution A + Optional Threads

**Primary:** Keep `messageCreate` for reply handling (Solution A)
- Zero friction for continuing conversations
- Preserves existing UX exactly
- Simple implementation

**Optional Enhancement:** Add `/chatthread` command (Solution B variant)
- For users who want organized, long-form conversations
- Creates a dedicated thread for multi-turn chats
- Opt-in, not default behavior

```javascript
// Two slash commands for chat:
/chat personality:clair message:Hello!      // Quick chat, replies work normally
/chatthread personality:clair message:Hello! // Creates thread for extended chat
```

---

## Migration Architecture

### File Structure Changes

```
commands/
├── base/
│   ├── BaseCommand.js          → Keep (for any remaining prefix commands)
│   └── BaseSlashCommand.js     → NEW: Base class for slash commands
├── slash/                      → NEW: Slash command definitions
│   ├── ChatCommand.js
│   ├── SummarizeCommand.js
│   ├── ImagineCommand.js
│   ├── RecallCommand.js
│   └── ... (all 21 commands)
├── builders/                   → NEW: SlashCommandBuilder definitions
│   └── commandBuilders.js
└── ... (keep existing for reference during migration)

handlers/
├── SlashCommandHandler.js      → NEW: Handles interactionCreate
├── ReplyHandler.js             → KEEP: Unchanged
└── ...

scripts/
└── registerCommands.js         → NEW: One-time command registration
```

### New Base Class

```javascript
// commands/base/BaseSlashCommand.js
const { SlashCommandBuilder } = require('discord.js');

class BaseSlashCommand {
  constructor(options) {
    this.data = options.data; // SlashCommandBuilder instance
    this.cooldown = options.cooldown || 0;
  }

  async execute(interaction) {
    throw new Error('Execute method must be implemented');
  }

  async deferIfNeeded(interaction, ephemeral = false) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral });
    }
  }

  async sendLongResponse(interaction, content) {
    const chunks = this.splitMessage(content, 2000);

    if (!interaction.replied) {
      await interaction.editReply(chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp(chunks[i]);
      }
    }
  }
}
```

### Command Registration Script

```javascript
// scripts/registerCommands.js
const { REST, Routes } = require('discord.js');
const config = require('../config/config');
const { getAllCommandBuilders } = require('../commands/builders/commandBuilders');

async function registerCommands() {
  const commands = getAllCommandBuilders().map(cmd => cmd.toJSON());

  const rest = new REST().setToken(config.discord.token);

  console.log(`Registering ${commands.length} slash commands...`);

  // Register globally (takes up to 1 hour to propagate)
  await rest.put(
    Routes.applicationCommands(config.discord.clientId),
    { body: commands }
  );

  // Or register to specific guild (instant, good for testing)
  // await rest.put(
  //   Routes.applicationGuildCommands(clientId, guildId),
  //   { body: commands }
  // );

  console.log('Commands registered successfully!');
}

registerCommands().catch(console.error);
```

---

## Command Conversion Reference

### Simple Command (No Args)

**Before (`!personalities`):**
```javascript
class PersonalitiesCommand extends BaseCommand {
  constructor() {
    super({ name: 'personalities', aliases: ['chars'] });
  }
  async execute(message) {
    await message.reply(formatPersonalityList());
  }
}
```

**After (`/personalities`):**
```javascript
class PersonalitiesSlashCommand extends BaseSlashCommand {
  constructor() {
    super({
      data: new SlashCommandBuilder()
        .setName('personalities')
        .setDescription('List all available chat personalities')
    });
  }
  async execute(interaction) {
    await interaction.reply(formatPersonalityList());
  }
}
```

### Command with Options

**Before (`!chat clair Hello there!`):**
```javascript
async execute(message, args) {
  const [personality, ...messageParts] = args;
  const userMessage = messageParts.join(' ');
}
```

**After (`/chat personality:clair message:Hello there!`):**
```javascript
const data = new SlashCommandBuilder()
  .setName('chat')
  .setDescription('Chat with an AI personality')
  .addStringOption(option =>
    option.setName('personality')
      .setDescription('Which personality to chat with')
      .setRequired(false)
      .addChoices(
        { name: 'Clair (friendly assistant)', value: 'clair' },
        { name: 'Jack Shadows (noir detective)', value: 'jack' },
        // ... dynamically populated
      ))
  .addStringOption(option =>
    option.setName('message')
      .setDescription('Your message')
      .setRequired(true)
      .setMaxLength(2000));

async execute(interaction) {
  const personality = interaction.options.getString('personality') || 'clair';
  const userMessage = interaction.options.getString('message');
}
```

### Command with Attachments

**Before (`!imagine prompt` with attached image):**
```javascript
async execute(message, args) {
  const attachment = message.attachments.first();
  const imageUrl = attachment?.url;
}
```

**After (`/imagine prompt:text image:attachment`):**
```javascript
const data = new SlashCommandBuilder()
  .setName('imagine')
  .setDescription('Generate an image from text')
  .addStringOption(option =>
    option.setName('prompt')
      .setDescription('What to generate')
      .setRequired(true))
  .addAttachmentOption(option =>
    option.setName('reference')
      .setDescription('Optional reference image')
      .setRequired(false))
  .addStringOption(option =>
    option.setName('ratio')
      .setDescription('Aspect ratio')
      .addChoices(
        { name: '1:1 (Square)', value: '1:1' },
        { name: '16:9 (Landscape)', value: '16:9' },
        { name: '9:16 (Portrait)', value: '9:16' }
      ));

async execute(interaction) {
  const prompt = interaction.options.getString('prompt');
  const attachment = interaction.options.getAttachment('reference');
  const ratio = interaction.options.getString('ratio') || '1:1';
}
```

### Command with Subcommands

**Before (`!channeltrack enable/disable/status`):**
```javascript
async execute(message, args) {
  const subcommand = args[0]?.toLowerCase();
  switch (subcommand) {
    case 'enable': ...
    case 'disable': ...
    case 'status': ...
  }
}
```

**After (`/channeltrack enable`, `/channeltrack disable`, `/channeltrack status`):**
```javascript
const data = new SlashCommandBuilder()
  .setName('channeltrack')
  .setDescription('Manage channel conversation tracking')
  .addSubcommand(sub =>
    sub.setName('enable')
      .setDescription('Enable tracking for this channel'))
  .addSubcommand(sub =>
    sub.setName('disable')
      .setDescription('Disable tracking for this channel'))
  .addSubcommand(sub =>
    sub.setName('status')
      .setDescription('Show tracking status'));

async execute(interaction) {
  const subcommand = interaction.options.getSubcommand();
  switch (subcommand) {
    case 'enable': ...
    case 'disable': ...
    case 'status': ...
  }
}
```

---

## Key Differences to Remember

| Aspect | Prefix Command | Slash Command |
|--------|---------------|---------------|
| Getting args | `args[0]`, `args.join(' ')` | `interaction.options.getString('name')` |
| Replying | `message.reply(content)` | `interaction.reply(content)` |
| Follow-up | `message.channel.send(content)` | `interaction.followUp(content)` |
| Typing indicator | `message.channel.sendTyping()` | `interaction.deferReply()` |
| Author info | `message.author` | `interaction.user` |
| Channel | `message.channel` | `interaction.channel` |
| Guild | `message.guild` | `interaction.guild` |
| Private reply | Not possible | `interaction.reply({ ephemeral: true })` |
| Edit response | Not applicable | `interaction.editReply(content)` |

---

## Testing Checklist

- [ ] Register commands to test guild (instant propagation)
- [ ] Test each command with all parameter combinations
- [ ] Test reply-to-bot-message still works
- [ ] Test long responses are split correctly
- [ ] Test ephemeral responses where appropriate
- [ ] Test attachment handling for `/imagine`
- [ ] Test subcommands for `/channeltrack`
- [ ] Test autocomplete for personality choices
- [ ] Test cooldowns work correctly
- [ ] Test admin-only commands respect permissions
- [ ] Test error handling shows user-friendly messages
- [ ] Register commands globally and verify propagation
- [ ] Test on mobile Discord client

---

## Timeline Considerations

Since this is an informal project, here's a practical approach:

1. **Start with high-value commands**: `/chat`, `/imagine`, `/recall`
2. **Keep ReplyHandler unchanged** for seamless conversation continuation
3. **Convert remaining commands** as time permits
4. **No need for parallel running** - just switch when ready
5. **Use guild-specific registration** during development for instant updates

---

## Configuration Addition

Add to `config/config.js`:

```javascript
discord: {
  // ... existing config
  clientId: process.env.DISCORD_CLIENT_ID, // Required for slash command registration
  testGuildId: process.env.DISCORD_TEST_GUILD_ID, // Optional: for development
}
```
