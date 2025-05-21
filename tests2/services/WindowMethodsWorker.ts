/*
import { Page } from 'playwright'

type PlayClipFunction = (url: string) => Promise<void>

declare global {
    interface Window {
        playClip: PlayClipFunction
    }
}

export default class WindowMethodsWorker {
    constructor (
        private readonly page: Page
    ) {}

    public async implementPlayClipMethod () {
        await this.page.addInitScript(() => {
            const realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
            const ctx = new AudioContext()
            const dest = ctx.createMediaStreamDestination()

            navigator.mediaDevices.getUserMedia = async constraints => {
                if (constraints.audio) return dest.stream
                return realGUM(constraints)
            }

            window.playClip = async url => {
                const data = await fetch(url).then(r => r.arrayBuffer())
                const buf = await ctx.decodeAudioData(data)
                const src = ctx.createBufferSource()
                src.buffer = buf
                src.connect(dest)
                src.start()

                return new Promise<void>(res => (src.onended = res))
            }
        })
    }

    public async playClip (url: string): Promise<void> {
        await this.page.evaluate(async (url: string) => {
            if (window.playClip) {
                await window.playClip(url)
            } else {
                throw new Error('playClip method is not implemented')
            }
        }, url)
    }
}
*/
