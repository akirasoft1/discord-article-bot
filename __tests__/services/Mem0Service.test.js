// __tests__/services/Mem0Service.test.js
// TDD tests for Mem0Service - written before implementation

const Mem0Service = require('../../services/Mem0Service');

// Mock the mem0ai OSS Memory class
jest.mock('mem0ai/oss', () => {
  const mockMemoryInstance = {
    add: jest.fn(),
    search: jest.fn(),
    get: jest.fn(),
    getAll: jest.fn(),
    delete: jest.fn(),
    deleteAll: jest.fn(),
  };

  return {
    Memory: jest.fn().mockImplementation(() => mockMemoryInstance),
    __mockInstance: mockMemoryInstance,
  };
});

// Get mock instance for assertions
const { Memory, __mockInstance: mockMemory } = require('mem0ai/oss');

describe('Mem0Service', () => {
  let mem0Service;
  let mockConfig;

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfig = {
      mem0: {
        enabled: true,
        qdrantHost: 'qdrant.discord-article-bot.svc.cluster.local',
        qdrantPort: 6333,
        collectionName: 'discord_memories',
        openaiApiKey: 'test-openai-key',
        llmModel: 'gpt-4o-mini',
        embeddingModel: 'text-embedding-3-small',
      }
    };
  });

  describe('constructor', () => {
    it('should initialize Memory with correct config', () => {
      mem0Service = new Mem0Service(mockConfig);

      expect(Memory).toHaveBeenCalledWith(expect.objectContaining({
        version: 'v1.1',
        embedder: expect.objectContaining({
          provider: 'openai',
        }),
        vectorStore: expect.objectContaining({
          provider: 'qdrant',
        }),
        llm: expect.objectContaining({
          provider: 'openai',
        }),
      }));
    });

    it('should throw error if mem0 is disabled', () => {
      mockConfig.mem0.enabled = false;
      expect(() => new Mem0Service(mockConfig)).toThrow('Mem0 service is disabled');
    });

    it('should throw error if OpenAI API key is missing', () => {
      mockConfig.mem0.openaiApiKey = null;
      expect(() => new Mem0Service(mockConfig)).toThrow('OpenAI API key is required');
    });
  });

  describe('addMemory', () => {
    beforeEach(() => {
      mem0Service = new Mem0Service(mockConfig);
    });

    it('should add memories from conversation messages', async () => {
      const messages = [
        { role: 'user', content: 'I prefer dark mode' },
        { role: 'assistant', content: 'Got it, dark mode is your preference!' }
      ];
      const userId = '123456789';
      const metadata = { channelId: '987654321', personalityId: 'clair' };

      mockMemory.add.mockResolvedValue({
        results: [{ id: 'mem-1', memory: 'User prefers dark mode' }]
      });

      const result = await mem0Service.addMemory(messages, userId, metadata);

      expect(mockMemory.add).toHaveBeenCalledWith(
        messages,
        expect.objectContaining({
          userId: userId,
          agentId: metadata.personalityId,
          runId: metadata.channelId,
          metadata: expect.any(Object),
        })
      );
      expect(result).toHaveProperty('results');
    });

    it('should handle add memory errors gracefully', async () => {
      mockMemory.add.mockRejectedValue(new Error('API error'));

      const result = await mem0Service.addMemory(
        [{ role: 'user', content: 'test' }],
        'user-123',
        {}
      );

      expect(result).toEqual({ results: [], error: 'API error' });
    });
  });

  describe('searchMemories', () => {
    beforeEach(() => {
      mem0Service = new Mem0Service(mockConfig);
    });

    it('should search memories for a user', async () => {
      const query = 'What editor do they use?';
      const userId = '123456789';

      mockMemory.search.mockResolvedValue({
        results: [
          { id: 'mem-1', memory: 'User prefers vim editor', score: 0.92 },
          { id: 'mem-2', memory: 'User works with Python', score: 0.85 }
        ]
      });

      const result = await mem0Service.searchMemories(query, userId, { limit: 5 });

      expect(mockMemory.search).toHaveBeenCalledWith(
        query,
        expect.objectContaining({
          userId: userId,
          limit: 5,
        })
      );
      expect(result.results).toHaveLength(2);
    });

    it('should filter by personality when provided', async () => {
      mockMemory.search.mockResolvedValue({ results: [] });

      await mem0Service.searchMemories('test query', 'user-123', {
        personalityId: 'clair',
        limit: 3
      });

      expect(mockMemory.search).toHaveBeenCalledWith(
        'test query',
        expect.objectContaining({
          agentId: 'clair',
        })
      );
    });

    it('should return empty results on error', async () => {
      mockMemory.search.mockRejectedValue(new Error('Search failed'));

      const result = await mem0Service.searchMemories('test', 'user-123');

      expect(result).toEqual({ results: [] });
    });
  });

  describe('getUserMemories', () => {
    beforeEach(() => {
      mem0Service = new Mem0Service(mockConfig);
    });

    it('should get all memories for a user', async () => {
      mockMemory.getAll.mockResolvedValue({
        results: [
          { id: 'mem-1', memory: 'Prefers dark mode' },
          { id: 'mem-2', memory: 'Uses vim editor' }
        ]
      });

      const result = await mem0Service.getUserMemories('user-123');

      expect(mockMemory.getAll).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-123' })
      );
      expect(result.results).toHaveLength(2);
    });

    it('should support limit option', async () => {
      mockMemory.getAll.mockResolvedValue({ results: [] });

      await mem0Service.getUserMemories('user-123', { limit: 10 });

      expect(mockMemory.getAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 })
      );
    });
  });

  describe('deleteMemory', () => {
    beforeEach(() => {
      mem0Service = new Mem0Service(mockConfig);
    });

    it('should delete a specific memory', async () => {
      mockMemory.delete.mockResolvedValue({ message: 'Memory deleted' });

      const result = await mem0Service.deleteMemory('mem-123');

      expect(mockMemory.delete).toHaveBeenCalledWith('mem-123');
      expect(result.message).toBe('Memory deleted');
    });
  });

  describe('deleteAllUserMemories', () => {
    beforeEach(() => {
      mem0Service = new Mem0Service(mockConfig);
    });

    it('should delete all memories for a user', async () => {
      mockMemory.deleteAll.mockResolvedValue({ message: 'All memories deleted' });

      const result = await mem0Service.deleteAllUserMemories('user-123');

      expect(mockMemory.deleteAll).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-123' })
      );
      expect(result.message).toBe('All memories deleted');
    });
  });

  describe('formatMemoriesForContext', () => {
    beforeEach(() => {
      mem0Service = new Mem0Service(mockConfig);
    });

    it('should format memories as context string', () => {
      const memories = [
        { id: 'mem-1', memory: 'User prefers dark mode' },
        { id: 'mem-2', memory: 'User is a Python developer' }
      ];

      const context = mem0Service.formatMemoriesForContext(memories);

      expect(context).toContain('User prefers dark mode');
      expect(context).toContain('User is a Python developer');
      expect(context).toContain('Relevant things you remember');
    });

    it('should return empty string for no memories', () => {
      const context = mem0Service.formatMemoriesForContext([]);
      expect(context).toBe('');
    });

    it('should return empty string for null/undefined', () => {
      expect(mem0Service.formatMemoriesForContext(null)).toBe('');
      expect(mem0Service.formatMemoriesForContext(undefined)).toBe('');
    });
  });

  describe('isEnabled', () => {
    it('should return true when service is initialized', () => {
      mem0Service = new Mem0Service(mockConfig);
      expect(mem0Service.isEnabled()).toBe(true);
    });
  });
});
