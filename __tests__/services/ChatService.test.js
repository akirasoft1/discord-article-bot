// __tests__/services/ChatService.test.js
const ChatService = require('../../services/ChatService');

// Mock the logger
jest.mock('../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
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
      recordTokenUsage: jest.fn().mockResolvedValue(true)
    };

    mockConfig = {
      openai: {
        model: 'gpt-4o-mini'
      }
    };

    chatService = new ChatService(mockOpenAIClient, mockConfig, mockMongoService);
  });

  describe('chat', () => {
    const mockUser = {
      id: 'user123',
      username: 'TestUser',
      tag: 'TestUser#1234'
    };

    it('should return a response from a valid personality', async () => {
      const result = await chatService.chat('test-personality', 'Hello!', mockUser);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Test response from personality');
      expect(result.personality.id).toBe('test-personality');
      expect(result.personality.name).toBe('Test Character');
      expect(result.tokens.input).toBe(100);
      expect(result.tokens.output).toBe(50);
    });

    it('should record token usage', async () => {
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

    it('should handle API errors gracefully', async () => {
      mockOpenAIClient.chat.completions.create.mockRejectedValue(new Error('API Error'));

      const result = await chatService.chat('test-personality', 'Hello!', mockUser);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to generate response');
    });

    it('should use user.username as fallback when tag is not available', async () => {
      const userWithoutTag = { id: 'user456', username: 'NoTagUser' };
      await chatService.chat('test-personality', 'Hello!', userWithoutTag);

      expect(mockMongoService.recordTokenUsage).toHaveBeenCalledWith(
        'user456',
        'NoTagUser',
        100,
        50,
        'chat_test-personality',
        'gpt-4o-mini'
      );
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
});
