import {
    ActionsPerEvent,
    ActionByActionType,
    GetActionDefinition,
} from './actions'

import { EventsMap } from './events'

export type TestScenarioListener<E extends keyof EventsMap> = {
    event: E
    actions: ActionsPerEvent<E>
}

export type TestScenario = {
    [E in keyof EventsMap]: {
        event: E
        actions: GetActionDefinition<ActionByActionType<EventsMap[E]>>[]
    }
}[keyof EventsMap][]

export type TestScenarios = TestScenario[]
