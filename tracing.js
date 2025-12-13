// tracing.js - OpenTelemetry initialization for Dynatrace integration
// IMPORTANT: This module must be loaded BEFORE any other application code
// to ensure all HTTP calls and other operations are properly instrumented.

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
const { Resource } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = require('@opentelemetry/semantic-conventions');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { trace, SpanStatusCode, SpanKind, context, ROOT_CONTEXT } = require('@opentelemetry/api');

// Service identification
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'discord-article-bot';
const SERVICE_VERSION = process.env.npm_package_version || '0.92.0';

// Dynatrace OTLP endpoint configuration
// When running with OneAgent, traces are sent to the local OneAgent endpoint
// Otherwise, configure OTEL_EXPORTER_OTLP_ENDPOINT for direct ingest
const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

// Create the OTLP exporter for traces
const traceExporter = new OTLPTraceExporter({
  url: `${OTLP_ENDPOINT}/v1/traces`,
  headers: process.env.OTEL_EXPORTER_OTLP_HEADERS
    ? JSON.parse(process.env.OTEL_EXPORTER_OTLP_HEADERS)
    : {},
});

// Create the OpenTelemetry SDK
const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
    'service.namespace': 'discord-article-bot',
    'deployment.environment': process.env.NODE_ENV || 'development',
  }),
  spanProcessor: new BatchSpanProcessor(traceExporter, {
    // Export spans every 5 seconds or when batch reaches 512 spans
    scheduledDelayMillis: 5000,
    maxExportBatchSize: 512,
    maxQueueSize: 2048,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Enable HTTP instrumentation for Linkwarden and OpenAI calls
      '@opentelemetry/instrumentation-http': {
        enabled: true,
        ignoreIncomingRequestHook: () => true, // We don't have incoming HTTP requests
      },
      // Enable MongoDB instrumentation
      '@opentelemetry/instrumentation-mongodb': {
        enabled: true,
      },
      // Disable instrumentations we don't need
      '@opentelemetry/instrumentation-fs': {
        enabled: false, // Too noisy for file operations
      },
      '@opentelemetry/instrumentation-dns': {
        enabled: false,
      },
    }),
  ],
});

// Start the SDK
let isInitialized = false;

function startTracing() {
  if (isInitialized) {
    return;
  }

  try {
    sdk.start();
    isInitialized = true;
    console.log(`OpenTelemetry tracing initialized for ${SERVICE_NAME} v${SERVICE_VERSION}`);
    console.log(`OTLP endpoint: ${OTLP_ENDPOINT}`);
  } catch (error) {
    console.error('Failed to initialize OpenTelemetry:', error);
  }
}

// Graceful shutdown
async function shutdownTracing() {
  if (!isInitialized) {
    return;
  }

  try {
    await sdk.shutdown();
    console.log('OpenTelemetry tracing shut down successfully');
  } catch (error) {
    console.error('Error shutting down OpenTelemetry:', error);
  }
}

// Register shutdown handlers
process.on('SIGTERM', async () => {
  await shutdownTracing();
});

process.on('SIGINT', async () => {
  await shutdownTracing();
});

// Get a tracer for custom spans
function getTracer(name = 'discord-article-bot') {
  return trace.getTracer(name, SERVICE_VERSION);
}

/**
 * Create a custom span for an operation
 * @param {string} name - Span name
 * @param {Object} attributes - Span attributes
 * @param {Function} fn - Async function to execute within the span
 * @returns {Promise<*>} Result of the function
 */
async function withSpan(name, attributes, fn) {
  const tracer = getTracer();

  return tracer.startActiveSpan(name, {
    kind: SpanKind.INTERNAL,
    attributes,
  }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Create a root span for an entry point (like event handlers)
 * Uses ROOT_CONTEXT to ensure this creates a new trace, not a child of any active context
 * @param {string} name - Span name
 * @param {Object} attributes - Span attributes
 * @param {Function} fn - Async function to execute within the span
 * @returns {Promise<*>} Result of the function
 */
async function withRootSpan(name, attributes, fn) {
  const tracer = getTracer();

  // Use ROOT_CONTEXT to ensure this is truly a root span with a new trace ID
  // This prevents trace context bleeding between unrelated operations
  return context.with(ROOT_CONTEXT, () => {
    return tracer.startActiveSpan(name, {
      kind: SpanKind.SERVER, // Mark as entry point
      attributes: {
        ...attributes,
        'messaging.system': 'discord',
        'messaging.operation': 'process',
      },
    }, async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
        span.recordException(error);
        throw error;
      } finally {
        span.end();
      }
    });
  });
}

/**
 * Add an event to the current active span
 * @param {string} name - Event name
 * @param {Object} attributes - Event attributes
 */
function addSpanEvent(name, attributes = {}) {
  const currentSpan = trace.getActiveSpan();
  if (currentSpan) {
    currentSpan.addEvent(name, attributes);
  }
}

/**
 * Set attributes on the current active span
 * @param {Object} attributes - Attributes to set
 */
function setSpanAttributes(attributes) {
  const currentSpan = trace.getActiveSpan();
  if (currentSpan) {
    currentSpan.setAttributes(attributes);
  }
}

// Start tracing immediately when this module is loaded
startTracing();

module.exports = {
  startTracing,
  shutdownTracing,
  getTracer,
  withSpan,
  withRootSpan,
  addSpanEvent,
  setSpanAttributes,
  SpanStatusCode,
  SpanKind,
};
