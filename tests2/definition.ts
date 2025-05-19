import TestScenariosBuilder from './services/TestScenariosBuilder'
import type { TestScenarios } from './types/intex'
import path from 'path'

export default class CallTestScenarios extends TestScenariosBuilder {
    init (): TestScenarios {
        return [
            // First scenario - caller
            this.createScenario(
                this.on('ready', [
                    this.wait({
                        payload: { time: 2000 }
                    }),
                    this.register({
                        payload: {

                        },
                        // waitUntil: { event: 'callee_registered' }
                    }),
                ]),
                this.on('incoming', [
                    this.answer({
                        customSharedEvent: 'call_answered',
                    })
                ]),
                this.on('answer', [
                    this.wait({
                        payload: { time: 3000 }
                    }),
                    this.hangup({})
                ]),
                this.on('hangup', [
                    this.unregister({}),
                ])
                // this.on('caller_registered', [
                //     this.wait({
                //         payload: { time: 1000 }
                //     }),
                //     this.unregister({}),
                //     this.wait({
                //         payload: { time: 1000 }
                //     }),
                //     this.register({
                //         payload: {
                //         },
                //         customSharedEvent: 'caller_registered',
                //         // waitUntil: { event: 'callee_registered' }
                //     }),
                // ]),
                // this.on('caller_registered', [
                //     this.wait({
                //         payload: { time: 1000 }
                //     }),
                //     this.dial({
                //         payload: {
                //             target: '36'
                //         },
                //         customSharedEvent: 'call_initiated'
                //     })
                // ])
            ),
            // Second scenario - callee
            // this.createScenario(
            //     this.on('ready', [
            //         this.register({
            //             payload: {

            //             },
            //             customSharedEvent: 'callee_registered'
            //         })
            //     ]),
            //     this.on('call_initiated', [
            //         this.wait({
            //             payload: { time: 500 },
            //         })
            //     ]),
            //     this.on('incoming', [
            //         this.answer({
            //             customSharedEvent: 'call_answered',
            //         })
            //     ]),
            //     this.on('call_on_hold', [
            //         this.wait({
            //             payload: { time: 500 },
            //         })
            //     ]),
            //     this.on('sound_played', [
            //         this.wait({
            //             payload: { time: 200 },
            //         })
            //     ]),
            //     this.on('call_ended', [
            //         this.unregister({}),
            //     ])
            // )
        ]
    }
}
