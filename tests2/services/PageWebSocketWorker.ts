import { Page, WebSocket } from 'playwright'
import Parser from '../../src/lib/janus/Parser'
import Logger from './Logger'

export default class PageWebSocketWorker {
    private readonly logger = new Logger('PageWebSocketWorker')
    private domain: string | null = null

    constructor (
        private readonly page: Page,
        private readonly socketEventsToMonitor: Record<string, string> = {},
        private readonly callback: (eventName: string) => never
    ) {
        this.logger.log('PageWebSocketWorker constructor')

        this.page.on('websocket', (ws) => {
            this.logger.log('GOT SOME WEBSOCKET', ws.url())

            this.setWebsocketListener(ws)
        })
    }

    private setWebsocketListener (ws: WebSocket) {
        const url = new URL(ws.url())
        const domain = url.hostname

        // Use a direct listener approach instead of polling
        ws.on('framereceived', (msg) => {
            if (domain !== this.domain) {
                return
            }

            if (typeof msg.payload === 'string') {
                const message = msg.payload
                const parsedMessage = Parser.parseMessage(message, {
                    configuration: {},
                    contact: {}
                })

                console.log('message', parsedMessage.method)

                // Check if this socket event has a corresponding local event
                if (parsedMessage && parsedMessage.method && parsedMessage.method in this.socketEventsToMonitor) {
                    const localEvent = this.socketEventsToMonitor[parsedMessage.method]
                    this.logger.log('triggering local event', localEvent)
                    this.callback(localEvent)
                }
            }
        })
    }

    public init (domain: string) {
        this.logger.log('PageWebSocketWorker init', domain)

        this.domain = domain
    }
}
