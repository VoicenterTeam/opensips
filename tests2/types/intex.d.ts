import { EventHandler } from './events'

export type TestScenario = EventHandler[]

export type TestScenarios = TestScenario[]

export interface TestContext {
    [key: string]: any
}
