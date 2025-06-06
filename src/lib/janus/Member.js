export default class Member {
    plugin = null
    rtcpPeer = null
    handleId = 0
    info = null
    joinResult = null
    state = {}
    stream = null
    //private metrics = null
    loaded = false
    aTracks = []
    vTracks = []

    constructor (memberInfo, plugin) {
        this.info = memberInfo
        this.plugin = plugin
        this.rtcpPeer = new RTCPeerConnection({
            iceServers: []//this.plugin.stunServers,
        })
    }

    get memberInfo () {
        return {
            stream: this.stream,
            joinResult: this.joinResult,
            sender: this.handleId,
            type: 'subscriber',
            name: this.info.display,
            state: this.state,
            id: this.handleId,
        }
    }

    updateMemberState (newState) {
        this.state = {
            ...this.state,
            ...newState || {}
        }

        this.plugin?.session.emit('member:update', this.memberInfo)
    }

    updateMemberStateFromMessage (message) {
        const publisherId = message?.plugindata?.data?.newStatePublisher
        const allPublishers = message?.plugindata?.data?.publisher_state
        const publisherInfo = allPublishers.find(p => p.id === publisherId)
        this.updateMemberState(publisherInfo?.state)
    }

    hangup () {
        if (this.rtcpPeer) {
            this.rtcpPeer.close()
            this.rtcpPeer = null
        }

        if (this.stream) {
            this.stream.getTracks().forEach(track => {
                track.stop()
            })
        }
    }
}
