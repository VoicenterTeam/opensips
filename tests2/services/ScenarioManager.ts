import type {
    TestScenarios,
} from '../types/intex'

import TestExecutor from './TestExecutor'

/**
 * ScenarioManager - Manages the execution of multiple test scenarios
 */
export default class ScenarioManager {
    private scenarios: TestScenarios

    constructor (scenarios: TestScenarios) {
        this.scenarios = scenarios
    }

    public async runScenarios (): Promise<void> {
        console.log(`Running ${this.scenarios.length} test scenarios`)

        const executors: TestExecutor[] = []

        // Create an executor for each scenario
        for (let i = 0; i < this.scenarios.length; i++) {
            const scenarioId = `scenario-${i + 1}`
            console.log(scenarioId, 'created')
            executors.push(new TestExecutor(scenarioId))
        }

        // Execute all scenarios in parallel
        await Promise.all(this.scenarios.map((scenario, index) =>
            executors[index].executeScenario(scenario)
        ))

        console.log('All scenarios completed')
    }
}
