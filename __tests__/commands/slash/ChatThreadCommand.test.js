// __tests__/commands/slash/ChatThreadCommand.test.js
// Tests for ChatThreadCommand, particularly the handleThreadMessage method
// and error handling to prevent duplicate responses

const ChatThreadSlashCommand = require('../../../commands/slash/ChatThreadCommand');

// Mock the logger
jest.mock('../../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

// Mock the personality manager
jest.mock('../../../personalities', () => ({
  get: jest.fn((id) => {
    const personalities = {
      'noir-detective': {
        id: 'noir-detective',
        name: 'Jack Shadows',
        emoji: '🕵️',
        description: 'A hardboiled 1940s detective',
        systemPrompt: 'You are Jack Shadows, a noir detective.'
      },
      'friendly': {
        id: 'friendly',
        name: 'Friendly Assistant',
        emoji: '😊',
        description: 'A friendly assistant',
        systemPrompt: 'You are a friendly assistant.'
      }
    };
    return personalities[id] || null;
  }),
  list: jest.fn(() => [
    { id: 'noir-detective', name: 'Jack Shadows', emoji: '🕵️', description: 'A hardboiled 1940s detective' },
    { id: 'friendly', name: 'Friendly Assistant', emoji: '😊', description: 'A friendly assistant' }
  ])
}));

describe('ChatThreadSlashCommand', () => {
  let chatThreadCommand;
  let mockChatService;

  beforeEach(() => {
    jest.clearAllMocks();

    mockChatService = {
      chat: jest.fn().mockResolvedValue({
        success: true,
        message: 'Test response from personality',
        personality: {
          id: 'noir-detective',
          name: 'Jack Shadows',
          emoji: '🕵️'
        },
        tokens: { input: 100, output: 50, total: 150 },
        images: []
      })
    };

    chatThreadCommand = new ChatThreadSlashCommand(mockChatService);
  });

  describe('handleThreadMessage', () => {
    let mockMessage;

    beforeEach(() => {
      mockMessage = {
        content: 'Continue the story!',
        author: {
          id: 'user123',
          username: 'TestUser',
          tag: 'TestUser#1234',
          bot: false
        },
        channel: {
          id: 'thread123',
          send: jest.fn().mockResolvedValue({}),
          sendTyping: jest.fn().mockResolvedValue({})
        },
        guild: { id: 'guild456' },
        reply: jest.fn().mockResolvedValue({})
      };
    });

    it('should return false if thread is not in activeThreads', async () => {
      // Thread is not registered
      const result = await chatThreadCommand.handleThreadMessage(mockMessage);

      expect(result).toBe(false);
      expect(mockChatService.chat).not.toHaveBeenCalled();
      expect(mockMessage.reply).not.toHaveBeenCalled();
    });

    it('should return false for bot messages', async () => {
      mockMessage.author.bot = true;

      // Register the thread
      chatThreadCommand.activeThreads.set('thread123', {
        personalityId: 'noir-detective',
        userId: 'user123',
        channelId: 'channel789',
        guildId: 'guild456',
        createdAt: new Date()
      });

      const result = await chatThreadCommand.handleThreadMessage(mockMessage);

      expect(result).toBe(false);
      expect(mockChatService.chat).not.toHaveBeenCalled();
    });

    it('should process message and return true for registered thread', async () => {
      // Register the thread
      chatThreadCommand.activeThreads.set('thread123', {
        personalityId: 'noir-detective',
        userId: 'user123',
        channelId: 'channel789',
        guildId: 'guild456',
        createdAt: new Date()
      });

      const result = await chatThreadCommand.handleThreadMessage(mockMessage);

      expect(result).toBe(true);
      expect(mockMessage.channel.sendTyping).toHaveBeenCalled();
      expect(mockChatService.chat).toHaveBeenCalledWith(
        'noir-detective',
        'Continue the story!',
        mockMessage.author,
        'thread123',
        'guild456'
      );
      expect(mockMessage.reply).toHaveBeenCalled();
    });

    it('should return true even when chatService returns error', async () => {
      mockChatService.chat.mockResolvedValue({
        success: false,
        error: 'Something went wrong',
        reason: 'unknown'
      });

      // Register the thread
      chatThreadCommand.activeThreads.set('thread123', {
        personalityId: 'noir-detective',
        userId: 'user123',
        channelId: 'channel789',
        guildId: 'guild456',
        createdAt: new Date()
      });

      const result = await chatThreadCommand.handleThreadMessage(mockMessage);

      expect(result).toBe(true);
      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Error:')
        })
      );
    });

    it('should return true when chatService throws exception', async () => {
      mockChatService.chat.mockRejectedValue(new Error('API Error'));

      // Register the thread
      chatThreadCommand.activeThreads.set('thread123', {
        personalityId: 'noir-detective',
        userId: 'user123',
        channelId: 'channel789',
        guildId: 'guild456',
        createdAt: new Date()
      });

      const result = await chatThreadCommand.handleThreadMessage(mockMessage);

      // Should still return true to prevent reply handler from also processing
      expect(result).toBe(true);
    });

    it('should return true even if sendTyping throws', async () => {
      mockMessage.channel.sendTyping.mockRejectedValue(new Error('Typing error'));

      // Register the thread
      chatThreadCommand.activeThreads.set('thread123', {
        personalityId: 'noir-detective',
        userId: 'user123',
        channelId: 'channel789',
        guildId: 'guild456',
        createdAt: new Date()
      });

      const result = await chatThreadCommand.handleThreadMessage(mockMessage);

      // Should return true to prevent duplicate processing
      expect(result).toBe(true);
    });

    it('should return true even if reply throws after chat succeeds', async () => {
      mockMessage.reply.mockRejectedValue(new Error('Reply error'));

      // Register the thread
      chatThreadCommand.activeThreads.set('thread123', {
        personalityId: 'noir-detective',
        userId: 'user123',
        channelId: 'channel789',
        guildId: 'guild456',
        createdAt: new Date()
      });

      const result = await chatThreadCommand.handleThreadMessage(mockMessage);

      // Should still return true even if reply fails
      expect(result).toBe(true);
    });

    it('should handle conversation limit errors without Error prefix', async () => {
      mockChatService.chat.mockResolvedValue({
        success: false,
        error: 'Conversation has reached the message limit.',
        reason: 'message_limit'
      });

      // Register the thread
      chatThreadCommand.activeThreads.set('thread123', {
        personalityId: 'noir-detective',
        userId: 'user123',
        channelId: 'channel789',
        guildId: 'guild456',
        createdAt: new Date()
      });

      await chatThreadCommand.handleThreadMessage(mockMessage);

      // Should NOT prefix with "Error:"
      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Conversation has reached the message limit.'
        })
      );
    });

    it('should handle expired conversation without Error prefix', async () => {
      mockChatService.chat.mockResolvedValue({
        success: false,
        error: 'Conversation expired.',
        reason: 'expired'
      });

      // Register the thread
      chatThreadCommand.activeThreads.set('thread123', {
        personalityId: 'noir-detective',
        userId: 'user123',
        channelId: 'channel789',
        guildId: 'guild456',
        createdAt: new Date()
      });

      await chatThreadCommand.handleThreadMessage(mockMessage);

      // Should NOT prefix with "Error:"
      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Conversation expired.'
        })
      );
    });
  });

  describe('getThreadInfo', () => {
    it('should return thread info for registered thread', () => {
      const threadInfo = {
        personalityId: 'noir-detective',
        userId: 'user123',
        channelId: 'channel789',
        guildId: 'guild456',
        createdAt: new Date()
      };
      chatThreadCommand.activeThreads.set('thread123', threadInfo);

      const result = chatThreadCommand.getThreadInfo('thread123');

      expect(result).toEqual(threadInfo);
    });

    it('should return null for unregistered thread', () => {
      const result = chatThreadCommand.getThreadInfo('unknown-thread');

      expect(result).toBeNull();
    });
  });

  describe('cleanupOldThreads', () => {
    it('should remove threads older than 24 hours', () => {
      const oneDayAgo = new Date(Date.now() - (25 * 60 * 60 * 1000));
      const recently = new Date();

      chatThreadCommand.activeThreads.set('old-thread', {
        personalityId: 'friendly',
        createdAt: oneDayAgo
      });
      chatThreadCommand.activeThreads.set('new-thread', {
        personalityId: 'friendly',
        createdAt: recently
      });

      chatThreadCommand.cleanupOldThreads();

      expect(chatThreadCommand.activeThreads.has('old-thread')).toBe(false);
      expect(chatThreadCommand.activeThreads.has('new-thread')).toBe(true);
    });
  });
});
