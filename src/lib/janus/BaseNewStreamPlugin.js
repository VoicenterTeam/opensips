import * as Utils from 'jssip/lib/Utils'
import URI from 'jssip/lib/URI'
import * as SIPMessage from 'jssip/lib/SIPMessage'
import RequestSender from 'jssip/lib/RequestSender'
import P_TYPES from '@/enum/p.types'
import JsSIP_C from 'jssip/lib/Constants'
import { BasePlugin } from '@/lib/janus/BasePlugin'

export class BaseNewStreamPlugin extends BasePlugin {
    constructor (name) {
        super(name)

        this._candidates = []
        this._subscribeSent = false
        this._configureSent = false
        this._lastTrickleReceived = false
    }

    connect (options = {}) {
        this.opaqueId = this.session.generateOpaqueId()

        /*const mediaConstraints = Utils.cloneObject(options.mediaConstraints, {
            audio: true,
            video: true
        })
        const mediaStream = options.mediaStream || null
        const rtcOfferConstraints = options.rtcOfferConstraints || null*/

        const extraHeaders = Utils.cloneArray(options.extraHeaders)

        const requestParams = { from_tag: this.session._from_tag }

        if (options.fromUserName) {
            requestParams.from_uri = new URI('sip', options.fromUserName, this.session._ua.configuration.uri.host)

            extraHeaders.push(`P-Preferred-Identity: ${this.session._ua.configuration.uri.toString()}`)
        }

        if (options.fromDisplayName) {
            requestParams.from_display_name = options.fromDisplayName
        }

        extraHeaders.push(`Contact: ${this.session._contact}`)
        extraHeaders.push('Content-Type: application/json')

        if (this.session._sessionTimers.enabled) {
            extraHeaders.push(`Session-Expires: ${this.session._sessionTimers.defaultExpires}${this.session._ua.configuration.session_timers_force_refresher ? ';refresher=uac' : ''}`)
        }

        this._request = new SIPMessage.InitialOutgoingInviteRequest(
            this.session.target, this.session._ua, requestParams, extraHeaders)


        const pcConfig = Utils.cloneObject(options.pcConfig, { iceServers: [] })
        const rtcConstraints = options.rtcConstraints || null
        this._createRTCConnection(pcConfig, rtcConstraints)

        //this._sendInitialRequest(mediaConstraints, rtcOfferConstraints, mediaStream)
        this._sendInitialRequest()
    }

    _createRTCConnection () {
        this._connection = new RTCPeerConnection({
            iceServers: [
                {
                    urls: 'stun:turn.voicenter.co',
                    credential: 'kxsjahnsdjns3eds23esd',
                    username: 'turn2es21e'
                }
            ],
        })

        let iceCandidateTimeout

        // Send ICE events to Janus.
        this._connection.onicecandidate = (event) => {

            console.log('AAA onicecandidate', event)
            if (this._connection.signalingState !== 'stable' && this._connection.signalingState !== 'have-local-offer') {
                console.log('skipining icecandidate event screensharing ',this._connection.signalingState,event)
                return
            }
            console.log('AAA send trickle')
            /*this.sendTrickle(event.candidate || null)
                .catch((err) => {
                    logger.warn(err)
                })*/

            if (!event.candidate) {
                console.log('AAA onIceCandidate 2')
                return
            }

            this._candidates.push(event.candidate)

            clearTimeout(iceCandidateTimeout)

            // Debounce calling configure request with trickles till the last trickle
            iceCandidateTimeout = setTimeout(() => {
                console.log('AAA setTimeout')
                this._lastTrickleReceived = true

                if (this._subscribeSent && !this._configureSent) {
                    //this.addTracks(this.stream.getTracks())

                    /*this.session._ua.emit('changeScreenShareStream', {
                        name: this.display_name + ' (Screen Share)',
                        stream: this.stream
                    })*/

                    this._sendConfigureMessage({
                        audio: true,
                        video: true,
                    })
                }
            }, 500)
        }
    }

    addTracks (tracks) {
        tracks.forEach((track) => {
            this._connection.addTrack(track)
        })
    }

    async _sendInitialRequest () {
        //this.ackSent = false
        this.publisherSubscribeSent = false

        const request_sender = new RequestSender(this.session._ua, this._request, {
            onRequestTimeout: () => {
                this.session.onRequestTimeout()
            },
            onTransportError: () => {
                this.session.onTransportError()
            },
            // Update the request on authentication.
            onAuthenticated: (request) => {
                this._request = request
            },
            onReceiveResponse: (response) => {
                this._receiveInviteResponse(response)
            }
        })

        await this.generateStream()

        this.addTracks(this.stream.getTracks())

        const options = {
            audio: false,
            video: true,
        }
        this.jsep_offer = await this._connection.createOffer(options)

        await this._connection.setLocalDescription(this.jsep_offer)

        const inviteData = {
            janus: 'attach',
            plugin: 'janus.plugin.videoroom',
            opaque_id: this.opaqueId
        }

        const bodyStringified = JSON.stringify(inviteData)

        this._request.body = bodyStringified

        request_sender.send()
    }

