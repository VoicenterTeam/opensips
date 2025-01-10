import { BaseNewStreamPlugin } from '@/lib/janus/BaseNewStreamPlugin'

export class ScreenSharePlugin extends BaseNewStreamPlugin {
    constructor () {
        super('ScreenShare', 'screen')
    }

    async generateStream () {
        try {
            this.stream = await navigator.mediaDevices.getDisplayMedia()
            this.stream.getVideoTracks()[0].onended = () => {
                this.stopMedia()
            }

            this.session._ua.emit('startScreenShare', {
                stream: this.stream
            })
        } catch (error) {
            await this.stopMedia()
            console.error(error)
        }

        return this.stream
    }

    async kill () {
        await this.stop()

        this.session._ua.emit('stopScreenShare')
    }
}
