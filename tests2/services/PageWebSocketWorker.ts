import { Page, WebSocket } from 'playwright'
import Parser from '../../src/lib/janus/Parser'
import Logger from './Logger'
import './TelemetrySetup'
import { logTestEvent } from './TelemetrySetup'

interface WaitForMessageOptions {
    method: string
    status_code: number
    timeout: number
}

export default class PageWebSocketWorker {
    private readonly logger = new Logger('PageWebSocketWorker')
    private connectedWebsocket: WebSocket
    public scenarioId: string

    constructor (
        private readonly page: Page,
        private readonly socketEventsToMonitor: Record<string, string> = {},
        private readonly callback: (eventName: string) => never
    ) {}

    public setScenarioId (id: string): void {
        this.scenarioId = id
    }

    public setConnectedWebsocket (ws: WebSocket): void {
        this.connectedWebsocket = ws
        this.logger.log('Connected WebSocket:', ws.url())
    }

    public getConnectedWebsocket (): WebSocket {
        return this.connectedWebsocket
    }

    public setWebsocketListener (ws: WebSocket) {
        // Use a direct listener approach instead of polling
        ws.on('framereceived', (msg) => {
            if (typeof msg.payload === 'string') {
                const message = msg.payload
                const parsedMessage = Parser.parseMessage(message, {
                    configuration: {},
                    contact: {}
                })

                logTestEvent(parsedMessage.method, this.scenarioId, 'success', {
                    stage: 'triggered',
                })

                console.log('RECEIVED WEBSOCKET FRAME', {
                    method: parsedMessage.method,
                    status_code: 'status_code' in parsedMessage ? parsedMessage.status_code : null,
                })

                // Check if this socket event has a corresponding local event
                if (parsedMessage && parsedMessage.method && parsedMessage.method in this.socketEventsToMonitor) {
                    const localEvent = this.socketEventsToMonitor[parsedMessage.method]
                    this.logger.log('triggering local event', localEvent)
                    this.callback(localEvent)
                }
            }
        })
    }

    public waitForMessage (ws: WebSocket, waitingOptions: WaitForMessageOptions): Promise<void> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(
                () => {
                    this.logger.log('Timeout waiting for message')
                    reject(new Error(`Timeout waiting for message ${waitingOptions.method}`))
                },
                waitingOptions.timeout
            )

            const listener = (msg: {payload: string | Buffer})=> {
                if (typeof msg.payload === 'string') {
                    const message = msg.payload
                    const parsedMessage = Parser.parseMessage(message, {
                        configuration: {},
                        contact: {}
                    })

                    logTestEvent(parsedMessage.method, this.scenarioId, 'success', {
                        stage: 'triggered',
                    })

                    if (parsedMessage && parsedMessage.method === waitingOptions.method && ('status_code' in parsedMessage && parsedMessage.status_code === waitingOptions.status_code)) {
                        this.logger.log('Received expected message:', parsedMessage.method)
                        clearTimeout(timeout)
                        ws.off('framereceived', listener.bind(this))
                        resolve()
                    }
                }
            }

            ws.on('framereceived', listener.bind(this))
        })
    }

    public waitForSocket (domain: string): Promise<WebSocket> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(
                () => {
                    this.logger.log('Timeout waiting for websocket')
                    reject(new Error(`Timeout waiting for websocket ${domain}`))
                },
                10000
            )

            this.page.on('websocket', (ws) => {
                const url = new URL(ws.url())
                const connectedWebsocketDomain = url.hostname

                this.logger.log('GOT SOME WEBSOCKET', connectedWebsocketDomain)

                if (connectedWebsocketDomain === domain) {
                    this.logger.log('WebSocket found for domain:', domain)

                    clearTimeout(timeout)
                    resolve(ws)
                }
            })
        })
    }
}
