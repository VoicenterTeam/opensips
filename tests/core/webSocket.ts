import { expect } from '@playwright/test'
import { IncomingRequest, IncomingResponse } from 'jssip/lib/SIPMessage'
import Parser from '../../src/lib/janus/Parser'

export async function checkSocketEvent ( ws:WebSocket, event:string ){
    const msg = await webSocketEventParser(ws)
    return expect(msg.method).toBe(event)
}
function webSocketEventParser (ws) {
    return new Promise <IncomingRequest | IncomingResponse> ((resolve) => {
        ws.once('framesent',async (msg) => {
            if (typeof msg.payload === 'string') {
                const message = msg.payload
                const parsedMessage = Parser.parseMessage(message, {
                    configuration: {},
                    contact: {}
                })
                console.log(parsedMessage.method, 'message')
                resolve(parsedMessage)
            }
        })
    })
}
export function getPageWebSocket (page) {
    return new Promise < WebSocket > ((resolve) => {
        page.once('websocket', (ws) =>  {
            resolve(ws)
        })
    })
}

export async function monitorSocketEvents (ws, eventMapping, context) {
    try {
        while (true) {
            // Use your existing webSocketEventParser to get the next message
            const msg = await webSocketEventParser(ws)

            // Check if this socket event has a corresponding local event
            if (msg && msg.method && eventMapping.hasOwnProperty(msg.method)) {
                const localEvent = eventMapping[msg.method]
                context.triggerLocalEventListener(localEvent)
            }
        }
    } catch (error) {
        console.error('Error monitoring socket events:', error)
    }
}



