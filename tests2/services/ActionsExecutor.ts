import path from 'path'
import fs from 'fs/promises'

import { Browser, Locator, Page } from 'playwright'
import { WebRTCMetricsCollector } from './WebRTCMetricsCollector'
import PageWebSocketWorker from './PageWebSocketWorker'
import WindowMethodsWorker from './WindowMethodsWorker'

import '../services/TelemetrySetup'

import {
    GetActionPayload,
    GetActionResponse,
    ActionsExecutorImplements,
    RegisterAction,
    DialAction,
    AnswerAction,
    WaitAction,
    HoldAction,
    UnholdAction,
    HangupAction,
    UnregisterAction,
    PlaySoundAction,
    SendDTMFAction,
    TransferAction,
    RequestAction,
} from '../types/actions'

import { waitMs } from '../helpers'

/**
 * TestExecutor - Handles the execution of test actions
 */
export default class ActionsExecutor implements ActionsExecutorImplements {
    private usernameInput: Locator
    private passwordInput: Locator
    private domainInput: Locator
    private loginButton: Locator
    private useAudioCheckbox: Locator
    private useVideoCheckbox: Locator
    private holdButton: Locator

    private yourTargetInput: Locator
    private callButton: Locator
    private answerButton: Locator
    private logoutButton: Locator
    private hangupButton: Locator
    private DTMFSendButton: Locator
    private DTMFInput: Locator
    private transferButton: Locator

    constructor (
        private readonly scenarioId: string,
        private readonly pageWebSocketWorker: PageWebSocketWorker,
        private readonly windowMethodsWorker: WindowMethodsWorker,
        public readonly page: Page,
        public readonly browser: Browser,
    ) {}

    public async register (data: GetActionPayload<RegisterAction>): Promise<GetActionResponse<RegisterAction>> {
        const instanceId = `${this.scenarioId}-${Date.now()}`
        console.log(`[Scenario ${this.scenarioId}] Executing register action`, data)
        const {
            username,
            password,
            sip_domain
        } = data

        console.log(`[Scenario ${this.scenarioId}][Instance ${instanceId}] Form elements found, filling form`)
        this.usernameInput = this.page.locator('#loginToAppForm > label:nth-child(2) > input')
        this.passwordInput = this.page.locator('#loginToAppForm > label:nth-child(3) > input')
        this.domainInput = this.page.locator('#loginToAppForm > label:nth-child(5) > input')
        this.useAudioCheckbox = this.page.locator('#useAudioCheckbox')
        this.useVideoCheckbox = this.page.locator('#useVideoCheckbox')
        this.loginButton = this.page.locator('#loginToAppForm > button')

        await this.usernameInput.fill(username)
        await this.passwordInput.fill(password)
        await this.domainInput.fill(sip_domain)

        return new Promise(
            (resolve) => {
                this.pageWebSocketWorker.waitForSocket(sip_domain)
                    .then(async (ws) => {
                        await this.pageWebSocketWorker.waitForMessage(
                            ws,
                            {
                                method: 'REGISTER',
                                status_code: 200,
                                timeout: 10000
                            }
                        )

                        this.pageWebSocketWorker.setConnectedWebsocket(ws)
                        this.pageWebSocketWorker.setWebsocketListener(ws)
                        await this.page.evaluate(WebRTCMetricsCollector.initializeMetricsAnalyze)

                        console.log(`[Scenario ${this.scenarioId}] Successfully registered`)

                        resolve({
                            success: true,
                            instanceId: instanceId
                        })
                    })
                    .catch(err => {
                        resolve({
                            success: false,
                            error: err instanceof Error ? err.message : 'Error executing register action'
                        })
                    })

                this.loginButton.click()
            }
        )
    }

    public async dial (data: GetActionPayload<DialAction>): Promise<GetActionResponse<DialAction>> {
        console.log(`[Scenario ${this.scenarioId}] Executing dial action`, data)

        this.yourTargetInput = this.page.locator('#makeCallForm input')
        this.callButton = this.page.locator('#makeCallForm button')

        await this.yourTargetInput.fill(String(data.target))

        await this.callButton.click()

        try {
            await this.pageWebSocketWorker.waitForMessage(
                this.pageWebSocketWorker.getConnectedWebsocket(),
                {
                    method: 'INVITE',
                    status_code: 200,
                    timeout: 10000
                }
            )
        } catch (error) {
            return {
                success: false,
                error: `Error dialing the number ${data.target}`
            }
        }

        const callId = 'call-' + Math.floor(Math.random() * 10000)

        return {
            callId,
            target: data.target,
            success: true
        }
    }

    public async answer (): Promise<GetActionResponse<AnswerAction>> {
        console.log(`[Scenario ${this.scenarioId}] Executing answer action`)

        this.answerButton = this.page.locator('#call-undefined > button:nth-child(7)')
        await this.answerButton.click()

        await waitMs(200)

        return {
            success: true,
            callId: 'call-' + Math.floor(Math.random() * 10000)
        }
    }

    public async wait (data: GetActionPayload<WaitAction>): Promise<GetActionResponse<WaitAction>> {
        console.log(`[Scenario ${this.scenarioId}] Waiting for ${data.time}ms`)

        await this.page.waitForTimeout(data.time)

        await waitMs(data.time)

        return {
            success: true
        }
    }

