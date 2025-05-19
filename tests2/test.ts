import CallTestScenarios from './definition'

// Run the test
async function runTest () {
    console.log('Starting test execution')
    try {
        const testRunner = new CallTestScenarios()
        await testRunner.run()
        console.log('Test execution completed successfully')
    } catch (error) {
        console.error('Test execution failed:', error)
    }
}

// Start the test
runTest().catch(err => console.error('Unhandled error in test execution:', err))
