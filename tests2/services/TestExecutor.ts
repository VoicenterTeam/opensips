import { Browser, chromium, Page } from 'playwright'
import PageWebSocketWorker from './PageWebSocketWorker'

import EventBus from './EventBus'
import ActionsExecutor from './ActionsExecutor'
import WindowMethodsWorker from './WindowMethodsWorker'

import { waitMs } from '../helpers'

import { ActionsResponseMap, GetActionDefinition, ActionType, ActionByActionType } from '../types/actions'
import { TestScenario } from '../types/intex'
import { EventListener, EventListenerData, EventType } from '../types/events'

const SCENARIO_THAT_TRIGGERED_EVENT_KEY = 'SCENARIO_THAT_TRIGGERED_EVENT_KEY' as const

export default class TestExecutor {
    private pageWebSocketWorker!: PageWebSocketWorker
    private actionsExecutor!: ActionsExecutor
    private windowMethodsWorker!: WindowMethodsWorker

    private readonly eventBus = EventBus.getInstance()

    public page!: Page
    public browser!: Browser

    constructor (private readonly scenarioId: string) {}

    private addEventListener<E extends EventType> (
        eventName: E,
        listener: EventListener<E>
    ): void {
        const wrappedListener: EventListener<E> = (name, data): void => {
            if (name === eventName) {
                listener(name, data)
            }
        }

        this.eventBus.addEventListener<E>(eventName, wrappedListener)
    }

    private triggerLocalEventListener<E extends EventType> (
        eventName: E,
        data: EventListenerData<E>
    ): void {
        this.eventBus.triggerEvent(eventName, {
            ...data,
            [SCENARIO_THAT_TRIGGERED_EVENT_KEY]: this.scenarioId,
        })
    }

    private triggerSharedEventListener<E extends EventType> (
        eventName: E | string,
        data: EventListenerData<E>
    ): void {
        console.log(`[Scenario ${this.scenarioId}] Triggering shared event: ${eventName}`)
        this.eventBus.triggerEvent(eventName, data)
    }

    private shouldReactToEvent <E extends keyof ActionsResponseMap> (eventData: ActionsResponseMap[E]): boolean {
        return (
            !(SCENARIO_THAT_TRIGGERED_EVENT_KEY in eventData) ||
            eventData[SCENARIO_THAT_TRIGGERED_EVENT_KEY] === this.scenarioId
        )
    }

    private async executeAction<T extends ActionType> (
        action: GetActionDefinition<ActionByActionType<T>>,
    ): Promise<void> {
        console.log(`[Scenario ${this.scenarioId}] Executing action: ${action.type}`)

        if (action.data.waitUntil) {
            console.log(`[Scenario ${this.scenarioId}] Waiting for event: ${action.data.waitUntil.event}`)

            try {
                await this.eventBus.waitForEvent(
                    action.data.waitUntil.event,
                    (_, data) => this.shouldReactToEvent(data),
                    action.data.waitUntil.timeout
                )
                console.log(`[Scenario ${this.scenarioId}] Event received: ${action.data.waitUntil.event}`)
            } catch (error) {
                console.error(`[Scenario ${this.scenarioId}] Error waiting for event:`, error)
                throw error
            }
        }

        const triggerCustom = <T extends ActionType> (result: ActionsResponseMap[T]) => {
            if (action.data.customSharedEvent) {
                const sharedData: ActionsResponseMap[T] & { originScenario: string; actionType: string } = {
                    ...result,
                    originScenario: this.scenarioId,
                    actionType: action.type
                }
                setTimeout(() => {
                    this.triggerSharedEventListener(action.data.customSharedEvent, sharedData)
                }, 0)
            }
        }

        try {
            // We'll handle each case separately with its own type
            const actionType = action.type

            // Use a type safe approach that doesn't require explicit typing of 'result'
            if (actionType === 'register') {
                const result = await this.actionsExecutor.register(action.data.payload)
                this.triggerLocalEventListener('register', result)
                triggerCustom(result)
            } else if (actionType === 'dial') {
                const result = await this.actionsExecutor.dial(action.data.payload)
                this.triggerLocalEventListener('dial', result)
                triggerCustom(result)
            } else if (actionType === 'answer') {
                const result = await this.actionsExecutor.answer()
                this.triggerLocalEventListener('answer', result)
                triggerCustom(result)
            } else if (actionType === 'wait') {
                const result = await this.actionsExecutor.wait(action.data.payload)
                triggerCustom(result)
            } else if (actionType === 'hold') {
                const result = await this.actionsExecutor.hold()
                this.triggerLocalEventListener('hold', result)
                triggerCustom(result)
            } else if (actionType === 'unhold') {
                const result = await this.actionsExecutor.unhold()
                this.triggerLocalEventListener('unhold', result)
                triggerCustom(result)
            } else if (actionType === 'hangup') {
                const result = await this.actionsExecutor.hangup()
                this.triggerLocalEventListener('hangup', result)
                triggerCustom(result)
            } else if (actionType === 'playSound') {
                const result = await this.actionsExecutor.playSound(action.data.payload)
                this.triggerLocalEventListener('playSound', result)
                triggerCustom(result)
            } else if (actionType === 'sendDTMF') {
                const result = await this.actionsExecutor.sendDTMF(action.data.payload)
                this.triggerLocalEventListener('sendDTMF', result)
                triggerCustom(result)
            } else if (actionType === 'transfer') {
                const result = await this.actionsExecutor.transfer(action.data.payload)
                this.triggerLocalEventListener('transfer', result)
                triggerCustom(result)
            } else if (actionType === 'unregister') {
                const result = await this.actionsExecutor.unregister()
                this.triggerLocalEventListener('unregister', result)
                triggerCustom(result)
            }
        } catch (error) {
            console.error(`[Scenario ${this.scenarioId}] Error executing action:`, error)
            throw error
        }
    }

