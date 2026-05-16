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

describe('ElevenLabsMusicService.generateMusic - prompt mode happy path', () => {
  let svc;
  let composeDetailed;
  let costService;

  beforeEach(() => {
    ElevenLabsClient.mockReset();
    composeDetailed = jest.fn().mockResolvedValue({ audio: Buffer.from('FAKE_MP3') });
    ElevenLabsClient.mockImplementation(() => ({ music: { composeDetailed } }));
    costService = { recordMediaGen: jest.fn().mockReturnValue({ success: true, cost: 0.10 }), mediaPricing: {} };
    svc = new ElevenLabsMusicService(makeConfig(), costService);
  });

  test('returns audio buffer on success and records cost', async () => {
    const result = await svc.generateMusic('upbeat lo-fi', {}, { id: 'u1', tag: 'alice' });
    expect(result.success).toBe(true);
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.toString()).toBe('FAKE_MP3');
    expect(result.mimeType).toBe('audio/mpeg');
    expect(costService.recordMediaGen).toHaveBeenCalledWith('elevenlabs-music-v1', { id: 'u1', tag: 'alice' });
  });

  test('forwards prompt, musicLengthMs, modelId, forceInstrumental (SDK uses camelCase)', async () => {
    await svc.generateMusic('a slow piano ballad', { durationSeconds: 30, instrumental: true }, { id: 'u1' });
    expect(composeDetailed).toHaveBeenCalledTimes(1);
    const call = composeDetailed.mock.calls[0][0];
    expect(call.prompt).toBe('a slow piano ballad');
    expect(call.musicLengthMs).toBe(30000);
    expect(call.modelId).toBe('music_v1');
    expect(call.forceInstrumental).toBe(true);
    expect(call.compositionPlan).toBeUndefined();
  });

  test('defaults durationSeconds to config.elevenlabs.defaultDurationSeconds (90)', async () => {
    await svc.generateMusic('jazz', {}, { id: 'u1' });
    const call = composeDetailed.mock.calls[0][0];
    expect(call.musicLengthMs).toBe(90000);
  });

  test('defaults forceInstrumental to false', async () => {
    await svc.generateMusic('jazz', {}, { id: 'u1' });
    const call = composeDetailed.mock.calls[0][0];
    expect(call.forceInstrumental).toBe(false);
  });

  test('returns success:false when service is disabled', async () => {
    const disabled = new ElevenLabsMusicService(makeConfig({ enabled: false }), costService);
    const result = await disabled.generateMusic('foo', {}, { id: 'u1' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not enabled/i);
    expect(costService.recordMediaGen).not.toHaveBeenCalled();
  });
});
