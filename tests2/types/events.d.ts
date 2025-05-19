import {
    GetActionDefinition,
    ActionType,
    ActionByActionType,
    ActionsResponseMap
} from './actions'

type AllowedActions <T extends ActionType> = T

// Define available events and the actions allowed for each event
export interface EventsMap {
    register: AllowedActions<'dial' | 'wait'>
    dial: never[]
    answer: AllowedActions<'hold' | 'unhold' | 'wait' | 'play_sound' | 'hangup'>
    hold: AllowedActions<'unhold' | 'wait'>
    unhold: AllowedActions<'hold' | 'wait'>
    hangup: AllowedActions<'unregister'>
    playSound: AllowedActions<'wait'>
    sendDTMF: AllowedActions<'wait'>
    transfer: AllowedActions<'wait'>
    unregister: AllowedActions<'wait'>
    ready: AllowedActions<'register' | 'wait'>
    incoming: AllowedActions<'answer' | 'wait'>
    [customEvent: string]: AllowedActions<ActionType>
}
export type EventType = keyof EventsMap
export type EventHandler<E extends EventType> = {
    event: E
    actions: readonly ActionsPerEvent<E>[]
}
export type EventListenerData <E extends EventType> = E extends keyof ActionsResponseMap ? ActionsResponseMap[E] : any
export type EventListener<E extends EventType = string> =
    (event: E, data: EventListenerData<E>) => void

export type ActionsPerEvent <T extends EventType> = GetActionDefinition<ActionByActionType<EventsMap[T]>>
