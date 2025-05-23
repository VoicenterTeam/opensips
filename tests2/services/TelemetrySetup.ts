import { NodeSDK } from '@opentelemetry/sdk-node'
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import {
    PeriodicExportingMetricReader,
    ConsoleMetricExporter,
} from '@opentelemetry/sdk-metrics'
import { metrics, trace, context, Span, SpanStatusCode, Context } from '@opentelemetry/api' // Added Context import
import axios from 'axios'

// Initialize the OpenTelemetry SDK.
// Here we configure exporters for spans and metrics.
// ConsoleSpanExporter and ConsoleMetricExporter output data to the console,
// which is convenient for development and demonstration.
// For a production environment, you would typically use OTLPExporter to send data
// to an OpenTelemetry Collector or directly to a backend.
const sdk = new NodeSDK({
    traceExporter: new ConsoleSpanExporter(), // Exports spans to the console
    metricReader: new PeriodicExportingMetricReader({
        exporter: new ConsoleMetricExporter(), // Exports metrics to the console
        interval: 5000, // Metric export interval (ms)
    }),
    instrumentations: [ getNodeAutoInstrumentations() ], // Automatic instrumentation for Node.js
})

// Start the SDK. This initializes all configurations and begins telemetry collection.
sdk.start()

// Obtain MeterProvider and TracerProvider from the global OpenTelemetry APIs.
// MeterProvider is used to create metrics (counters, histograms, etc.).
// TracerProvider is used to create spans (units of work in tracing).
const meter = metrics.getMeter('event-testing-metrics')
const tracer = trace.getTracer('event-testing')

// Create a counter for tracking the total number of events.
const eventCounter = meter.createCounter('test_events', {
    description: 'Count of events during test scenarios',
})

// Create a histogram for tracking the duration of operations.
// Histograms allow collecting the distribution of values (e.g., duration)
// and calculating percentiles.
const operationDurationHistogram = meter.createHistogram('operation_duration', {
    unit: 'ms', // Units of measurement - milliseconds
    description: 'Duration of operations',
})

// Map to store active spans and their start times.
// This allows us to link spans started at the 'triggered' stage
// with their completions at the 'completed' or 'listener_error' stages.
// We store an object { span: Span, context: Context, startTime: number } for proper context and duration calculation.
const activeSpans = new Map<string, { span: Span; context: Context; startTime: number }>() // Changed context.Context to Context

// Helper function to generate a unique key for each operation/scenario.
function getOperationKey (eventName: string, scenarioId: string | number): string {
    return `${eventName}-${scenarioId}`
}

/**
 * Logs a test event, using OpenTelemetry for tracing and metrics.
 *
 * @param eventName The name of the event (e.g., 'user_login', 'data_processing').
 * @param scenarioId The ID of the scenario to which the event belongs.
 * @param status The status of the event: 'success' or 'failure'.
 * @param additionalAttributes Additional attributes to be added to the span and metrics.
 */
