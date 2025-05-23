import { NodeSDK } from '@opentelemetry/sdk-node'
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import {
    PeriodicExportingMetricReader,
    ConsoleMetricExporter,
} from '@opentelemetry/sdk-metrics'
import { metrics, trace, context, Span, SpanStatusCode, Context, Meter, Tracer } from '@opentelemetry/api'
import axios from 'axios'

// Global SDK initialization - this should happen only once
let sdkInitialized = false
let globalMeter: Meter
let globalTracer: Tracer

function initializeSDK () {
    if (sdkInitialized) return

    const sdk = new NodeSDK({
        traceExporter: new ConsoleSpanExporter(),
        metricReader: new PeriodicExportingMetricReader({
            exporter: new ConsoleMetricExporter(),
        }),
        instrumentations: [ getNodeAutoInstrumentations() ],
    })

    sdk.start()

    globalMeter = metrics.getMeter('event-testing-metrics')
    globalTracer = trace.getTracer('event-testing')

    sdkInitialized = true
    console.log('[TelemetryService] OpenTelemetry SDK initialized globally')
}

export interface TelemetryEventAttributes {
    stage?: string
    [key: string]: any
}

export class TelemetryService {
    private meter: Meter
    private tracer: Tracer
    private eventCounter: any
    private operationDurationHistogram: any
    private activeSpans: Map<string, { span: Span; context: Context; startTime: number }> = new Map()

    constructor (
        private readonly scenarioId: string,
        private readonly scenarioName: string
    ) {
        // Ensure global SDK is initialized
        initializeSDK()

        this.meter = globalMeter
        this.tracer = globalTracer

        // Create scenario-specific metrics with labels
        this.eventCounter = this.meter.createCounter('test_events', {
            description: 'Count of events during test scenarios',
        })

        this.operationDurationHistogram = this.meter.createHistogram('operation_duration', {
            unit: 'ms',
            description: 'Duration of operations',
        })

        console.log(`[TelemetryService] Initialized for scenario: ${scenarioName} (${scenarioId})`)
    }

    private getOperationKey (eventName: string): string {
        return `${eventName}-${this.scenarioId}`
    }

    private getBaseAttributes (): Record<string, string> {
        return {
            'scenario.id': this.scenarioId,
            'scenario.name': this.scenarioName,
        }
    }

    public async logEvent (
        eventName: string,
        status: 'success' | 'failure' = 'success',
        additionalAttributes: TelemetryEventAttributes = {}
    ): Promise<void> {
        const stage = additionalAttributes.stage || 'unknown'
        const key = this.getOperationKey(eventName)
        const baseAttributes = this.getBaseAttributes()
        let currentSpan: Span | undefined
        let spanContext: Context | undefined

        // Merge base attributes with additional ones
        const allAttributes = {
            ...baseAttributes,
            'event.name': eventName,
            'event.stage': stage,
            ...additionalAttributes,
        }

        try {
            if (stage === 'triggered') {
                // Create new span for triggered events
                currentSpan = this.tracer.startSpan(`event.${eventName}.triggered`, {
                    attributes: allAttributes,
                })

                spanContext = trace.setSpan(context.active(), currentSpan)

                this.activeSpans.set(key, {
                    span: currentSpan,
                    context: spanContext,
                    startTime: Date.now()
                })

                console.log(`[TelemetryService][${this.scenarioName}] Started tracking: ${eventName}`)

            } else if (stage === 'completed' || stage === 'listener_error') {
                // Complete existing span
                const activeSpanEntry = this.activeSpans.get(key)

                if (activeSpanEntry) {
                    currentSpan = activeSpanEntry.span
                    spanContext = activeSpanEntry.context
                    this.activeSpans.delete(key)

                    if (currentSpan) {
                        currentSpan.setStatus({
                            code: status === 'success' ? SpanStatusCode.OK : SpanStatusCode.ERROR,
                            message: status === 'failure' ? `Event ${eventName} failed at stage ${stage}` : undefined,
                        })

                        currentSpan.setAttributes({
                            'event.status': status,
                            ...additionalAttributes,
                        })

                        const duration = Date.now() - activeSpanEntry.startTime

                        this.operationDurationHistogram.record(duration, {
                            ...allAttributes,
                            'event.status': status,
                        })

                        currentSpan.setAttribute('event.duration_ms', duration)
                        currentSpan.end()

                        console.log(`[TelemetryService][${this.scenarioName}] Completed tracking: ${eventName} (${duration}ms)`)
                    }
                } else {
                    // Create one-off span if no active span found
                    console.warn(`[TelemetryService][${this.scenarioName}] No active span found for ${eventName}, creating one-off span`)

                    currentSpan = this.tracer.startSpan(`event.${eventName}.${stage}`, {
                        attributes: {
                            ...allAttributes,
                            'event.status': status,
                            warning: 'Span for completed/error stage started without a preceding triggered stage.',
                        },
                    })

                    currentSpan.setAttribute('event.duration_ms', 0)
                    currentSpan.end()
                }
            } else {
                // Create short-lived span for intermediate stages
                currentSpan = this.tracer.startSpan(`event.${eventName}.${stage}`, {
                    attributes: {
                        ...allAttributes,
                        'event.status': status,
                    },
                })
                currentSpan.end()
            }

            // Record event counter
            this.eventCounter.add(1, {
                ...allAttributes,
                'event.status': status,
            })

            console.log(`[TelemetryService][${this.scenarioName}] Event: ${eventName}, Stage: ${stage}, Status: ${status}`)

            // Send to visualization server
            await this.sendToVisualizationServer(eventName, status, stage, allAttributes, currentSpan)

        } catch (error) {
            console.error(`[TelemetryService][${this.scenarioName}] Error logging event ${eventName}:`, error)
        }
    }

