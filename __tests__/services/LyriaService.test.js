// Mock @google/genai before requiring the service
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: jest.fn() }
  }))
}));

const { GoogleGenAI } = require('@google/genai');
const LyriaService = require('../../services/LyriaService');

function makeConfig(overrides = {}) {
  return {
    lyria: {
      enabled: true,
      apiKey: 'test-key',
      model: 'lyria-3-pro-preview',
      maxImagesPerRequest: 3,
      maxPromptLength: 1000,
      maxLyricsLength: 2000,
      maxNegativePromptLength: 500,
      cooldownSeconds: 60,
      perCallCostUsd: 0.06,
      ...overrides
    }
  };
}

describe('LyriaService constructor', () => {
  beforeEach(() => {
    GoogleGenAI.mockReset();
    // Restore default implementation since mockReset wipes it
    GoogleGenAI.mockImplementation(() => ({
      models: { generateContent: jest.fn() }
    }));
  });

  test('initializes the genai client when enabled', () => {
    const svc = new LyriaService(makeConfig(), { recordMediaGen: jest.fn() });
    expect(svc.isEnabled()).toBe(true);
    expect(GoogleGenAI).toHaveBeenCalledWith({ apiKey: 'test-key' });
  });

  test('is disabled when config.lyria.enabled is false', () => {
    const svc = new LyriaService(makeConfig({ enabled: false }), { recordMediaGen: jest.fn() });
    expect(svc.isEnabled()).toBe(false);
    expect(GoogleGenAI).not.toHaveBeenCalled();
  });

  test('is disabled when apiKey is missing', () => {
    const svc = new LyriaService(makeConfig({ apiKey: '' }), { recordMediaGen: jest.fn() });
    expect(svc.isEnabled()).toBe(false);
    expect(GoogleGenAI).not.toHaveBeenCalled();
  });
});
