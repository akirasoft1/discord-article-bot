// __tests__/services/ImagePromptAnalyzerService.test.js
// TDD tests for ImagePromptAnalyzerService

const ImagePromptAnalyzerService = require('../../services/ImagePromptAnalyzerService');

// Mock the logger
jest.mock('../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

// Mock the tracing module
jest.mock('../../tracing', () => ({
  withSpan: jest.fn((name, attributes, fn) => fn({ setAttribute: jest.fn(), setAttributes: jest.fn() }))
}));

describe('ImagePromptAnalyzerService', () => {
  let service;
  let mockOpenAIClient;
  let mockMongoService;
  let mockConfig;

  beforeEach(() => {
    jest.clearAllMocks();

    mockOpenAIClient = {
      responses: {
        create: jest.fn().mockResolvedValue({
          output_text: JSON.stringify({
            failureType: 'safety_filter',
            analysis: 'The prompt was blocked because it contains potentially unsafe content.',
            suggestions: [
              'Try rephrasing to avoid references to violence',
              'Use more abstract or artistic language'
            ],
            suggestedPrompts: [
              'A dramatic scene with intense lighting and shadows',
              'An abstract representation of conflict through colors'
            ],
            confidence: 0.85
          }),
          usage: { input_tokens: 100, output_tokens: 200 }
        })
      }
    };

    mockMongoService = {
      db: {
        collection: jest.fn().mockReturnValue({
          insertOne: jest.fn().mockResolvedValue({ insertedId: 'analysis-123' }),
          findOne: jest.fn().mockResolvedValue(null)
        })
      }
    };

    mockConfig = {
      openai: {
        model: 'gpt-4o-mini'
      }
    };

    service = new ImagePromptAnalyzerService(mockOpenAIClient, mockConfig, mockMongoService);
  });

  describe('constructor', () => {
    it('should initialize with required dependencies', () => {
      expect(service).toBeDefined();
      expect(service.openaiClient).toBe(mockOpenAIClient);
      expect(service.config).toBe(mockConfig);
      expect(service.mongoService).toBe(mockMongoService);
    });

    it('should work without mongoService', () => {
      const serviceWithoutMongo = new ImagePromptAnalyzerService(mockOpenAIClient, mockConfig, null);
      expect(serviceWithoutMongo).toBeDefined();
      expect(serviceWithoutMongo.mongoService).toBeNull();
    });
  });

  describe('analyzeFailedPrompt', () => {
    it('should analyze a safety-filtered prompt', async () => {
      const result = await service.analyzeFailedPrompt(
        'A violent battle scene with explosions',
        'Your prompt was blocked by safety filters.',
        { type: 'safety', details: { blockReason: 'SAFETY' } }
      );

      expect(result).toHaveProperty('failureType');
      expect(result).toHaveProperty('analysis');
      expect(result).toHaveProperty('suggestedPrompts');
      expect(result).toHaveProperty('confidence');
      expect(Array.isArray(result.suggestedPrompts)).toBe(true);
    });

    it('should call OpenAI with appropriate prompt structure', async () => {
      await service.analyzeFailedPrompt(
        'Test prompt',
        'Test error',
        { type: 'safety' }
      );

      expect(mockOpenAIClient.responses.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: mockConfig.openai.model,
          input: expect.any(String),
          instructions: expect.stringContaining('image generation expert')
        })
      );
    });

    it('should include failure context in analysis request', async () => {
      await service.analyzeFailedPrompt(
        'A person in a professional setting',
        'No image was generated',
        { type: 'no_candidates', textResponse: 'I cannot generate images of real people' }
      );

      const callArgs = mockOpenAIClient.responses.create.mock.calls[0][0];
      expect(callArgs.input).toContain('A person in a professional setting');
      expect(callArgs.input).toContain('No image was generated');
    });

    it('should handle OpenAI API errors gracefully', async () => {
      mockOpenAIClient.responses.create.mockRejectedValue(new Error('API error'));

      const result = await service.analyzeFailedPrompt(
        'Test prompt',
        'Test error',
        { type: 'unknown' }
      );

      expect(result).toHaveProperty('error');
      expect(result.suggestedPrompts).toEqual([]);
    });

    it('should parse JSON response correctly', async () => {
      mockOpenAIClient.responses.create.mockResolvedValue({
        output_text: JSON.stringify({
          failureType: 'rate_limit',
          analysis: 'The request was rate limited.',
          suggestions: ['Wait and try again'],
          suggestedPrompts: ['Same prompt'],
          confidence: 0.95
        }),
        usage: { input_tokens: 50, output_tokens: 100 }
      });

      const result = await service.analyzeFailedPrompt(
        'Any prompt',
        'Rate limit exceeded',
        { type: 'rate_limit' }
      );

      expect(result.failureType).toBe('rate_limit');
      expect(result.confidence).toBe(0.95);
    });

    it('should handle non-JSON response gracefully', async () => {
      mockOpenAIClient.responses.create.mockResolvedValue({
        output_text: 'This is not JSON - the prompt was blocked because...',
        usage: { input_tokens: 50, output_tokens: 100 }
      });

      const result = await service.analyzeFailedPrompt(
        'Test prompt',
        'Error',
        { type: 'safety' }
      );

      // Should extract what it can from plain text
      expect(result).toHaveProperty('analysis');
      expect(result.analysis).toContain('This is not JSON');
    });

    it('should limit suggested prompts to maximum of 3', async () => {
      mockOpenAIClient.responses.create.mockResolvedValue({
        output_text: JSON.stringify({
          failureType: 'safety',
          analysis: 'Analysis text',
          suggestedPrompts: ['Prompt 1', 'Prompt 2', 'Prompt 3', 'Prompt 4', 'Prompt 5'],
          confidence: 0.8
        }),
        usage: { input_tokens: 50, output_tokens: 100 }
      });

      const result = await service.analyzeFailedPrompt('Test', 'Error', { type: 'safety' });

      expect(result.suggestedPrompts.length).toBeLessThanOrEqual(3);
    });
  });

  describe('categorizeFailure', () => {
    it('should categorize safety filter failures', () => {
      expect(service.categorizeFailure('Your prompt was blocked by safety filters.')).toBe('safety');
      expect(service.categorizeFailure('blocked (reason: SAFETY)')).toBe('safety');
    });

    it('should categorize rate limit failures', () => {
      expect(service.categorizeFailure('Rate limit exceeded')).toBe('rate_limit');
      expect(service.categorizeFailure('Too many requests')).toBe('rate_limit');
    });

    it('should categorize no candidates failures', () => {
      expect(service.categorizeFailure('No image was generated')).toBe('no_candidates');
      expect(service.categorizeFailure('empty candidates')).toBe('no_candidates');
    });

    it('should categorize text response failures', () => {
      expect(service.categorizeFailure('Model returned text instead of image')).toBe('text_response');
    });

    it('should return unknown for unrecognized failures', () => {
      expect(service.categorizeFailure('Some random error')).toBe('unknown');
    });
  });

  describe('recordFailureAnalysis', () => {
    it('should store analysis in MongoDB', async () => {
      const mockCollection = mockMongoService.db.collection();

      await service.recordFailureAnalysis(
        'Original prompt',
        {
          failureType: 'safety',
          analysis: 'Safety issue',
          suggestedPrompts: ['Better prompt'],
          confidence: 0.9
        },
        'user123',
        'channel456'
      );

      expect(mockCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          originalPrompt: 'Original prompt',
          failureType: 'safety',
          userId: 'user123',
          channelId: 'channel456'
        })
      );
    });

    it('should return success result', async () => {
      const result = await service.recordFailureAnalysis(
        'Original prompt',
        { failureType: 'safety', analysis: 'Test', suggestedPrompts: [], confidence: 0.9 },
        'user123',
        'channel456'
      );

      expect(result.success).toBe(true);
      expect(result.id).toBe('analysis-123');
    });

    it('should handle MongoDB errors gracefully', async () => {
      mockMongoService.db.collection().insertOne.mockRejectedValue(new Error('DB error'));

      const result = await service.recordFailureAnalysis(
        'Original prompt',
        { failureType: 'safety', analysis: 'Test', suggestedPrompts: [], confidence: 0.9 },
        'user123',
        'channel456'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('DB error');
    });

    it('should handle missing mongoService gracefully', async () => {
      const serviceWithoutMongo = new ImagePromptAnalyzerService(mockOpenAIClient, mockConfig, null);

      const result = await serviceWithoutMongo.recordFailureAnalysis(
        'Original prompt',
        { failureType: 'safety', analysis: 'Test', suggestedPrompts: [], confidence: 0.9 },
        'user123',
        'channel456'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('MongoDB not available');
    });

    it('should include timestamp in stored document', async () => {
      const mockCollection = mockMongoService.db.collection();
      const beforeTime = new Date();

      await service.recordFailureAnalysis(
        'Original prompt',
        { failureType: 'safety', analysis: 'Test', suggestedPrompts: [], confidence: 0.9 },
        'user123',
        'channel456'
      );

      const insertedDoc = mockCollection.insertOne.mock.calls[0][0];
      expect(insertedDoc.timestamp).toBeDefined();
      expect(new Date(insertedDoc.timestamp) >= beforeTime).toBe(true);
    });
  });

  describe('updateRetryAttempt', () => {
    it('should update analysis record with retry information', async () => {
      const mockCollection = mockMongoService.db.collection();
      mockCollection.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });

      await service.updateRetryAttempt('analysis-123', 'Improved prompt', true);

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: 'analysis-123' },
        expect.objectContaining({
          $set: expect.objectContaining({
            retryAttempted: true,
            retryPrompt: 'Improved prompt',
            retrySuccess: true
          })
        })
      );
    });

    it('should handle update errors gracefully', async () => {
      const mockCollection = mockMongoService.db.collection();
      mockCollection.updateOne = jest.fn().mockRejectedValue(new Error('Update failed'));

      const result = await service.updateRetryAttempt('analysis-123', 'Prompt', false);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Update failed');
    });

    it('should handle missing mongoService', async () => {
      const serviceWithoutMongo = new ImagePromptAnalyzerService(mockOpenAIClient, mockConfig, null);

      const result = await serviceWithoutMongo.updateRetryAttempt('analysis-123', 'Prompt', true);

      expect(result.success).toBe(false);
    });
  });

  describe('formatAnalysisForEmbed', () => {
    it('should format analysis for Discord embed', () => {
      const analysis = {
        failureType: 'safety',
        analysis: 'Your prompt was blocked due to safety concerns.',
        suggestedPrompts: [
          'A serene landscape with soft lighting',
          'An abstract art piece with bold colors'
        ],
        confidence: 0.85
      };

      const formatted = service.formatAnalysisForEmbed(analysis);

      expect(formatted).toHaveProperty('title');
      expect(formatted).toHaveProperty('description');
      expect(formatted).toHaveProperty('fields');
      expect(formatted.fields.length).toBeGreaterThan(0);
    });

    it('should include suggested prompts as numbered options', () => {
      const analysis = {
        failureType: 'safety',
        analysis: 'Analysis text',
        suggestedPrompts: ['Option A', 'Option B'],
        confidence: 0.9
      };

      const formatted = service.formatAnalysisForEmbed(analysis);
      const suggestionsField = formatted.fields.find(f => f.name.includes('Suggested Prompts'));

      expect(suggestionsField).toBeDefined();
      expect(suggestionsField.value).toContain('1️⃣');
      expect(suggestionsField.value).toContain('Option A');
    });

    it('should handle empty suggestions gracefully', () => {
      const analysis = {
        failureType: 'unknown',
        analysis: 'Could not determine cause',
        suggestedPrompts: [],
        confidence: 0.3
      };

      const formatted = service.formatAnalysisForEmbed(analysis);

      expect(formatted).toBeDefined();
      expect(formatted.title).toBeDefined();
    });

    it('should use appropriate color based on failure type', () => {
      const safetyAnalysis = {
        failureType: 'safety',
        analysis: 'Safety block',
        suggestedPrompts: [],
        confidence: 0.9
      };

      const rateLimitAnalysis = {
        failureType: 'rate_limit',
        analysis: 'Rate limited',
        suggestedPrompts: [],
        confidence: 0.9
      };

      const safetyFormatted = service.formatAnalysisForEmbed(safetyAnalysis);
      const rateLimitFormatted = service.formatAnalysisForEmbed(rateLimitAnalysis);

      // Safety should have red/warning color, rate limit should have different color
      expect(safetyFormatted.color).toBeDefined();
      expect(rateLimitFormatted.color).toBeDefined();
    });
  });

  describe('isEnabled', () => {
    it('should return true when service is properly initialized', () => {
      expect(service.isEnabled()).toBe(true);
    });
  });
});
