// __tests__/services/VoiceProfileService.test.js
const VoiceProfileService = require('../../services/VoiceProfileService');

jest.mock('../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

describe('VoiceProfileService', () => {
  let service;
  let mockOpenaiClient;
  let mockConfig;
  let mockMongoService;
  let mockQdrantService;
  let mockChannelContextService;

  const sampleProfile = {
    profileId: 'channel_voice_v1',
    version: 1,
    generatedAt: new Date(),
    voiceInstructions: 'Use casual fragments. Drop periods.',
    vocabulary: ['nah', 'lmao', 'word'],
    avoid: ["I'd be happy to help!"],
    toneKeywords: ['sardonic', 'casual', 'direct'],
    humorStyle: 'Dry deadpan humor',
    intensityLevel: 'high',
    exampleResponses: ['nah that is busted'],
    metadata: { ircSamplesUsed: 200, discordSamplesUsed: 100 }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockOpenaiClient = {
      responses: {
        create: jest.fn().mockResolvedValue({
          output_text: JSON.stringify({
            vocabulary: ['nah', 'lmao'],
            tone: 'sardonic and casual',
            sentence_structure: 'short fragments',
            humor_patterns: 'deadpan, dark',
            interaction_patterns: 'direct callbacks',
            cultural_references: 'tech, gaming',
            profanity: 'moderate',
            quirks: 'drops periods'
          }),
          usage: { input_tokens: 1000, output_tokens: 500 }
        })
      }
    };

    mockConfig = {
      voiceProfile: {
        enabled: true,
        regenIntervalHours: 24,
        samplesPerDecade: 5,
        discordSampleSize: 10,
        analysisModel: 'gpt-4.1-mini',
        abLogging: false
      },
      openai: { model: 'gpt-4.1-mini' }
    };

    mockMongoService = {
      db: {
        collection: jest.fn().mockReturnValue({
          findOne: jest.fn().mockResolvedValue(null),
          updateOne: jest.fn().mockResolvedValue({ upsertedId: 'test-id' }),
          insertOne: jest.fn().mockResolvedValue({ insertedId: 'test-id' })
        })
      }
    };

    // Mock QdrantService with an underlying client
    mockQdrantService = {
      client: {
        scroll: jest.fn().mockResolvedValue({
          points: [
            { payload: { text: 'Nick1: hey whats up\nNick2: not much dude', participants: ['Nick1', 'Nick2'], decade: '2000s' } },
            { payload: { text: 'Nick1: lmao thats wild\nNick3: nah fr', participants: ['Nick1', 'Nick3'], decade: '2000s' } }
          ]
        })
      },
      search: jest.fn().mockResolvedValue([
        { payload: { text: 'Nick1: yo check this out\nNick2: word' }, score: 0.8 }
      ])
    };

    mockChannelContextService = {
      qdrantClient: {
        scroll: jest.fn().mockResolvedValue({
          points: [
            { payload: { content: 'hey has anyone tried that new thing', authorName: 'TestUser' } },
            { payload: { content: 'yeah its pretty solid ngl', authorName: 'OtherUser' } }
          ]
        })
      }
    };

    service = new VoiceProfileService(
      mockOpenaiClient,
      mockConfig,
      mockMongoService,
      mockQdrantService,
      mockChannelContextService
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with correct config', () => {
      expect(service.config).toBe(mockConfig.voiceProfile);
      expect(service._cachedProfile).toBeNull();
    });
  });

  describe('getProfile', () => {
    it('should return cached profile if available', async () => {
      service._cachedProfile = sampleProfile;

      const result = await service.getProfile();

      expect(result).toBe(sampleProfile);
      expect(mockMongoService.db.collection).not.toHaveBeenCalled();
    });

    it('should load from MongoDB if no cache', async () => {
      const collection = mockMongoService.db.collection();
      collection.findOne.mockResolvedValue(sampleProfile);

      const result = await service.getProfile();

      expect(result).toEqual(sampleProfile);
      expect(service._cachedProfile).toEqual(sampleProfile);
    });

    it('should return null if no profile exists', async () => {
      const result = await service.getProfile();

      expect(result).toBeNull();
    });
  });

  describe('_sampleIrcHistory', () => {
    it('should sample from each decade via Qdrant scroll', async () => {
      const samples = await service._sampleIrcHistory();

      // Should call scroll for each decade
      expect(mockQdrantService.client.scroll).toHaveBeenCalledTimes(4);

      // Each call should filter by decade
      const calls = mockQdrantService.client.scroll.mock.calls;
      const decades = calls.map(c => c[1].filter.must[0].match.value);
      expect(decades).toEqual(expect.arrayContaining(['1990s', '2000s', '2010s', '2020s']));
    });

    it('should cap samples per decade', async () => {
      // Config says 5 per decade, mock returns 2
      const samples = await service._sampleIrcHistory();

      // Should have at most 5 * 4 = 20, but mock returns 2 per decade = 8
      expect(samples.length).toBeLessThanOrEqual(20);
    });
  });

  describe('_sampleDiscordMessages', () => {
    it('should scroll channel_conversations collection', async () => {
      const samples = await service._sampleDiscordMessages();

      expect(mockChannelContextService.qdrantClient.scroll).toHaveBeenCalledWith(
        'channel_conversations',
        expect.objectContaining({ with_payload: true })
      );
      expect(samples.length).toBeGreaterThan(0);
    });

    it('should cap at configured sample size', async () => {
      const samples = await service._sampleDiscordMessages();

      expect(samples.length).toBeLessThanOrEqual(mockConfig.voiceProfile.discordSampleSize);
    });
  });

  describe('_analyzeStyleBatch', () => {
    it('should send conversation chunks to LLM for analysis', async () => {
      const chunks = [
        { payload: { text: 'Nick1: hey\nNick2: yo' } },
        { payload: { text: 'Nick1: lmao' } }
      ];

      const result = await service._analyzeStyleBatch(chunks);

      expect(mockOpenaiClient.responses.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4.1-mini',
          instructions: expect.stringContaining('communication style'),
          input: expect.stringContaining('Nick1: hey')
        })
      );
      expect(result).toBeDefined();
    });

    it('should handle non-JSON LLM responses gracefully', async () => {
      mockOpenaiClient.responses.create.mockResolvedValue({
        output_text: 'This is not JSON but a text analysis',
        usage: { input_tokens: 500, output_tokens: 200 }
      });

      const result = await service._analyzeStyleBatch([
        { payload: { text: 'test' } }
      ]);

      // Should return raw text wrapped in an object
      expect(result).toBeDefined();
      expect(result.rawText).toBeDefined();
    });
  });

  describe('_synthesizeProfile', () => {
    it('should merge batch results into a unified profile', async () => {
      const synthesisResponse = JSON.stringify({
        voice_instructions: 'Be casual and direct',
        vocabulary: ['nah', 'word'],
        avoid: ['Great question!'],
        tone_keywords: ['sardonic'],
        example_responses: ['nah thats busted'],
        humor_style: 'Deadpan',
        intensity_level: 'high'
      });

      mockOpenaiClient.responses.create.mockResolvedValue({
        output_text: synthesisResponse,
        usage: { input_tokens: 2000, output_tokens: 500 }
      });

      const batchResults = [
        { vocabulary: ['nah'], tone: 'casual' },
        { vocabulary: ['word'], tone: 'direct' }
      ];

      const profile = await service._synthesizeProfile(batchResults);

      expect(profile.voiceInstructions).toBe('Be casual and direct');
      expect(profile.vocabulary).toEqual(['nah', 'word']);
      expect(profile.toneKeywords).toEqual(['sardonic']);
    });

    it('should include synthesis prompt mentioning merging analyses', async () => {
      const synthesisResponse = JSON.stringify({
        voice_instructions: 'test',
        vocabulary: [],
        avoid: [],
        tone_keywords: [],
        example_responses: [],
        humor_style: 'test',
        intensity_level: 'medium'
      });

      mockOpenaiClient.responses.create.mockResolvedValue({
        output_text: synthesisResponse,
        usage: { input_tokens: 500, output_tokens: 200 }
      });

      await service._synthesizeProfile([{ test: true }]);

      const callArgs = mockOpenaiClient.responses.create.mock.calls[0][0];
      expect(callArgs.instructions).toContain('voice profile');
    });
  });

  describe('_storeProfile', () => {
    it('should upsert profile to MongoDB voice_profiles collection', async () => {
      await service._storeProfile(sampleProfile);

      expect(mockMongoService.db.collection).toHaveBeenCalledWith('voice_profiles');
    });

    it('should cache the stored profile', async () => {
      await service._storeProfile(sampleProfile);

      expect(service._cachedProfile).toBeDefined();
      expect(service._cachedProfile.voiceInstructions).toBe(sampleProfile.voiceInstructions);
    });
  });

  describe('regenerateProfile', () => {
    it('should execute full pipeline: sample, analyze, synthesize, store', async () => {
      const synthesisResponse = JSON.stringify({
        voice_instructions: 'Generated instructions',
        vocabulary: ['test'],
        avoid: [],
        tone_keywords: ['casual'],
        example_responses: ['test response'],
        humor_style: 'dry',
        intensity_level: 'medium'
      });

      // First calls are for batch analysis, last call is for synthesis
      mockOpenaiClient.responses.create
        .mockResolvedValueOnce({
          output_text: JSON.stringify({ vocabulary: ['a'], tone: 'casual' }),
          usage: { input_tokens: 500, output_tokens: 200 }
        })
        .mockResolvedValue({
          output_text: synthesisResponse,
          usage: { input_tokens: 1000, output_tokens: 500 }
        });

      await service.regenerateProfile();

      // Should have sampled from both sources
      expect(mockQdrantService.client.scroll).toHaveBeenCalled();
      expect(mockChannelContextService.qdrantClient.scroll).toHaveBeenCalled();

      // Should have called OpenAI for analysis + synthesis
      expect(mockOpenaiClient.responses.create).toHaveBeenCalled();

      // Should have stored result
      expect(mockMongoService.db.collection).toHaveBeenCalledWith('voice_profiles');
    });

    it('should handle errors gracefully', async () => {
      mockQdrantService.client.scroll.mockRejectedValue(new Error('Qdrant down'));

      // Should not throw
      await expect(service.regenerateProfile()).resolves.not.toThrow();
    });
  });

  describe('start', () => {
    it('should trigger regeneration if no existing profile', async () => {
      const synthesisResponse = JSON.stringify({
        voice_instructions: 'test',
        vocabulary: [],
        avoid: [],
        tone_keywords: [],
        example_responses: [],
        humor_style: 'test',
        intensity_level: 'medium'
      });

      mockOpenaiClient.responses.create.mockResolvedValue({
        output_text: synthesisResponse,
        usage: { input_tokens: 500, output_tokens: 200 }
      });

      await service.start();

      // Should have attempted to load from MongoDB then regenerate
      expect(mockMongoService.db.collection).toHaveBeenCalledWith('voice_profiles');
      expect(mockOpenaiClient.responses.create).toHaveBeenCalled();
    });

    it('should load existing profile from MongoDB without regenerating', async () => {
      const collection = mockMongoService.db.collection();
      collection.findOne.mockResolvedValue(sampleProfile);

      await service.start();

      expect(service._cachedProfile).toEqual(sampleProfile);
      // Should NOT have called OpenAI for analysis (profile already exists)
      expect(mockOpenaiClient.responses.create).not.toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('should clear regeneration interval', async () => {
      const collection = mockMongoService.db.collection();
      collection.findOne.mockResolvedValue(sampleProfile);

      await service.start();
      service.stop();

      expect(service._regenInterval).toBeNull();
    });
  });
});