    private async start (): Promise<void> {
        this.browser = await chromium.launch({
            headless: false,
            args: [
                '--use-fake-ui-for-media-stream',
                '--use-fake-device-for-media-stream',
                '--allow-file-access',
                '--autoplay-policy=no-user-gesture-required',
            ],
        })

        const context = await this.browser.newContext()
        this.page = await context.newPage()

        this.pageWebSocketWorker = new PageWebSocketWorker(
            this.page,
            {
                INVITE: 'incoming',
                ACK: 'callConfirmed',
                CANCEL: 'callCancelled',
                BYE: 'callEnded',
                UPDATE: 'callUpdated',
                MESSAGE: 'messageReceived',
                OPTIONS: 'optionsReceived',
                REFER: 'callReferred',
                INFO: 'infoReceived',
                NOTIFY: 'notificationReceived',
            },
            this.triggerLocalEventListener.bind(this)
        )

        this.windowMethodsWorker = new WindowMethodsWorker(this.page)

        this.actionsExecutor = new ActionsExecutor(
            this.scenarioId,
            this.pageWebSocketWorker,
            this.windowMethodsWorker,
            this.page,
            this.browser
        )

        await this.windowMethodsWorker.implementPlayClipMethod()

        await this.page.goto('http://localhost:5173')
        await waitMs(100)
        this.triggerLocalEventListener('ready', { timestamp: Date.now() })
    }

    public async executeScenario (scenario: TestScenario): Promise<void> {
        console.log('[Scenario] Executing scenario:', scenario)
        const eventCounter: Record<EventType, number> = {
            register: 0,
            dial: 0,
            answer: 0,
            ready: 0,
            incoming: 0,
            hangup: 0
        }
        const eventHandlers: Record<EventType, GetActionDefinition<ActionByActionType<keyof ActionsResponseMap>>[][]> = {
            register: [],
            dial: [],
            answer: [],
            ready: [],
            incoming: [],
            hangup: []
        }

        for (const { event, actions } of scenario) {
            if (!eventHandlers[event]) {
                eventHandlers[event] = []
                eventCounter[event] = 0
            }
            eventHandlers[event].push(actions)
        }

        console.log('eventHandlers', eventHandlers)

        for (const eventName in eventHandlers) {
            const handlers = eventHandlers[eventName]

            this.addEventListener(eventName, async (_, eventData) => {
                if (!this.shouldReactToEvent(eventData)) return

                const currentIndex = eventCounter[eventName]
                const actions = handlers[currentIndex]

                if (actions) {
                    eventCounter[eventName]++
                    for (const action of actions) {
                        await this.executeAction(action)
                    }
                }
            })
        }

        await this.start()
    }
}
