import { Page, WebSocket } from 'playwright'
import Parser from '../../src/lib/janus/Parser'

export default class PageWebSocketWorker {
    private ws: WebSocket | undefined

    constructor (
        private readonly page: Page,
        private readonly socketEventsToMonitor: Record<string, string> = {},
        private readonly callback: (eventName: string) => never
    ) {
        this.page.once('websocket', (ws) => {
            this.ws = ws
        })
    }

    public init () {
        if (!this.ws) {
            throw new Error('WebSocket not initialized. Call init() after the page is loaded.')
        }

        // Use a direct listener approach instead of polling
        this.ws.on('framesent', (msg) => {
            if (typeof msg.payload === 'string') {
                const message = msg.payload
                const parsedMessage = Parser.parseMessage(message, {
                    configuration: {},
                    contact: {}
                })

                // console.log('got message', parsedMessage.method, parsedMessage.data)

                // Check if this socket event has a corresponding local event
                if (parsedMessage && parsedMessage.method && parsedMessage.method in this.socketEventsToMonitor) {
                    const localEvent = this.socketEventsToMonitor[parsedMessage.method]
                    this.callback(localEvent)
                }
            }
        })
    }
}
