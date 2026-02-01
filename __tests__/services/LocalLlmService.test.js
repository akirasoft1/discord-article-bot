// __tests__/services/LocalLlmService.test.js

// Mock the logger before requiring the service
jest.mock('../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

// Mock the tracing module
jest.mock('../../tracing', () => ({
  withSpan: jest.fn((name, attrs, fn) => fn({ setAttributes: jest.fn() }))
}));

// Mock the config module
jest.mock('../../config/config', () => ({
  localLlm: {
    enabled: true,
    baseUrl: 'http://localhost:11434/v1',
    model: 'dolphin-llama3:8b-v2.9-fp16',
    apiKey: 'ollama',
    temperature: 0.8,
    topP: 0.95,
    maxTokens: 2048,
    uncensored: {
      enabled: true,
      allowedChannels: [],
      blockedChannels: [],
      allowedUsers: [],
      requireNsfw: false
    }
  }
}));

// Mock OpenAI client
const mockCreate = jest.fn();
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate
      }
    }
  }));
});

// Mock fetch for health check
global.fetch = jest.fn();

describe('LocalLlmService', () => {
  let localLlmService;
  let config;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset the module to get a fresh instance
    jest.resetModules();

    // Re-mock config for each test
    jest.doMock('../../config/config', () => ({
      localLlm: {
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        model: 'dolphin-llama3:8b-v2.9-fp16',
        apiKey: 'ollama',
        temperature: 0.8,
        topP: 0.95,
        maxTokens: 2048,
        uncensored: {
          enabled: true,
          allowedChannels: [],
          blockedChannels: [],
          allowedUsers: [],
          requireNsfw: false
        }
      }
    }));

    config = require('../../config/config');
    localLlmService = require('../../services/LocalLlmService');
  });

  describe('initialize', () => {
    it('should initialize successfully when Ollama is available', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          models: [{ name: 'dolphin-llama3:8b-v2.9-fp16' }]
        })
      });

      const result = await localLlmService.initialize();

      expect(result).toBe(true);
      expect(localLlmService.initialized).toBe(true);
    });

    it('should return false when disabled', async () => {
      jest.resetModules();
      jest.doMock('../../config/config', () => ({
        localLlm: {
          enabled: false,
          baseUrl: 'http://localhost:11434/v1',
          model: 'dolphin-llama3:8b-v2.9-fp16',
          apiKey: 'ollama',
          uncensored: { enabled: false }
        }
      }));

      const disabledService = require('../../services/LocalLlmService');
      const result = await disabledService.initialize();

      expect(result).toBe(false);
    });

    it('should return false when health check fails', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await localLlmService.initialize();

      expect(result).toBe(false);
      expect(localLlmService.initialized).toBe(false);
    });
  });

  describe('healthCheck', () => {
    it('should return true when Ollama responds with model list', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          models: [{ name: 'dolphin-llama3:8b-v2.9-fp16' }]
        })
      });

      const result = await localLlmService.healthCheck();

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('should throw when Ollama returns non-200 status', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('Server error details')
      });

      await expect(localLlmService.healthCheck()).rejects.toThrow('HTTP 500');
    });
  });

  describe('isAvailable', () => {
    it('should return true when initialized and enabled', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ models: [] })
      });

      await localLlmService.initialize();

      expect(localLlmService.isAvailable()).toBe(true);
    });

    it('should return false when not initialized', () => {
      expect(localLlmService.isAvailable()).toBe(false);
    });
  });

  describe('isEnabled', () => {
    it('should return true when available and uncensored mode enabled', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ models: [] })
      });

      await localLlmService.initialize();

      expect(localLlmService.isEnabled()).toBe(true);
    });
  });

  describe('checkUncensoredAccess', () => {
    beforeEach(async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ models: [] })
      });
      await localLlmService.initialize();
    });

    it('should allow access when no restrictions configured', () => {
      const result = localLlmService.checkUncensoredAccess('channel123', 'user456', false);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeNull();
    });

    it('should deny access when uncensored mode disabled globally', () => {
      jest.resetModules();
      jest.doMock('../../config/config', () => ({
        localLlm: {
          enabled: true,
          baseUrl: 'http://localhost:11434/v1',
          uncensored: {
            enabled: false,
            allowedChannels: [],
            blockedChannels: [],
            allowedUsers: [],
            requireNsfw: false
          }
        }
      }));

      const service = require('../../services/LocalLlmService');
      const result = service.checkUncensoredAccess('channel123', 'user456', false);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('disabled by administrator');
    });

    it('should deny access when channel is blocked', () => {
      jest.resetModules();
      jest.doMock('../../config/config', () => ({
        localLlm: {
          enabled: true,
          baseUrl: 'http://localhost:11434/v1',
          uncensored: {
            enabled: true,
            allowedChannels: [],
            blockedChannels: ['blocked-channel'],
            allowedUsers: [],
            requireNsfw: false
          }
        }
      }));

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ models: [] })
      });

      const service = require('../../services/LocalLlmService');
      service.initialized = true;

      const result = service.checkUncensoredAccess('blocked-channel', 'user456', false);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not available in this channel');
    });

    it('should deny access when user not in allowed list', () => {
      jest.resetModules();
      jest.doMock('../../config/config', () => ({
        localLlm: {
          enabled: true,
          baseUrl: 'http://localhost:11434/v1',
          uncensored: {
            enabled: true,
            allowedChannels: [],
            blockedChannels: [],
            allowedUsers: ['allowed-user'],
            requireNsfw: false
          }
        }
      }));

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ models: [] })
      });

      const service = require('../../services/LocalLlmService');
      service.initialized = true;

      const result = service.checkUncensoredAccess('channel123', 'other-user', false);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('do not have permission');
    });

    it('should deny access when NSFW required but channel is not NSFW', () => {
      jest.resetModules();
      jest.doMock('../../config/config', () => ({
        localLlm: {
          enabled: true,
          baseUrl: 'http://localhost:11434/v1',
          uncensored: {
            enabled: true,
            allowedChannels: [],
            blockedChannels: [],
            allowedUsers: [],
            requireNsfw: true
          }
        }
      }));

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ models: [] })
      });

      const service = require('../../services/LocalLlmService');
      service.initialized = true;

      const result = service.checkUncensoredAccess('channel123', 'user456', false);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('NSFW channels');
    });

    it('should allow access when NSFW required and channel is NSFW', () => {
      jest.resetModules();
      jest.doMock('../../config/config', () => ({
        localLlm: {
          enabled: true,
          baseUrl: 'http://localhost:11434/v1',
          uncensored: {
            enabled: true,
            allowedChannels: [],
            blockedChannels: [],
            allowedUsers: [],
            requireNsfw: true
          }
        }
      }));

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ models: [] })
      });

      const service = require('../../services/LocalLlmService');
      service.initialized = true;

      const result = service.checkUncensoredAccess('channel123', 'user456', true);

      expect(result.allowed).toBe(true);
    });
  });

  describe('generateCompletion', () => {
    beforeEach(async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ models: [] })
      });
      await localLlmService.initialize();
    });

    it('should generate a completion successfully', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: { content: 'Test response from local LLM' }
        }]
      });

      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' }
      ];

      const result = await localLlmService.generateCompletion(messages);

      expect(result).toBe('Test response from local LLM');
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        model: 'dolphin-llama3:8b-v2.9-fp16',
        messages,
        temperature: 0.8,
        top_p: 0.95,
        max_tokens: 2048
      }));
    });

    it('should throw error when not available', async () => {
      localLlmService.initialized = false;

      await expect(
        localLlmService.generateCompletion([{ role: 'user', content: 'test' }])
      ).rejects.toThrow('not available');
    });

    it('should throw error when response is empty', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: { content: '' }
        }]
      });

      await expect(
        localLlmService.generateCompletion([{ role: 'user', content: 'test' }])
      ).rejects.toThrow('Empty response');
    });

    it('should use custom options when provided', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{
          message: { content: 'Custom response' }
        }]
      });

      await localLlmService.generateCompletion(
        [{ role: 'user', content: 'test' }],
        { temperature: 0.5, maxTokens: 1000 }
      );

      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        temperature: 0.5,
        max_tokens: 1000
      }));
    });
  });
});
