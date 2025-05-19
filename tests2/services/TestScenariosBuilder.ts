import {
    RegisterAction,
    DialAction,
    AnswerAction,
    WaitAction,
    HoldAction,
    UnholdAction,
    HangupAction,
    UnregisterAction,
    PlaySoundAction,
    GetActionData,
    ActionsScenariosBuilderImplements,
    RequestAction
} from '../types/actions'

import {
    TestContext,
    TestScenario,
    TestScenarios,
} from '../types/intex'
import {
    ActionsPerEvent, EventHandler,
    EventsMap, EventType
} from '../types/events'

import ScenarioManager from './ScenarioManager'
import { SendDTMFAction } from '../types/actions'
import { GetActionDefinition } from '../types/actions'
import { TransferAction } from '../types/actions'

/**
 * Base class for defining test scenarios
 */
export default abstract class TestScenariosBuilder implements ActionsScenariosBuilderImplements {
    public register (data: GetActionData<RegisterAction>): GetActionDefinition<RegisterAction> {
        return {
            type: 'register',
            data
        }
    }

    public dial (data: GetActionData<DialAction>): GetActionDefinition<DialAction> {
        return {
            type: 'dial',
            data
        }
    }

    public wait (data: GetActionData<WaitAction>): GetActionDefinition<WaitAction> {
        return {
            type: 'wait',
            data
        }
    }

    public playSound (data: GetActionData<PlaySoundAction>): GetActionDefinition<PlaySoundAction> {
        return {
            type: 'playSound',
            data
        }
    }

    public answer (data: GetActionData<AnswerAction>): GetActionDefinition<AnswerAction> {
        return {
            type: 'answer',
            data
        }
    }

    public hold (data: GetActionData<HoldAction>): GetActionDefinition<HoldAction> {
        return {
            type: 'hold',
            data
        }
    }

    public unhold (data: GetActionData<UnholdAction>): GetActionDefinition<UnholdAction> {
        return {
            type: 'unhold',
            data
        }
    }

    public hangup (data: GetActionData<HangupAction>): GetActionDefinition<HangupAction> {
        return {
            type: 'hangup',
            data
        }
    }

    public unregister (data: GetActionData<UnregisterAction>): GetActionDefinition<UnregisterAction> {
        return {
            type: 'unregister',
            data
        }
    }

    public sendDTMF (data: GetActionData<SendDTMFAction>): GetActionDefinition<SendDTMFAction> {
        return {
            type: 'sendDTMF',
            data
        }
    }

    public transfer (data: GetActionData<TransferAction>): GetActionDefinition<TransferAction> {
        return {
            type: 'transfer',
            data
        }
    }

    public request (data: GetActionData<RequestAction>): GetActionDefinition<RequestAction> {
        return {
            type: 'request',
            data
        }
    }

    protected on<E extends keyof EventsMap> (
        event: E,
        actions: readonly ActionsPerEvent<E>[]
    ): EventHandler<E> {
        return {
            event,
            actions
        }
    }

    protected createScenario (
        ...eventHandlers: EventHandler<EventType>[]
    ): TestScenario {
        return eventHandlers.map(({ event, actions }) => ({
            event,
            actions
        }))
    }

    abstract getInitialContext(): TestContext

    // Abstract method that must be implemented to define scenarios
    abstract init(): TestScenarios

    // Method to execute the scenarios
    async run (): Promise<void> {
        const scenarios = this.init()
        const initialContext = this.getInitialContext()
        const manager = new ScenarioManager(
            scenarios,
            initialContext
        )
        await manager.runScenarios()
    }
}