    _receiveInviteResponse (response) {
        if (this._publisherSubscribeSent || !response.body) {
            return
        }

        const parsedBody = JSON.parse(response.body)

        this.handleId = parsedBody.data.id
        //this.client_id = uuidv4()

        const registerBody = {
            janus: 'message',
            body: {
                request: 'join',
                room: this.session.room_id,
                ptype: 'publisher',
                display: this.session.display_name + ' (Screen Share)',
                //clientID: this.client_id,
                opaque_id: this.opaqueId,
            },
            handle_id: this.handleId
        }

        const registerExtraHeaders = [ this.session.getPTypeHeader(P_TYPES.PUBLISHER) ]

        this.session.sendRequest(JsSIP_C.SUBSCRIBE, {
            extraHeaders: registerExtraHeaders,
            body: JSON.stringify(registerBody),
            eventHandlers: {
                onSuccessResponse: async (response) => {
                    if (response.status_code === 200) {
                        this._subscribeSent = true

                        if (response.body) {
                            try {
                                const bodyParsed = JSON.parse(response.body) || {}

                                if (bodyParsed.plugindata?.data?.videoroom === 'joined') {
                                    this.session.myFeedList.push(bodyParsed.plugindata.data.id)
                                }

                                if (bodyParsed.plugindata?.data?.publishers){
                                    this.session.receivePublishers(bodyParsed)
                                }
                            } catch (e) {
                                console.error(e)
                            }
                        }

                        if (this._lastTrickleReceived && !this._configureSent) {
                            //this.addTracks(this.stream.getTracks())

                            /*this.session._ua.emit('changeMainVideoStream', {
                                name: this.display_name,
                                stream: this.stream
                            })*/

                            this._sendConfigureMessage({
                                audio: true,
                                video: true,
                            })
                        }

                        //this.session._ua.emit('conferenceStart')
                    }
                },
            }
        })

        this._publisherSubscribeSent = true
    }

    async _sendConfigureMessage (options) {
        /*const offerOptions = {
            offerToReceiveAudio: false,
            offerToReceiveVideo: false
        }
        const jsepOffer = await this._connection.createOffer(offerOptions)
        await this._connection.setLocalDescription(jsepOffer)*/

        const candidatesArray = this._candidates.map((candidate) => ({
            janus: 'trickle',
            candidate,
            handle_id: this.handleId,
            session_id: this.session.session_id
        }))

        const configureBody = {
            janus: 'message',
            body: {
                request: 'configure',
                record: true,
                filename: this.session.getRecordFileName(),
                ...options
            },
            jsep: this.jsep_offer,
            handle_id: this.handleId,
            session_id: this.session.session_id
        }

        const body = {
            configure: configureBody,
            trickles: [ ...candidatesArray ]
        }

        const extraHeaders = [
            'Content-Type: application/json',
            this.session.getPTypeHeader(P_TYPES.ICE)
        ]

        this.session.sendRequest(JsSIP_C.INFO, {
            extraHeaders,
            body: JSON.stringify(body),
            eventHandlers: {
                onSuccessResponse: async (response) => {
                    console.log('mmm configure response', response)
                    this._configureSent = true
                    const messageData = response.data
                    const messageBody = messageData.split('\r\n')
                    console.log('mmm configure messageBody', messageBody)
                    const data = messageBody[messageBody.length - 1]
                    console.log('mmm configure data', data)
                    const parsed = JSON.parse(data)
                    console.log('mmm configure parsed', parsed)
                    await this._connection.setRemoteDescription(parsed.jsep)
                    //await this.processIceCandidates()
                    this._candidates = []
                },
            }
        })
    }

    _sendDetach () {
        const body = {
            janus: 'detach',
            handle_id: this.handleId,
            session_id: this.session.session_id
        }

        const registerExtraHeaders = [ this.session.getPTypeHeader(P_TYPES.DETACH) ]

        this.session.sendRequest(JsSIP_C.INFO, {
            extraHeaders: registerExtraHeaders,
            body: JSON.stringify(body)
        })

        this.session._ua.emit('pluginDetach', this.name)
    }

    async stopMedia () {
        //await this.detach()
        if (this._connection) {
            this._connection.close()
            this._connection = null
        }
    }

    async stop () {
        const senders = this._connection.getSenders()

        // Iterate through the senders and stop the tracks
        senders.forEach(sender => {
            const track = sender.track
            if (track) {
                track.stop()
            }
        })

        // Optionally, remove the tracks from _connection (if needed)
        senders.forEach(sender => {
            this._connection.removeTrack(sender)
        })

        await this.stopMedia()

        this._sendDetach()

        this.session._ua.emit('stopScreenShare')
    }

    async generateStream () {
        return new MediaStream()
    }
}
