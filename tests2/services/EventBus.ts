import { EventListener, EventListenerData, EventType } from '../types/events'

export default class EventBus {
    private static instance: EventBus
    private eventListeners: Map<EventType, EventListener<any>[]> = new Map()

    public static getInstance (): EventBus {
        if (!EventBus.instance) {
            EventBus.instance = new EventBus()
        }
        return EventBus.instance
    }

    public addEventListener <E extends EventType> (eventName: E, listener: EventListener<E>): void {
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, [])
        }

        this.eventListeners.get(eventName).push(listener)
    }

    public removeEventListener <E extends EventType> (eventName: E, listener: EventListener<E>): void {
        const listeners = this.eventListeners.get(eventName)

        if (!listeners) return

        const index = listeners.indexOf(listener)

        if (index !== -1) {
            listeners.splice(index, 1)
        }
    }

    public triggerEvent <E extends EventType> (
        eventName: E,
        data?: EventListenerData<E>
    ): void {
        console.log(`[EventBus] Event triggered: ${eventName}`)

        const listeners = [ ...(this.eventListeners.get(eventName) || []) ]
        console.log(`[EventBus] Found ${listeners.length} listeners for event: ${eventName}`)

        for (const listener of listeners) {
            listener(eventName, data)
        }
    }

    public waitForEvent <E extends EventType> (
        eventName: E,
        additionalCheck: (eventName: E, data: EventListenerData<E>) => boolean,
        timeout?: number
    ): Promise<EventListenerData<E>> {
        return new Promise((resolve, reject) => {
            const listener: EventListener<E> = (name, data) => {
                if (name === eventName && additionalCheck(name, data)) {
                    this.removeEventListener(eventName, listener)
                    resolve(data)
                }
            }

            this.addEventListener<E>(eventName, listener)

            if (timeout) {
                setTimeout(() => {
                    this.removeEventListener(eventName, listener)
                    reject(new Error(`Timeout waiting for event ${eventName}`))
                }, timeout)
            }
        })
    }
}
