const CostService = require('../../services/CostService');

describe('CostService.recordMediaGen', () => {
  let svc;
  beforeEach(() => {
    svc = new CostService();
  });

  test('records a known model and updates cumulative.media', () => {
    const result = svc.recordMediaGen('lyria-3-pro-preview', { id: 'u1', tag: 'alice' });
    expect(result.success).toBe(true);
    expect(result.cost).toBeCloseTo(0.06, 5);
    expect(svc.cumulative.media.total).toBeCloseTo(0.06, 5);
    expect(svc.cumulative.media.calls).toBe(1);
    expect(svc.cumulative.media.byModel['lyria-3-pro-preview']).toBeCloseTo(0.06, 5);
    expect(result.modelKey).toBe('lyria-3-pro-preview');
  });

  test('multiple records accumulate', () => {
    svc.recordMediaGen('lyria-3-pro-preview', { id: 'u1' });
    svc.recordMediaGen('lyria-3-pro-preview', { id: 'u2' });
    expect(svc.cumulative.media.total).toBeCloseTo(0.12, 5);
    expect(svc.cumulative.media.calls).toBe(2);
  });

  test('unknown model returns success:false and does not update cumulative', () => {
    const result = svc.recordMediaGen('not-a-real-model', { id: 'u1' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unknown model/i);
    expect(svc.cumulative.media.total).toBe(0);
    expect(svc.cumulative.media.calls).toBe(0);
  });

  test('null user is tolerated', () => {
    const result = svc.recordMediaGen('lyria-3-pro-preview', null);
    expect(result.success).toBe(true);
    expect(svc.cumulative.media.calls).toBe(1);
  });

  test('byModel accumulates per model independently', () => {
    // Add a second model to the pricing map for the duration of this test
    svc.mediaPricing['fake-model-x'] = 0.10;
    svc.recordMediaGen('lyria-3-pro-preview', { id: 'u1' });
    svc.recordMediaGen('fake-model-x', { id: 'u1' });
    svc.recordMediaGen('lyria-3-pro-preview', { id: 'u2' });

    expect(svc.cumulative.media.calls).toBe(3);
    expect(svc.cumulative.media.total).toBeCloseTo(0.22, 5);
    expect(svc.cumulative.media.byModel['lyria-3-pro-preview']).toBeCloseTo(0.12, 5);
    expect(svc.cumulative.media.byModel['fake-model-x']).toBeCloseTo(0.10, 5);
  });
});
