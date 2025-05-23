import fs from 'node:fs'

import TestScenariosBuilder from './services/TestScenariosBuilder'
import type { TestScenarios } from './types/intex'
import env from './env'
import { validateTestScenarios } from './schema/scenarios.schema'
import path from 'path'

export default class CallTestScenarios extends TestScenariosBuilder {
    getInitialContext () {
        return {}
    }

    init (): TestScenarios {
        // Get the sample path from environment
        const samplePath = path.resolve(env.SAMPLE_TO_EXECUTE)

        // Check if the file exists
        if (!fs.existsSync(samplePath)) {
            throw new Error(`Sample file not found: ${samplePath}`)
        }

        // Read the file content
        const fileContent = fs.readFileSync(samplePath, 'utf-8')

        try {
            // Validate the JSON content against our schema
            // This will return properly typed TestScenarios that match the interface
            const scenarios: TestScenarios = validateTestScenarios(fileContent)
            console.log(`Successfully loaded and validated test scenarios from ${samplePath}`)

            // Return the validated scenarios
            return scenarios
        } catch (error) {
            console.error('Test scenario validation failed:')
            if (error instanceof Error) {
                console.error(error.message)
            } else {
                console.error(error)
            }
            throw new Error('Invalid test scenario format. See error details above.')
        }
    }
}
