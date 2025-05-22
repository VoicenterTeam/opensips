import {
    TestContext,
    TestScenarios,
} from '../types/intex'

import TestExecutor from './TestExecutor'

/**
 * ScenarioManager - Manages the execution of multiple test scenarios
 */
export default class ScenarioManager {
    private scenarios: TestScenarios
    protected testContext: TestContext = {}

    constructor (scenarios: TestScenarios, testContext: TestContext) {
        this.scenarios = scenarios
        this.testContext = testContext
    }

    public getContext (): TestContext {
        return {
            ...this.testContext
        }
    }

    public updateContext (context: TestContext): void {
        this.testContext = {
            ...this.testContext,
            ...context
        }
    }

    public async runScenarios (): Promise<void> {
        console.log(`Running ${this.scenarios.length} test scenarios`)

        const executors: TestExecutor[] = []

        // Create an executor for each scenario
        for (let i = 0; i < this.scenarios.length; i++) {
            const scenarioId = `scenario-${i + 1}`
            console.log(scenarioId, 'created')
            executors.push(
                new TestExecutor(
                    scenarioId,
                    this.scenarios[i].name,
                    this
                )
            )
        }

        // Execute all scenarios in parallel
        await Promise.all(this.scenarios.map((scenario, index) =>
            executors[index].executeScenario(scenario)
        ))

        console.log('All scenarios completed')
    }
}
