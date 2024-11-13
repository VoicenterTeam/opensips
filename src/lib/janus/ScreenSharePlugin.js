import * as Utils from 'jssip/lib/Utils'
import URI from 'jssip/lib/URI'
import * as SIPMessage from 'jssip/lib/SIPMessage'
import RequestSender from 'jssip/lib/RequestSender'
import P_TYPES from '@/enum/p.types'
import JsSIP_C from 'jssip/lib/Constants'
import { BaseNewStreamPlugin } from '@/lib/janus/BaseNewStreamPlugin'

export class ScreenSharePlugin extends BaseNewStreamPlugin {
    constructor () {
        super('ScreenSharePlugin')
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
        // this.trackMicrophoneVolume()
        return this.stream
    }

    async kill () {
        await this.stop()

        this.session._ua.emit('stopScreenShare')
    }
}
