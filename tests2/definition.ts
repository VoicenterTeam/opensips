import TestScenariosBuilder from './services/TestScenariosBuilder'
import type { TestScenarios } from './types/intex'

export default class CallTestScenarios extends TestScenariosBuilder {
    getInitialContext () {
        return {
            caller: {
                sip_domain: '',
                username: '',
                password: '',
            },
            callee: {
                sip_domain: '',
                username: '',
                password: ''
            }
        }
    }

    init (): TestScenarios {
        return [
            // First scenario - caller
            this.createScenario(
                this.on('ready', [
                    this.wait({
                        payload: { time: 2000 }
                    }),
                    this.request({
                        payload: {
                            url: 'https://jsonplaceholder.typicode.com/todos/1',
                            options: {
                                method: 'GET'
                            }
                        },
                        customSharedEvent: 'request_completed'
                    }),
                ]),
                this.on('request_completed', [
                    this.register({
                        payload: {
                            sip_domain: '{{response.title}}',
                            username: '{{caller.username}}',
                            password: '{{caller.password}}',
                        },
                        customSharedEvent: 'caller_registered'
                    })
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
            ),
            // Second scenario - callee
            // this.createScenario(
            //     this.on('ready', [
            //         this.register({
            //             payload: {
            //                 sip_domain: '{{callee.sip_domain}}',
            //                 username: '{{callee.username}}',
            //                 password: '{{callee.password}}',
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