    public async hold (): Promise<GetActionResponse<HoldAction>> {
        console.log(`[Scenario ${this.scenarioId}] Executing hold action`)

        this.holdButton = this.page.locator('.holdAgent')

        await this.holdButton.click()
        await waitMs(100)

        return {
            success: true,
            callId: 'call-' + Math.floor(Math.random() * 10000)
        }
    }

    public async unhold (): Promise<GetActionResponse<UnholdAction>> {
        console.log(`[Scenario ${this.scenarioId}] Executing unhold action`)

        this.holdButton = this.page.locator('.holdAgent')
        await this.holdButton.click()
        await waitMs(100)

        return {
            success: true,
            callId: 'call-' + Math.floor(Math.random() * 10000)
        }
    }

    public async hangup (): Promise<GetActionResponse<HangupAction>> {
        console.log(`[Scenario ${this.scenarioId}] Executing hangup action`)
        //this.hangupButton = this.page.locator('#call-undefined > button:nth-child(4)')

        this.hangupButton = this.page.getByRole('button', { name: 'Hangup' })
        await this.hangupButton.click()

        return {
            success: true,
            callId: 'call-' + Math.floor(Math.random() * 10000)
        }
    }

    public async sendDTMF (data: GetActionPayload<SendDTMFAction>): Promise<GetActionResponse<SendDTMFAction>> {
        console.log(`[Scenario ${this.scenarioId}] Executing send DTMF action`)

        this.DTMFInput = this.page.locator('#dtmfInput')
        this.DTMFSendButton = this.page.locator('#dtmfSendButton')
        await this.DTMFInput.fill(data.dtmf)
        await this.DTMFSendButton.click()

        await waitMs(200)

        return {
            dtmf: data.dtmf,
            callId: 'call-' + Math.floor(Math.random() * 10000),
            success: true,
        }
    }

    public async transfer (data: GetActionPayload<TransferAction>): Promise<GetActionResponse<TransferAction>> {
        console.log(`[Scenario ${this.scenarioId}] Executing transfer action`)

        this.transferButton = this.page.getByRole('button', { name: 'Transfer' })
        await this.transferButton.click()
        this.page.once('dialog', dialog => {
            console.log(`Dialog message: ${dialog.message()}`)
            dialog.accept(data.target).catch(e => console.error('Error accepting dialog:', e))
        })
        await waitMs(200)

        return {
            callId: 'call-' + Math.floor(Math.random() * 10000),
            success: true
        }
    }

    public async unregister (): Promise<GetActionResponse<UnregisterAction>> {
        console.log(`[Scenario ${this.scenarioId}] Executing unregister action`)

        this.logoutButton = this.page.locator('#logoutButton')

        const metrics = await this.page.evaluate(WebRTCMetricsCollector.collectMetrics)

        // Clicking the logout button
        await this.logoutButton.click()

        console.log('button clicked')

        // Log metrics
        console.log(`Call Metrics ${this.scenarioId}:`, {
            'Setup Time (ms)': metrics.setupTime,
            'Total Duration (ms)': metrics.totalDuration,
            'Connection Successful': metrics.connectionSuccessful,
            'Audio Statistics': metrics.audioMetrics,
        })

        // Close browser and log after actually closing
        await this.page.close()
        await this.browser.close()
        console.log(`[Scenario ${this.scenarioId}] Browser closed`)

        return {
            success: true
        }
    }

    public async playSound (data: GetActionPayload<PlaySoundAction>): Promise<GetActionResponse<PlaySoundAction>> {
        const soundPath = data.sound
        console.log(`[Scenario ${this.scenarioId}] Playing sound`, soundPath)

        const soundFileName = path.basename(soundPath)

        // Read the file as a Buffer
        const fileData = await fs.readFile(soundPath)

        // Determine MIME type based on file extension
        const mimeTypes = {
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg',
            '.m4a': 'audio/mp4',
            // Add more as needed
        }
        const ext = path.extname(soundPath).toLowerCase()
        const mimeType = mimeTypes[ext] || 'audio/mpeg'

        // Create a data URL
        const base64Data = fileData.toString('base64')
        const dataUrl = `data:${mimeType};base64,${base64Data}`

        // Pass the dataUrl to the browser's playClip function instead of just the filename
        await this.windowMethodsWorker.playClip(dataUrl)

        console.log(`[Scenario ${this.scenarioId}] Sound played: ${soundFileName}`)
        await waitMs(soundPath.length * 100)

        return {
            success: true
        }
    }

    public async request (data: GetActionPayload<RequestAction>): Promise<GetActionResponse<RequestAction>> {
        console.log(`[Scenario ${this.scenarioId}] Executing request action`, data)

        try {
            const response = await this.page.request.fetch(
                data.url,
                data.options
            )

            const responseBody = await response.json()

            console.log('GOT RESPONSE', responseBody)

            return {
                success: response.ok(),
                response: responseBody
            }
        } catch (error) {
            console.error(`[Scenario ${this.scenarioId}] Error during request:`, error)

            const message = error instanceof Error ? error.message : 'Unknown error'

            return {
                success: false,
                error: message
            }
        }
    }
}
