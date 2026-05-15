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

describe('LyriaService.generateMusic - happy path', () => {
  let svc;
  let generateContent;
  let costService;

  beforeEach(() => {
    GoogleGenAI.mockReset();
    generateContent = jest.fn().mockResolvedValue({
      candidates: [{
        content: {
          parts: [
            { inlineData: { mimeType: 'audio/mpeg', data: Buffer.from('FAKE_MP3').toString('base64') } }
          ]
        }
      }]
    });
    GoogleGenAI.mockImplementation(() => ({ models: { generateContent } }));
    costService = { recordMediaGen: jest.fn().mockReturnValue({ success: true, cost: 0.06 }) };
    svc = new LyriaService(makeConfig(), costService);
  });

  test('returns audio buffer on success and records cost', async () => {
    const result = await svc.generateMusic('upbeat lo-fi', {}, { id: 'u1', tag: 'alice' });

    expect(result.success).toBe(true);
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.toString()).toBe('FAKE_MP3');
    expect(result.mimeType).toBe('audio/mpeg');
    expect(costService.recordMediaGen).toHaveBeenCalledWith('lyria-3-pro-preview', { id: 'u1', tag: 'alice' });
  });

  test('passes prompt as the first content part', async () => {
    await svc.generateMusic('a slow piano ballad', {}, { id: 'u1' });

    expect(generateContent).toHaveBeenCalledTimes(1);
    const call = generateContent.mock.calls[0][0];
    expect(call.model).toBe('lyria-3-pro-preview');
    expect(call.contents).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('a slow piano ballad') })])
    );
  });

  test('returns success:false when service is disabled', async () => {
    const disabled = new LyriaService(makeConfig({ enabled: false }), costService);
    const result = await disabled.generateMusic('foo', {}, { id: 'u1' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not enabled/i);
    expect(costService.recordMediaGen).not.toHaveBeenCalled();
  });
});

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