export async function logTestEvent (
    eventName: string,
    scenarioId: string | number,
    status: 'success' | 'failure' = 'success',
    additionalAttributes: Record<string, string> = {}
) {
    const stage = additionalAttributes.stage || 'unknown' // Event stage (e.g., 'triggered', 'completed', 'processing')
    const key = getOperationKey(eventName, scenarioId) // Unique key for this operation
    let currentSpan: Span | undefined // The current span we will use or create
    let spanContext: Context | undefined // Span context (Changed context.Context to Context)

    // Logic for handling different event stages:
    if (stage === 'triggered') {
        // If this is the initial stage ('triggered'), create a new span.
        // This span will be active until the operation completes.
        currentSpan = tracer.startSpan(`event.${eventName}.triggered`, {
            attributes: {
                'event.name': eventName,
                'scenario.id': scenarioId.toString(),
                'event.stage': stage,
                ...additionalAttributes,
            },
        })
        // Set this span as active in the current context.
        spanContext = trace.setSpan(context.active(), currentSpan)
        // Store the span, its context, and the start time in the map for later use.
        activeSpans.set(key, {
            span: currentSpan,
            context: spanContext,
            startTime: Date.now()
        }) // Storing startTime here
    } else if (stage === 'completed' || stage === 'listener_error') {
        // If this is a final stage ('completed' or 'listener_error'),
        // try to retrieve a previously started span.
        const activeSpanEntry = activeSpans.get(key)
        if (activeSpanEntry) {
            currentSpan = activeSpanEntry.span
            spanContext = activeSpanEntry.context
            activeSpans.delete(key) // Remove the completed span from the map

            if (currentSpan) {
                // Set the span status: OK for success, ERROR for failure.
                currentSpan.setStatus({
                    code: status === 'success' ? SpanStatusCode.OK : SpanStatusCode.ERROR,
                    message: status === 'failure' ? `Event ${eventName} failed at stage ${stage}` : undefined,
                })

                // Add additional attributes to the span.
                currentSpan.setAttributes({
                    'event.status': status,
                    ...additionalAttributes,
                })

                // Calculate the operation duration using the stored startTime and record it in the histogram.
                const duration = Date.now() - activeSpanEntry.startTime // Use stored startTime
                operationDurationHistogram.record(duration, {
                    'event.name': eventName,
                    'scenario.id': scenarioId.toString(),
                    'event.status': status,
                    'event.stage': stage,
                    ...additionalAttributes,
                })
                // Also add the duration as a span attribute.
                currentSpan.setAttribute('event.duration_ms', duration)

                // End the span. After this, it will be ready for export.
                currentSpan.end()
            }
        } else {
            // If the span is not found (e.g., if 'triggered' was not called,
            // or the program restarted), create a new "one-off" span.
            // This helps avoid data loss but indicates a potential issue.
            console.warn(`[OpenTelemetry] Span for key ${key} not found. Creating a new one for stage ${stage}.`)
            currentSpan = tracer.startSpan(`event.${eventName}.${stage}`, {
                attributes: {
                    'event.name': eventName,
                    'scenario.id': scenarioId.toString(),
                    'event.stage': stage,
                    'event.status': status,
                    warning: 'Span for completed/error stage started without a preceding triggered stage.',
                    ...additionalAttributes,
                },
            })
            spanContext = trace.setSpan(context.active(), currentSpan)
            // For one-off spans, we calculate duration from its creation to end.
            const duration = Date.now() - currentSpan.startTime // startTime is available on SDK Span implementation
            currentSpan.setAttribute('event.duration_ms', duration)
            operationDurationHistogram.record(duration, {
                'event.name': eventName,
                'scenario.id': scenarioId.toString(),
                'event.status': status,
                'event.stage': stage,
                ...additionalAttributes,
            })
            currentSpan.end()
        }
    } else {
        // For other intermediate stages that are not 'triggered', 'completed', or 'listener_error',
        // we create a short-lived span that ends immediately.
        // This can be useful for tracking very brief sub-operations.
        currentSpan = tracer.startSpan(`event.${eventName}.${stage}`, {
            attributes: {
                'event.name': eventName,
                'scenario.id': scenarioId.toString(),
                'event.stage': stage,
                'event.status': status,
                ...additionalAttributes,
            },
        })
        currentSpan.end()
    }

    // Increment the event counter for all stages.
    eventCounter.add(1, {
        'event.name': eventName,
        'scenario.id': scenarioId.toString(),
        'event.status': status,
        'event.stage': stage,
        ...additionalAttributes,
    })

    // Log the event to the console for immediate feedback.
    console.log(`[OpenTelemetry] Event: ${eventName}, Scenario: ${scenarioId}, Stage: ${stage}, Status: ${status}`)

    // This part of the code is responsible for sending data to your separate visualization server.
    // It remains as it was part of your original request.
    // If you are fully migrating to OpenTelemetry, this block can be removed,
    // and data will be sent via OpenTelemetry exporters.
    try {
        const metricData: Record<string, any> = {
            name: eventName,
            metricType: stage,
            event: eventName,
            scenarioId: scenarioId.toString(),
            status,
            timestamp: new Date().toISOString(),
            ...additionalAttributes,
            displayName: `${eventName} (${stage})`,
            value: 1,
        }
        // If the span had a duration, add it to the data for your server.
        if (currentSpan && currentSpan.attributes['event.duration_ms']) {
            metricData.executionTimeMs = currentSpan.attributes['event.duration_ms']
        }
        await axios.post('http://localhost:8080/collect-metrics', metricData)
    } catch (error: any) {
        console.error('Failed to send metric to visualization server:', error.message)
    }
}
