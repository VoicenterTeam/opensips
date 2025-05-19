import type {
    EventListener,
} from '../types/events'
import { ActionsResponseMap } from '../types/actions'

/**
 * Global event bus to handle shared events across scenarios
 */
export default class EventBus {
    private static instance: EventBus
    private eventListeners: Map<string, EventListener[]> = new Map()

    public static getInstance (): EventBus {
        console.log('Getting event bus instance')
        if (!EventBus.instance) {
            console.log('No instance, will create')
            EventBus.instance = new EventBus()
        }

        return EventBus.instance
    }

    // Register an event listener
    public addEventListener (eventName: string, listener: EventListener): void {
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, [])
        }

        this.eventListeners.get(eventName).push(listener)
    }

    // Remove an event listener
    public removeEventListener (eventName: string, listener: EventListener): void {
        if (this.eventListeners.has(eventName)) {
            const listeners = this.eventListeners.get(eventName)

            const index = listeners.indexOf(listener)

            if (index !== -1) {
                listeners.splice(index, 1)
            }
        }
    }

    // Trigger an event
    public triggerEvent<E extends keyof ActionsResponseMap>(eventName: E, data?: ActionsResponseMap[E]): void;
    public triggerEvent (eventName: string, data?: never): void {
        console.log(`[EventBus] Event triggered: ${eventName}`, data)

        // Make a copy of the listeners array to avoid modification during iteration
        const listeners = [ ...(this.eventListeners.get(eventName) || []) ]

        // For debugging purposes
        console.log(`[EventBus] Found ${listeners.length} listeners for event: ${eventName}`)

        // First trigger specific event listeners
        for (const listener of listeners) {
            // Execute the listener
            listener(eventName, data)
        }

        // Make a copy of the wildcard listeners
        const wildcardListeners = [ ...(this.eventListeners.get('*') || []) ]

        // Then trigger wildcard listeners
        for (const listener of wildcardListeners) {
            listener(eventName, data)
        }
    }

    // Utility to wait for an event
    public waitForEvent<E extends keyof ActionsResponseMap>(eventName: E, additionalCheck: (eventName: string, data: object) => boolean, timeout?: number): Promise<ActionsResponseMap[E]>;
    public waitForEvent (eventName: string, additionalCheck: (eventName: string, data: object) => boolean, timeout?: number): Promise<never> {
        return new Promise((resolve, reject) => {
            const listener: EventListener = (name, data) => {
                console.log(`Triggered listener for waiting event: ${eventName}, name === eventName: ${name === eventName}, additionalCheck(name, data): ${additionalCheck(name, data)}`)

                if (name === eventName && additionalCheck(name, data)) {
                    this.removeEventListener(eventName, listener)
                    resolve(data)
                }
            }

            this.addEventListener(eventName, listener)

            if (timeout) {
                setTimeout(() => {
                    this.removeEventListener(eventName, listener)
                    reject(new Error(`Timeout waiting for event ${eventName}`))
                }, timeout)
            }
        })
    }
}
