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
            console.log('OLD framesent', msg)
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

export function monitorSocketEvents(ws, eventMapping, context) {
    // Use a Set to track already processed message IDs
    const processedMessages = new Set();
    
    // Create a single listener for the websocket
    ws.on('framesent', async (msg) => {
        if (typeof msg.payload === 'string') {
            const message = msg.payload;
            const parsedMessage = Parser.parseMessage(message, {
                configuration: {},
                contact: {}
            });
            
            // Create a unique identifier for this message (using the message ID or a hash)
            const messageId = parsedMessage.call_id || parsedMessage.via?.branch || message;
            
            // Check if we've already processed this message
            if (processedMessages.has(messageId)) {
                return; // Skip duplicate messages
            }
            
            // Mark as processed
            processedMessages.add(messageId);
            
            console.log('got message', parsedMessage.method);
            
            // Check if this socket event has a corresponding local event
            if (parsedMessage && parsedMessage.method && eventMapping.hasOwnProperty(parsedMessage.method)) {
                const localEvent = eventMapping[parsedMessage.method];
                context.triggerLocalEventListener(localEvent);
            }
        }
    });
}