    private async sendToVisualizationServer (
        eventName: string,
        status: string,
        stage: string,
        attributes: Record<string, any>,
        span?: Span
    ): Promise<void> {
        try {
            const metricData: Record<string, any> = {
                name: eventName,
                metricType: stage,
                event: eventName,
                scenarioId: this.scenarioId,
                scenarioName: this.scenarioName,
                status,
                timestamp: new Date().toISOString(),
                ...attributes,
                displayName: `${eventName} (${stage})`,
                value: 1,
            }

            if (span && span.attributes['event.duration_ms']) {
                metricData.executionTimeMs = span.attributes['event.duration_ms']
            }

            await axios.post('http://localhost:8080/collect-metrics', metricData)
        } catch (error: any) {
            console.error(`[TelemetryService][${this.scenarioName}] Failed to send metric to visualization server:`, error.message)
        }
    }

    public async logSuccess (eventName: string, additionalAttributes: TelemetryEventAttributes = {}): Promise<void> {
        await this.logEvent(eventName, 'success', additionalAttributes)
    }

    public async logFailure (eventName: string, error?: string | Error, additionalAttributes: TelemetryEventAttributes = {}): Promise<void> {
        const errorMessage = error instanceof Error ? error.message : error
        await this.logEvent(eventName, 'failure', {
            ...additionalAttributes,
            errorMessage,
        })
    }

    public async logTriggered (eventName: string, additionalAttributes: TelemetryEventAttributes = {}): Promise<void> {
        await this.logEvent(eventName, 'success', {
            ...additionalAttributes,
            stage: 'triggered',
        })
    }

    public async logCompleted (eventName: string, additionalAttributes: TelemetryEventAttributes = {}): Promise<void> {
        await this.logEvent(eventName, 'success', {
            ...additionalAttributes,
            stage: 'completed',
        })
    }

    public async logError (eventName: string, error?: string | Error, additionalAttributes: TelemetryEventAttributes = {}): Promise<void> {
        const errorMessage = error instanceof Error ? error.message : error
        await this.logEvent(eventName, 'failure', {
            ...additionalAttributes,
            stage: 'listener_error',
            errorMessage,
        })
    }

    public cleanup (): void {
        // Clean up any remaining active spans
        for (const [ key, spanEntry ] of this.activeSpans.entries()) {
            console.warn(`[TelemetryService][${this.scenarioName}] Cleaning up orphaned span: ${key}`)
            spanEntry.span.setStatus({
                code: SpanStatusCode.ERROR,
                message: 'Span ended during cleanup - possible incomplete operation'
            })
            spanEntry.span.end()
        }
        this.activeSpans.clear()
        console.log(`[TelemetryService][${this.scenarioName}] Cleaned up`)
    }

    // Getter methods for scenario info
    public getScenarioId (): string {
        return this.scenarioId
    }

    public getScenarioName (): string {
        return this.scenarioName
    }
}
