// __tests__/tracing.test.js

// Mock all OpenTelemetry modules before requiring tracing
const mockStart = jest.fn();
const mockShutdown = jest.fn().mockResolvedValue(undefined);

jest.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: jest.fn().mockImplementation((config) => {
    // Store the config for assertions
    mockNodeSDKConfig = config;
    return { start: mockStart, shutdown: mockShutdown };
  })
}));

jest.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: jest.fn(() => 'mock-auto-instrumentations')
}));

jest.mock('@opentelemetry/exporter-trace-otlp-proto', () => ({
  OTLPTraceExporter: jest.fn().mockImplementation(() => ({}))
}));

jest.mock('@opentelemetry/resources', () => ({
  Resource: jest.fn().mockImplementation((attrs) => ({ attributes: attrs }))
}));

jest.mock('@opentelemetry/semantic-conventions', () => ({
  ATTR_SERVICE_NAME: 'service.name',
  ATTR_SERVICE_VERSION: 'service.version'
}));

jest.mock('@opentelemetry/sdk-trace-base', () => ({
  BatchSpanProcessor: jest.fn().mockImplementation(() => ({}))
}));

const mockGetActiveSpan = jest.fn();
const mockStartActiveSpan = jest.fn();
const mockGetTracer = jest.fn(() => ({
  startActiveSpan: mockStartActiveSpan
}));

jest.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: mockGetTracer,
    getActiveSpan: mockGetActiveSpan
  },
  SpanStatusCode: { OK: 0, ERROR: 2 },
  SpanKind: { INTERNAL: 0, SERVER: 1 },
  context: { with: jest.fn((ctx, fn) => fn()) },
  ROOT_CONTEXT: 'ROOT'
}));

// Mock the OpenLLMetry instrumentation
const mockOpenAIInstrumentation = jest.fn().mockImplementation(() => ({
  instrumentationName: '@traceloop/instrumentation-openai'
}));

jest.mock('@traceloop/instrumentation-openai', () => ({
  OpenAIInstrumentation: mockOpenAIInstrumentation
}));

jest.mock('./package.json', () => ({ version: '1.0.0-test' }), { virtual: true });
// Need to mock from the correct relative path that tracing.js uses
jest.mock('../package.json', () => ({ version: '1.0.0-test' }));

let mockNodeSDKConfig;

describe('tracing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNodeSDKConfig = null;
    // Clear module cache so tracing.js re-executes
    jest.resetModules();
  });

  test('should include OpenAIInstrumentation in the SDK instrumentations', () => {
    // Re-require tracing to trigger module initialization
    require('../tracing');

    // NodeSDK should have been constructed with config
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    expect(NodeSDK).toHaveBeenCalledTimes(1);

    // Verify the instrumentations array includes both auto-instrumentations and OpenAI
    const config = NodeSDK.mock.calls[0][0];
    expect(config.instrumentations).toBeDefined();
    expect(config.instrumentations).toHaveLength(2);

    // First should be auto-instrumentations
    expect(config.instrumentations[0]).toBe('mock-auto-instrumentations');

    // Second should be OpenAIInstrumentation instance
    expect(mockOpenAIInstrumentation).toHaveBeenCalledTimes(1);
    expect(config.instrumentations[1]).toEqual(
      expect.objectContaining({ instrumentationName: '@traceloop/instrumentation-openai' })
    );
  });

  test('should start the SDK on module load', () => {
    require('../tracing');
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  test('should export withSpan and withRootSpan functions', () => {
    const tracing = require('../tracing');
    expect(typeof tracing.withSpan).toBe('function');
    expect(typeof tracing.withRootSpan).toBe('function');
    expect(typeof tracing.addSpanEvent).toBe('function');
    expect(typeof tracing.setSpanAttributes).toBe('function');
  });
});
