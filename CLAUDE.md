# Discord Article Bot - Development Guidelines

## Deployment

- **Namespace**: Always deploy to `discord-article-bot` namespace, not `default`
- **Container name**: The deployment container is named `bot`, not `discord-article-bot`
- **Deploy command**: `kubectl set image deployment/discord-article-bot bot=mvilliger/discord-article-bot:<version> -n discord-article-bot`

## Slash Commands vs Prefix Commands

When creating or modifying slash commands, **always verify parity with the equivalent prefix command**:

1. **Service method signatures**: Verify correct method names and parameter order by checking the service implementation
   - Example: `resetConversation(channelId, personalityId)` - channelId comes first
   - Example: `listUserConversations(userId, guildId)` - requires guildId parameter

2. **Service enabled checks**: Optional services (Mem0, Qdrant, etc.) need `isEnabled()` checks at the start of execute()
   ```javascript
   if (!this.mem0Service.isEnabled()) {
     await this.sendReply(interaction, {
       content: 'Memory feature is not enabled on this bot.',
       ephemeral: true
     });
     return;
   }
   ```

3. **Error handling patterns**: Match error handling behavior - some errors should not have "Error:" prefix
   - Conversation limit reasons ('expired', 'message_limit', 'token_limit') are informational, not errors

4. **Default values**: All chat commands should default to `friendly` personality when none specified

5. **Formatter usage**: Use service formatters (e.g., `qdrantService.formatResult()`) for consistent output, or ensure manual formatting includes all relevant fields (match scores, participants, proper dates)

## Comparing Slash and Prefix Commands

For comprehensive comparison of command implementations, use Gemini CLI with its large context window:

```bash
gemini -p "@commands/slash/ @commands/chat/ @commands/irc/ @commands/utility/ Compare the slash command implementations with their prefix command equivalents. List all differences in: method calls, parameter handling, error handling, default values, service checks, and output formatting"
```

## Discord Embed Limits

- Embed field name: max 256 characters
- Embed field value: max 1024 characters (NOT 4000)
- Empty field values cause validation errors - always provide fallback text

## Testing

- Run `npm test` before deployment
- Slash command tests need to mock all service methods including `isEnabled()`
- Global slash commands take up to 1 hour to propagate; use `DISCORD_TEST_GUILD_ID` for faster testing

## File Locations

- Slash commands: `commands/slash/`
- Prefix commands: `commands/chat/`, `commands/irc/`, `commands/utility/`, `commands/image/`, `commands/video/`, `commands/memory/`
- Services: `services/`
- Tests: `__tests__/`
