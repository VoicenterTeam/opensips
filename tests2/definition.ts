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
            // First scenario - caller\
            this.createScenario(
                this.on('ready', [
                    this.wait({
                        payload: { time: 100 },
                        waitUntil: { event: 'callee_registered' }
                    }),
                    this.register({
                        payload: {
                            sip_domain: '',
                            username: '',
                            password: '',
                        },
                        customSharedEvent: 'caller_registered'
                    }),
                    this.dial({
                        payload: { target: '36' },
                        customSharedEvent: 'call_initiated'
                    })
                ]),
                this.on('call_answered', [
                    this.wait({ payload: { time: 1000 } }),
                    this.hold({
                        customSharedEvent: 'call_on_hold',
                        // Type-safe filter using AnswerEventData
                        // filter: (data: AnswerEventData) => data.answered === true
                    }),
                    this.wait({ payload: { time: 1000 } }),
                    this.unhold({}),
                    this.wait({ payload: { time: 1000 } }),
                    this.wait({
                        payload: { time: 2000 },
                        customSharedEvent: 'sound_played'
                    }),
                    this.wait({ payload: { time: 1000 } }),
                    this.hangup({
                        customSharedEvent: 'call_ended'
                    }),
                    this.unregister({}),
                ])
            ),
            // Second scenario - callee
            this.createScenario(
                this.on('ready', [
                    this.register({
                        payload: {
                            sip_domain: '',
                            username: '',
                            password: ''
                        },
                        customSharedEvent: 'callee_registered'
                    })
                ]),
                this.on('call_initiated', [
                    this.wait({
                        payload: { time: 500 },
                        // Type-safe filter for custom event data
                        // filter: (data: CustomSharedEventData<DialEventData>) =>
                        //     data.result.target === 123456 && data.result.success
                    })
                    // The incoming event will be triggered by the system
                ]),
                this.on('incoming', [
                    this.answer({
                        customSharedEvent: 'call_answered',
                        // Type-safe filter using IncomingEventData
                        // filter: (data: IncomingEventData) => data.callerId === 'caller' || true // Just an example condition
                    })
                ]),
                this.on('call_on_hold', [
                    this.wait({
                        payload: { time: 500 },
                        // Type-safe filter for custom event data
                        // filter: (data: CustomSharedEventData<HoldEventData>) =>
                        //     data.originScenario === 'scenario-1' && data.result.onHold
                    })
                ]),
                this.on('sound_played', [
                    // Type-safe filter for custom event data with PlaySoundEventData
                    this.wait({
                        payload: { time: 200 },
                        // filter: (data: CustomSharedEventData<PlaySoundEventData>) =>
                        //     data.result.sound === 'greeting.wav' && data.result.played
                    })
                ]),
                this.on('call_ended', [
                    this.unregister({
                        // Type-safe filter for custom events
                        // filter: (data: CustomSharedEventData<HangupEventData>) =>
                        //     data.originScenario === 'scenario-1' && data.result.hungUp
                    }),
                ])
            )
        ]
    }
}

