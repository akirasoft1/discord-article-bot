// Mock @elevenlabs/elevenlabs-js before requiring the service
jest.mock('@elevenlabs/elevenlabs-js', () => ({
  ElevenLabsClient: jest.fn().mockImplementation(() => ({
    music: { composeDetailed: jest.fn() }
  }))
}));

const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const ElevenLabsMusicService = require('../../services/ElevenLabsMusicService');

function makeConfig(overrides = {}) {
  return {
    elevenlabs: {
      enabled: true,
      apiKey: 'test-key',
      model: 'music_v1',
      defaultDurationSeconds: 90,
      cooldownSeconds: 60,
      perCallCostUsd: 0.10,
      ...overrides
    }
  };
}

describe('ElevenLabsMusicService constructor', () => {
  beforeEach(() => {
    ElevenLabsClient.mockReset();
    ElevenLabsClient.mockImplementation(() => ({
      music: { composeDetailed: jest.fn() }
    }));
  });

  test('initializes the ElevenLabs client when enabled', () => {
    const svc = new ElevenLabsMusicService(makeConfig(), { recordMediaGen: jest.fn(), mediaPricing: {} });
    expect(svc.isEnabled()).toBe(true);
    expect(ElevenLabsClient).toHaveBeenCalledWith({ apiKey: 'test-key' });
  });

  test('is disabled when config.elevenlabs.enabled is false', () => {
    const svc = new ElevenLabsMusicService(makeConfig({ enabled: false }), { recordMediaGen: jest.fn() });
    expect(svc.isEnabled()).toBe(false);
    expect(ElevenLabsClient).not.toHaveBeenCalled();
  });

  test('is disabled when apiKey is missing', () => {
    const svc = new ElevenLabsMusicService(makeConfig({ apiKey: '' }), { recordMediaGen: jest.fn() });
    expect(svc.isEnabled()).toBe(false);
    expect(ElevenLabsClient).not.toHaveBeenCalled();
  });

  test('applies perCallCostUsd override into costService.mediaPricing', () => {
    const costService = { recordMediaGen: jest.fn(), mediaPricing: { 'elevenlabs-music-v1': 0.10 } };
    new ElevenLabsMusicService(makeConfig({ perCallCostUsd: 0.25 }), costService);
    expect(costService.mediaPricing['elevenlabs-music-v1']).toBeCloseTo(0.25, 5);
  });

  test('does not crash when costService has no mediaPricing (defensive)', () => {
    const noPricing = { recordMediaGen: jest.fn() };
    expect(() => new ElevenLabsMusicService(makeConfig({ perCallCostUsd: 0.5 }), noPricing)).not.toThrow();
  });
});
