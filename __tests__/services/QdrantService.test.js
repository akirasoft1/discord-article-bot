// __tests__/services/QdrantService.test.js

const QdrantService = require('../../services/QdrantService');

// Mock the Qdrant client
jest.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: jest.fn().mockImplementation(() => ({
    search: jest.fn(),
    scroll: jest.fn(),
    getCollection: jest.fn(),
  }))
}));

// Mock OpenAI client
const mockOpenAI = {
  embeddings: {
    create: jest.fn()
  }
};

describe('QdrantService', () => {
  let service;
  let mockQdrantClient;

  beforeEach(() => {
    jest.clearAllMocks();

    const config = {
      qdrant: {
        host: 'localhost',
        port: 6333,
        collection: 'irc_history'
      }
    };

    service = new QdrantService(mockOpenAI, config);
    mockQdrantClient = service.client;
  });

  describe('constructor', () => {
    it('should initialize with config', () => {
      expect(service.collection).toBe('irc_history');
      expect(service.openai).toBe(mockOpenAI);
    });

    it('should use default collection name if not provided', () => {
      const serviceNoCollection = new QdrantService(mockOpenAI, { qdrant: { host: 'localhost' } });
      expect(serviceNoCollection.collection).toBe('irc_history');
    });
  });

  describe('getEmbedding', () => {
    it('should generate embedding for text', async () => {
      mockOpenAI.embeddings.create.mockResolvedValue({
        data: [{ embedding: [0.1, 0.2, 0.3] }]
      });

      const embedding = await service.getEmbedding('test query');

      expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'test query'
      });
      expect(embedding).toEqual([0.1, 0.2, 0.3]);
    });
  });

  describe('search', () => {
    it('should perform semantic search', async () => {
      mockOpenAI.embeddings.create.mockResolvedValue({
        data: [{ embedding: [0.1, 0.2, 0.3] }]
      });

      mockQdrantClient.search.mockResolvedValue([
        {
          id: 1,
          score: 0.95,
          payload: {
            text: 'Akira1: hello world\nod: hey there',
            participants: ['Akira1', 'od'],
            year: 2005,
            channel: '#cars'
          }
        }
      ]);

      const results = await service.search('hello world');

      expect(mockQdrantClient.search).toHaveBeenCalledWith('irc_history', expect.objectContaining({
        vector: [0.1, 0.2, 0.3],
        limit: 5
      }));
      expect(results).toHaveLength(1);
      expect(results[0].payload.text).toContain('hello world');
    });

    it('should filter by participants', async () => {
      mockOpenAI.embeddings.create.mockResolvedValue({
        data: [{ embedding: [0.1, 0.2, 0.3] }]
      });
      mockQdrantClient.search.mockResolvedValue([]);

      await service.search('test', { participants: ['Akira1', 'od'] });

      expect(mockQdrantClient.search).toHaveBeenCalledWith('irc_history', expect.objectContaining({
        filter: expect.objectContaining({
          should: expect.arrayContaining([
            { key: 'participants', match: { value: 'Akira1' } },
            { key: 'participants', match: { value: 'od' } }
          ])
        })
      }));
    });

    it('should filter by year', async () => {
      mockOpenAI.embeddings.create.mockResolvedValue({
        data: [{ embedding: [0.1, 0.2, 0.3] }]
      });
      mockQdrantClient.search.mockResolvedValue([]);

      await service.search('test', { year: 2005 });

      expect(mockQdrantClient.search).toHaveBeenCalledWith('irc_history', expect.objectContaining({
        filter: expect.objectContaining({
          must: expect.arrayContaining([
            { key: 'year', match: { value: 2005 } }
          ])
        })
      }));
    });
  });

  describe('getRandomFromDate', () => {
    it('should get random conversations from a specific month/day', async () => {
      mockQdrantClient.scroll.mockResolvedValue({
        points: [
          { id: 1, payload: { text: 'convo 1', year: 2003 } },
          { id: 2, payload: { text: 'convo 2', year: 2005 } }
        ]
      });

      const result = await service.getRandomFromDate(12, 16); // Dec 16

      expect(mockQdrantClient.scroll).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should return null if no conversations found', async () => {
      mockQdrantClient.scroll.mockResolvedValue({ points: [] });

      const result = await service.getRandomFromDate(12, 16);

      expect(result).toBeNull();
    });
  });

  describe('getByParticipants', () => {
    it('should get conversations involving specific participants', async () => {
      mockQdrantClient.scroll.mockResolvedValue({
        points: [
          { id: 1, payload: { text: 'test', participants: ['Akira1', 'vise'] } }
        ]
      });

      const results = await service.getByParticipants(['Akira1', 'vise']);

      expect(mockQdrantClient.scroll).toHaveBeenCalledWith('irc_history', expect.objectContaining({
        filter: expect.objectContaining({
          should: expect.arrayContaining([
            { key: 'participants', match: { value: 'Akira1' } },
            { key: 'participants', match: { value: 'vise' } }
          ])
        })
      }));
      expect(results).toHaveLength(1);
    });
  });

  describe('formatResult', () => {
    it('should format a search result for display', () => {
      const result = {
        score: 0.95,
        payload: {
          text: 'Akira1: hello world\nod: hey there',
          participants: ['Akira1', 'od'],
          year: 2005,
          channel: '#cars',
          start_time: '2005-12-16T14:30:00'
        }
      };

      const formatted = service.formatResult(result);

      expect(formatted).toContain('2005');
      expect(formatted).toContain('Akira1');
      expect(formatted).toContain('hello world');
    });

    it('should truncate long text', () => {
      const longText = 'a'.repeat(1000);
      const result = {
        score: 0.9,
        payload: {
          text: longText,
          participants: ['test'],
          year: 2005
        }
      };

      const formatted = service.formatResult(result, { maxLength: 200 });

      expect(formatted.length).toBeLessThan(longText.length);
    });
  });
});
