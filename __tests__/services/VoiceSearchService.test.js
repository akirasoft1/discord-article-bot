// __tests__/services/VoiceSearchService.test.js

jest.mock('../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

const VoiceSearchService = require('../../services/VoiceSearchService');

describe('VoiceSearchService', () => {
  let service;
  let mockQdrantService;
  let mockVoiceProfileService;
  let mockOpenAIClient;
  let mockConfig;

  beforeEach(() => {
    jest.clearAllMocks();

    mockQdrantService = {
      search: jest.fn().mockResolvedValue([
        { id: 1, score: 0.85, payload: { text: 'Akira: k8s is down again\nod: not again', participants: ['Akira', 'od'], channel: '#ops', year: 2019, start_time: '2019-03-15T02:00:00' } },
        { id: 2, score: 0.72, payload: { text: 'od: rolled back the config\nAkira: prod is back', participants: ['od', 'Akira'], channel: '#ops', year: 2019, start_time: '2019-03-15T03:00:00' } }
      ])
    };

    mockVoiceProfileService = {
      getProfile: jest.fn().mockResolvedValue({
        voiceInstructions: 'Be casual and direct. Use lowercase.',
        vocabulary: ['k8s', 'kube', 'prod', 'nah', 'lmao'],
        toneKeywords: ['casual', 'sardonic']
      })
    };

    mockOpenAIClient = {
      responses: {
        create: jest.fn().mockResolvedValue({
          output_text: '["k8s outage", "kubernetes went down", "kube crash"]',
          usage: { input_tokens: 200, output_tokens: 30 }
        })
      }
    };

    mockConfig = {
      openai: { model: 'gpt-4.1-mini' }
    };

    service = new VoiceSearchService(
      mockQdrantService, mockVoiceProfileService, mockOpenAIClient, mockConfig
    );
  });

  describe('expandQuery', () => {
    it('should return expanded queries from LLM', async () => {
      const result = await service.expandQuery('kubernetes outage');

      expect(result).toContain('k8s outage');
      expect(result).toContain('kubernetes went down');
      expect(mockOpenAIClient.responses.create).toHaveBeenCalled();
    });

    it('should include original query in results', async () => {
      const result = await service.expandQuery('kubernetes outage');

      expect(result).toContain('kubernetes outage');
    });

    it('should include vocabulary from voice profile', async () => {
      await service.expandQuery('kubernetes outage');

      const callArgs = mockOpenAIClient.responses.create.mock.calls[0][0];
      expect(callArgs.input).toContain('k8s');
      expect(callArgs.input).toContain('kube');
    });

    it('should fall back to original query on LLM error', async () => {
      mockOpenAIClient.responses.create.mockRejectedValue(new Error('API Error'));

      const result = await service.expandQuery('kubernetes outage');

      expect(result).toEqual(['kubernetes outage']);
    });

    it('should fall back to original query when no voice profile', async () => {
      mockVoiceProfileService.getProfile.mockResolvedValue(null);

      const result = await service.expandQuery('kubernetes outage');

      // Should still call LLM but without vocabulary context
      expect(result).toContain('kubernetes outage');
    });
  });

  describe('searchWithExpansion', () => {
    it('should search with multiple expanded queries in parallel', async () => {
      const results = await service.searchWithExpansion('kubernetes outage', {});

      // Should have called search multiple times (original + expanded variants)
      expect(mockQdrantService.search.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('should deduplicate results by point ID', async () => {
      // Both queries return the same results
      mockQdrantService.search.mockResolvedValue([
        { id: 1, score: 0.85, payload: { text: 'duplicate result' } }
      ]);

      const results = await service.searchWithExpansion('test query', {});

      // Should deduplicate to 1 result despite 3 queries
      expect(results.length).toBe(1);
    });

    it('should keep the highest score for duplicates', async () => {
      mockQdrantService.search
        .mockResolvedValueOnce([{ id: 1, score: 0.6, payload: { text: 'test' } }])
        .mockResolvedValueOnce([{ id: 1, score: 0.9, payload: { text: 'test' } }])
        .mockResolvedValueOnce([]);

      const results = await service.searchWithExpansion('test', {});

      expect(results[0].score).toBe(0.9);
    });

    it('should pass search options through to qdrant', async () => {
      await service.searchWithExpansion('test', { year: 2019, participants: ['Akira'] });

      const callOptions = mockQdrantService.search.mock.calls[0][1];
      expect(callOptions.year).toBe(2019);
      expect(callOptions.participants).toEqual(['Akira']);
    });
  });

  describe('synthesizeResults', () => {
    const mockResults = [
      { id: 1, score: 0.85, payload: { text: 'Akira: k8s is down\nod: fixing it', channel: '#ops', year: 2019, start_time: '2019-03-15T02:00:00' } },
      { id: 2, score: 0.72, payload: { text: 'od: rolled back\nAkira: we are back', channel: '#ops', year: 2019, start_time: '2019-03-15T03:00:00' } }
    ];

    beforeEach(() => {
      mockOpenAIClient.responses.create.mockResolvedValue({
        output_text: 'yeah that was march 2019, od was on call and Akira was debugging. they rolled back a bad config push around 2am.',
        usage: { input_tokens: 500, output_tokens: 100 }
      });
    });

    it('should synthesize results using voice profile', async () => {
      const summary = await service.synthesizeResults('kubernetes outage', mockResults);

      expect(summary).toContain('march 2019');
      const callArgs = mockOpenAIClient.responses.create.mock.calls[0][0];
      expect(callArgs.instructions).toContain('casual');
    });

    it('should include search results in LLM input', async () => {
      await service.synthesizeResults('kubernetes outage', mockResults);

      const callArgs = mockOpenAIClient.responses.create.mock.calls[0][0];
      expect(callArgs.input).toContain('k8s is down');
      expect(callArgs.input).toContain('rolled back');
    });

    it('should return null on LLM error', async () => {
      mockOpenAIClient.responses.create.mockRejectedValue(new Error('API Error'));

      const summary = await service.synthesizeResults('test', mockResults);

      expect(summary).toBeNull();
    });

    it('should return null for empty results', async () => {
      const summary = await service.synthesizeResults('test', []);

      expect(summary).toBeNull();
      expect(mockOpenAIClient.responses.create).not.toHaveBeenCalled();
    });
  });
});
