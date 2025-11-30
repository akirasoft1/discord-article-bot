// __tests__/services/ChatService.test.js
const ChatService = require('../../services/ChatService');

// Mock the logger
jest.mock('../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

// Mock the token counter
jest.mock('../../utils/tokenCounter', () => ({
  countTokens: jest.fn(() => 10),
  countMessageTokens: jest.fn(() => 100),
  wouldExceedLimit: jest.fn(() => false)
}));

// Mock the personality manager
jest.mock('../../personalities', () => ({
  get: jest.fn((id) => {
    if (id === 'test-personality') {
      return {
        id: 'test-personality',
        name: 'Test Character',
        emoji: '🧪',
        description: 'A test personality',
        systemPrompt: 'You are a test character.'
      };
    }
    return null;
  }),
  list: jest.fn(() => [
    { id: 'test-personality', name: 'Test Character', emoji: '🧪', description: 'A test personality' }
  ]),
  exists: jest.fn((id) => id === 'test-personality')
}));

describe('ChatService', () => {
  let chatService;
  let mockOpenAIClient;
  let mockMongoService;
  let mockConfig;

  beforeEach(() => {
    jest.clearAllMocks();

    mockOpenAIClient = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: 'Test response from personality' } }],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150
            }
          })
        }
      }
    };

    mockMongoService = {
      recordTokenUsage: jest.fn().mockResolvedValue(true),
      getConversationStatus: jest.fn().mockResolvedValue({ exists: false }),
      getOrCreateConversation: jest.fn().mockResolvedValue({
        conversationId: 'channel123_test-personality',
        channelId: 'channel123',
        personalityId: 'test-personality',
        messages: [],
        status: 'active',
        messageCount: 0,
        totalTokens: 0
      }),
      addMessageToConversation: jest.fn().mockResolvedValue(true),
      isConversationIdle: jest.fn().mockResolvedValue(false),
      expireConversation: jest.fn().mockResolvedValue(true),
      resumeConversation: jest.fn().mockResolvedValue(true),
      resetConversation: jest.fn().mockResolvedValue(true)
    };

    mockConfig = {
      openai: {
        model: 'gpt-4o-mini'
      }
    };

    chatService = new ChatService(mockOpenAIClient, mockConfig, mockMongoService);
  });

  describe('chat - stateless mode (backwards compatibility)', () => {
    const mockUser = {
      id: 'user123',
      username: 'TestUser',
      tag: 'TestUser#1234'
    };

    it('should return a response without channelId (stateless)', async () => {
      const result = await chatService.chat('test-personality', 'Hello!', mockUser);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Test response from personality');
      expect(result.personality.id).toBe('test-personality');
      expect(result.personality.name).toBe('Test Character');
      expect(result.tokens.input).toBe(100);
      expect(result.tokens.output).toBe(50);
    });

    it('should record token usage in stateless mode', async () => {
      await chatService.chat('test-personality', 'Hello!', mockUser);

      expect(mockMongoService.recordTokenUsage).toHaveBeenCalledWith(
        'user123',
        'TestUser#1234',
        100,
        50,
        'chat_test-personality',
        'gpt-4o-mini'
      );
    });

    it('should return error for unknown personality', async () => {
      const result = await chatService.chat('unknown-personality', 'Hello!', mockUser);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown personality');
      expect(result.availablePersonalities).toBeDefined();
    });
  });

  describe('chat - with conversation memory', () => {
    const mockUser = {
      id: 'user123',
      username: 'TestUser',
      tag: 'TestUser#1234'
    };

    it('should use conversation history when channelId provided', async () => {
      mockMongoService.getOrCreateConversation.mockResolvedValue({
        conversationId: 'channel123_test-personality',
        messages: [
          { role: 'user', username: 'OtherUser', content: 'Previous message' },
          { role: 'assistant', content: 'Previous response' }
        ],
        status: 'active',
        messageCount: 2,
        totalTokens: 100
      });

      const result = await chatService.chat('test-personality', 'Hello!', mockUser, 'channel123', 'guild456');

      expect(result.success).toBe(true);
      // Verify messages array was built with history
      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }),
            expect.objectContaining({ role: 'user', content: '[OtherUser]: Previous message' }),
            expect.objectContaining({ role: 'assistant', content: 'Previous response' }),
            expect.objectContaining({ role: 'user', content: '[TestUser]: Hello!' })
          ])
        })
      );
    });

    it('should store messages in conversation', async () => {
      await chatService.chat('test-personality', 'Hello!', mockUser, 'channel123', 'guild456');

      // User message stored
      expect(mockMongoService.addMessageToConversation).toHaveBeenCalledWith(
        'channel123',
        'test-personality',
        'user',
        'Hello!',
        'user123',
        'TestUser',
        expect.any(Number)
      );

      // Assistant message stored
      expect(mockMongoService.addMessageToConversation).toHaveBeenCalledWith(
        'channel123',
        'test-personality',
        'assistant',
        'Test response from personality',
        null,
        null,
        50
      );
    });

    it('should return conversation stats', async () => {
      const result = await chatService.chat('test-personality', 'Hello!', mockUser, 'channel123', 'guild456');

      expect(result.success).toBe(true);
      expect(result.conversation).toBeDefined();
      expect(result.conversation.messageCount).toBe(2); // 0 + 2 new messages
    });
  });

  describe('chat - limit enforcement', () => {
    const mockUser = { id: 'user123', username: 'TestUser' };

    it('should block chat when conversation is expired', async () => {
      mockMongoService.getConversationStatus.mockResolvedValue({
        exists: true,
        status: 'expired',
        messageCount: 10,
        totalTokens: 1000
      });

      const result = await chatService.chat('test-personality', 'Hello!', mockUser, 'channel123', 'guild456');

      expect(result.success).toBe(false);
      expect(result.reason).toBe('expired');
      expect(result.error).toContain('expired');
    });

    it('should block chat when message limit reached', async () => {
      mockMongoService.getConversationStatus.mockResolvedValue({
        exists: true,
        status: 'active',
        messageCount: 100,
        totalTokens: 50000,
        lastActivity: new Date()
      });

      const result = await chatService.chat('test-personality', 'Hello!', mockUser, 'channel123', 'guild456');

      expect(result.success).toBe(false);
      expect(result.reason).toBe('message_limit');
      expect(result.error).toContain('100 messages');
    });

    it('should block chat when token limit reached', async () => {
      mockMongoService.getConversationStatus.mockResolvedValue({
        exists: true,
        status: 'active',
        messageCount: 50,
        totalTokens: 150000,
        lastActivity: new Date()
      });

      const result = await chatService.chat('test-personality', 'Hello!', mockUser, 'channel123', 'guild456');

      expect(result.success).toBe(false);
      expect(result.reason).toBe('token_limit');
      expect(result.error).toContain('token limit');
    });

    it('should expire idle conversation', async () => {
      mockMongoService.getConversationStatus.mockResolvedValue({
        exists: true,
        status: 'active',
        messageCount: 10,
        totalTokens: 1000,
        lastActivity: new Date()
      });
      mockMongoService.isConversationIdle.mockResolvedValue(true);

      const result = await chatService.chat('test-personality', 'Hello!', mockUser, 'channel123', 'guild456');

      expect(mockMongoService.expireConversation).toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.reason).toBe('expired');
    });
  });

  describe('resumeChat', () => {
    const mockUser = { id: 'user123', username: 'TestUser' };

    it('should resume expired conversation', async () => {
      mockMongoService.getConversationStatus.mockResolvedValueOnce({
        exists: true,
        status: 'expired',
        messageCount: 10,
        totalTokens: 1000
      }).mockResolvedValueOnce({
        exists: false // For the subsequent chat call limit check
      });

      const result = await chatService.resumeChat('test-personality', 'Continue!', mockUser, 'channel123', 'guild456');

      expect(mockMongoService.resumeConversation).toHaveBeenCalledWith('channel123', 'test-personality');
    });

    it('should return error if no conversation exists', async () => {
      mockMongoService.getConversationStatus.mockResolvedValue({ exists: false });

      const result = await chatService.resumeChat('test-personality', 'Continue!', mockUser, 'channel123', 'guild456');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No conversation found');
    });

    it('should return error if conversation is active', async () => {
      mockMongoService.getConversationStatus.mockResolvedValue({
        exists: true,
        status: 'active'
      });

      const result = await chatService.resumeChat('test-personality', 'Continue!', mockUser, 'channel123', 'guild456');

      expect(result.success).toBe(false);
      expect(result.error).toContain('still active');
    });

    it('should return error if conversation was reset', async () => {
      mockMongoService.getConversationStatus.mockResolvedValue({
        exists: true,
        status: 'reset'
      });

      const result = await chatService.resumeChat('test-personality', 'Continue!', mockUser, 'channel123', 'guild456');

      expect(result.success).toBe(false);
      expect(result.error).toContain('reset');
    });
  });

  describe('resetConversation', () => {
    it('should reset existing conversation', async () => {
      mockMongoService.getConversationStatus.mockResolvedValue({
        exists: true,
        status: 'active'
      });

      const result = await chatService.resetConversation('channel123', 'test-personality');

      expect(result.success).toBe(true);
      expect(result.message).toContain('reset');
      expect(mockMongoService.resetConversation).toHaveBeenCalledWith('channel123', 'test-personality');
    });

    it('should return error if no conversation exists', async () => {
      mockMongoService.getConversationStatus.mockResolvedValue({ exists: false });

      const result = await chatService.resetConversation('channel123', 'test-personality');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No conversation found');
    });

    it('should return error for unknown personality', async () => {
      const result = await chatService.resetConversation('channel123', 'unknown-personality');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown personality');
    });
  });

  describe('listPersonalities', () => {
    it('should return list of personalities', () => {
      const list = chatService.listPersonalities();

      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThan(0);
      expect(list[0]).toHaveProperty('id');
      expect(list[0]).toHaveProperty('name');
    });
  });

  describe('getPersonality', () => {
    it('should return personality for valid ID', () => {
      const personality = chatService.getPersonality('test-personality');

      expect(personality).not.toBeNull();
      expect(personality.id).toBe('test-personality');
    });

    it('should return null for invalid ID', () => {
      const personality = chatService.getPersonality('invalid');

      expect(personality).toBeNull();
    });
  });

  describe('personalityExists', () => {
    it('should return true for existing personality', () => {
      expect(chatService.personalityExists('test-personality')).toBe(true);
    });

    it('should return false for non-existent personality', () => {
      expect(chatService.personalityExists('fake')).toBe(false);
    });
  });

  describe('getConversationInfo', () => {
    it('should return conversation info', async () => {
      mockMongoService.getConversationStatus.mockResolvedValue({
        exists: true,
        status: 'active',
        messageCount: 10,
        totalTokens: 500
      });

      const result = await chatService.getConversationInfo('channel123', 'test-personality');

      expect(result.personality).toBeDefined();
      expect(result.personality.id).toBe('test-personality');
      expect(result.exists).toBe(true);
      expect(result.status).toBe('active');
      expect(result.limits).toBeDefined();
    });
  });
});
