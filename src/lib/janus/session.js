// /* globals RTCPeerConnection: false, RTCSessionDescription: false */

import { v4 as uuidv4 } from 'uuid'
//const EventEmitter = require('events').EventEmitter
import { EventEmitter } from 'events'
//const sdp_transform = require('sdp-transform')
import sdp_transform from 'sdp-transform'
//const Logger = require('./Logger')
import Logger from 'jssip/lib/Logger'
import JsSIP_C, { SUBSCRIBE } from 'jssip/lib/Constants'
import Exceptions from 'jssip/lib/Exceptions'
import Transactions from 'jssip/lib/Transactions'
import * as Utils from 'jssip/lib/Utils'
//const Timers = require('./Timers')
import Timers from 'jssip/lib/Timers'
import * as SIPMessage from 'jssip/lib/SIPMessage'
//import Dialog from 'jssip/lib/Dialog'
import Dialog from './Dialog'
import Member from './Member'
import RequestSender from 'jssip/lib/RequestSender'
import DeviceManager from '../../helpers/janus/DeviceManager'
//const RTCSession_DTMF = require('./RTCSession/DTMF')
import RTCSession_DTMF from 'jssip/lib/RTCSession/DTMF'
import RTCSession_Info from 'jssip/lib/RTCSession/Info'
//const RTCSession_ReferNotifier = require('./RTCSession/ReferNotifier')
import RTCSession_ReferNotifier from 'jssip/lib/RTCSession/ReferNotifier'
//const RTCSession_ReferSubscriber = require('./RTCSession/ReferSubscriber')
import RTCSession_ReferSubscriber from 'jssip/lib/RTCSession/ReferSubscriber'
import URI from 'jssip/lib/URI'
import P_TYPES from '../../enum/p.types'

const logger = new Logger('JanusSession')

const RECORDING_PATH = '/opt/recordings/'


const C = {
    // JanusSession states.
    STATUS_NULL: 0,
    STATUS_INVITE_SENT: 1,
    STATUS_1XX_RECEIVED: 2,
    STATUS_INVITE_RECEIVED: 3,
    STATUS_WAITING_FOR_ANSWER: 4,
    STATUS_ANSWERED: 5,
    STATUS_WAITING_FOR_ACK: 6,
    STATUS_CANCELED: 7,
    STATUS_TERMINATED: 8,
    STATUS_CONFIRMED: 9
}

/**
 * Local variables.
 */
const holdMediaTypes = [ 'audio', 'video' ]

export default class RTCSession extends EventEmitter {
    /**
     * Expose C object.
     */
    static get C () {
        return C
    }

    constructor (ua) {
        logger.debug('new')

        super()

        this._id = null
        this._ua = ua
        this._status = C.STATUS_NULL
        this._dialog = null
        this._earlyDialogs = {}
        this._contact = null
        this._from_tag = null
        this._to_tag = null

        // Janus: transaction
        this.lastTransaction = 0

        // The RTCPeerConnection instance (public attribute).
        this._connection = null

        // Prevent races on serial PeerConnction operations.
        this._connectionPromiseQueue = Promise.resolve()

        // Incoming/Outgoing request being currently processed.
        this._request = null

        // Cancel state for initial outgoing request.
        this._is_canceled = false
        this._cancel_reason = ''

        // RTCSession confirmation flag.
        this._is_confirmed = false

        // Is late SDP being negotiated.
        this._late_sdp = false

        // Default rtcOfferConstraints and rtcAnswerConstrainsts (passed in connect() or answer()).
        this._rtcOfferConstraints = null
        this._rtcAnswerConstraints = null

        // Local MediaStream.
        this._localMediaStream = null
        this._localMediaStreamLocallyGenerated = false

        // Flag to indicate PeerConnection ready for new actions.
        this._rtcReady = true

        // Flag to indicate ICE candidate gathering is finished even if iceGatheringState is not yet 'complete'.
        this._iceReady = false

        // SIP Timers.
        this._timers = {
            ackTimer: null,
            expiresTimer: null,
            invite2xxTimer: null,
            userNoAnswerTimer: null
        }

        // Session info.
        this._direction = null
        this._local_identity = null
        this._remote_identity = null
        this._start_time = null
        this._end_time = null
        //this._tones = null

        // Mute/Hold state.
        this._audioMuted = false
        this._videoMuted = false
        this._localHold = false
        this._remoteHold = false

        // Session Timers (RFC 4028).
        this._sessionTimers = {
            enabled: this._ua.configuration.session_timers,
            refreshMethod: this._ua.configuration.session_timers_refresh_method,
            defaultExpires: JsSIP_C.SESSION_EXPIRES,
            currentExpires: null,
            running: false,
            refresher: false,
            timer: null // A setTimeout.
        }

        // Map of ReferSubscriber instances indexed by the REFER's CSeq number.
        this._referSubscribers = {}
        this._candidates = []
        this.publishers = []
        this.private_id = null
        this.memberList = {}
        this.myFeedList = []
        this.display_name = ''
        this.stunServers = [ {
            urls: 'stun:turn.voicenter.co',
            credential: 'kxsjahnsdjns3eds23esd',
            username: 'turn2es21e'
        } ]

        this.opaque_id = this.generateOpaqueId()
        this.screen_share_opaque_id = this.generateOpaqueId()

        // Custom session empty object for high level use.
        this._data = {}

        // Media state
        this.isAudioOn = true
        this.isVideoOn = true
        this.mediaConstraints = {}
    }

    /**
     * User API
     */

    // Expose RTCSession constants as a property of the RTCSession instance.
    get C () {
        return C
    }

    // Expose session failed/ended causes as a property of the RTCSession instance.
    get causes () {
        return JsSIP_C.causes
    }

    get id () {
        return this._id
    }

    get connection () {
        return this._connection
    }

    get contact () {
        return this._contact
    }

    get direction () {
        return this._direction
    }

    get local_identity () {
        return this._local_identity
    }

    get remote_identity () {
        return this._remote_identity
    }

    get start_time () {
        return this._start_time
    }

    get end_time () {
        return this._end_time
    }

    get data () {
        return this._data
    }

    set data (_data) {
        this._data = _data
    }

    get status () {
        return this._status
    }

    isInProgress () {
        switch (this._status) {
            case C.STATUS_NULL:
            case C.STATUS_INVITE_SENT:
            case C.STATUS_1XX_RECEIVED:
            case C.STATUS_INVITE_RECEIVED:
            case C.STATUS_WAITING_FOR_ANSWER:
                return true
            default:
                return false
        }
    }

    isEstablished () {
        switch (this._status) {
            case C.STATUS_ANSWERED:
            case C.STATUS_WAITING_FOR_ACK:
            case C.STATUS_CONFIRMED:
                return true
            default:
                return false
        }
    }

    isEnded () {
        switch (this._status) {
            case C.STATUS_CANCELED:
            case C.STATUS_TERMINATED:
                return true
            default:
                return false
        }
    }

    isMuted () {
        return {
            audio: this._audioMuted,
            video: this._videoMuted
        }
    }

    isOnHold () {
        return {
            local: this._localHold,
            remote: this._remoteHold
        }
    }

    getPTypeHeader (type) {
        return `PTYPE: ${type}`
    }

    generateOpaqueId () {
        const opaqueRandomString = uuidv4().replace(/-/g, '').slice(0, 12)
        return `videoroomtest-${opaqueRandomString}`
    }

    connect (target, displayName, options = {}, initCallback) {
        logger.debug('connect()')

        this.display_name = displayName

        const originalTarget = target
        const eventHandlers = Utils.cloneObject(options.eventHandlers)
        const extraHeaders = Utils.cloneArray(options.extraHeaders)
        const mediaConstraints = Utils.cloneObject(options.mediaConstraints, {
            audio: true,
            video: true
        })

        this.mediaConstraints = { ...mediaConstraints }

        const mediaStream = options.mediaStream || null
        const pcConfig = Utils.cloneObject(options.pcConfig, { iceServers: [] })
        const rtcConstraints = options.rtcConstraints || null
        const rtcOfferConstraints = options.rtcOfferConstraints || null

        this._rtcOfferConstraints = rtcOfferConstraints
        this._rtcAnswerConstraints = options.rtcAnswerConstraints || null

        this._data = options.data || this._data

        // Check target.
        if (target === undefined) {
            throw new TypeError('Not enough arguments')
        }

        // Check Session Status.
        if (this._status !== C.STATUS_NULL) {
            throw new Exceptions.InvalidStateError(this._status)
        }

        // Check WebRTC support.
        if (!window.RTCPeerConnection) {
            throw new Exceptions.NotSupportedError('WebRTC not supported')
        }

        // Check target validity.
        target = this._ua.normalizeTarget(target)
        this.room_id = target.user
        this.target = target

        if (!target) {
            throw new TypeError(`Invalid target: ${originalTarget}`)
        }

        // Session Timers.
        if (this._sessionTimers.enabled) {
            if (Utils.isDecimal(options.sessionTimersExpires)) {
                if (options.sessionTimersExpires >= JsSIP_C.MIN_SESSION_EXPIRES) {
                    this._sessionTimers.defaultExpires = options.sessionTimersExpires
                } else {
                    this._sessionTimers.defaultExpires = JsSIP_C.SESSION_EXPIRES
                }
            }
        }

        // Set event handlers.
        for (const event in eventHandlers) {
            if (Object.prototype.hasOwnProperty.call(eventHandlers, event)) {
                this.on(event, eventHandlers[event])
            }
        }

        // Session parameter initialization.
        this._from_tag = Utils.newTag()

        // Set anonymous property.
        const anonymous = options.anonymous || false

        const requestParams = { from_tag: this._from_tag }

        this._contact = this._ua.contact.toString({
            anonymous,
            outbound: true
        })

        if (anonymous) {
            requestParams.from_display_name = 'Anonymous'
            requestParams.from_uri = new URI('sip', 'anonymous', 'anonymous.invalid')

            extraHeaders.push(`P-Preferred-Identity: ${this._ua.configuration.uri.toString()}`)
            extraHeaders.push('Privacy: id')
        } else if (options.fromUserName) {
            requestParams.from_uri = new URI('sip', options.fromUserName, this._ua.configuration.uri.host)

            extraHeaders.push(`P-Preferred-Identity: ${this._ua.configuration.uri.toString()}`)
        }

        if (options.fromDisplayName) {
            requestParams.from_display_name = options.fromDisplayName
        }

        extraHeaders.push(`Contact: ${this._contact}`)
        //extraHeaders.push('Content-Type: application/sdp')
        extraHeaders.push('Content-Type: application/json')
        if (this._sessionTimers.enabled) {
            extraHeaders.push(`Session-Expires: ${this._sessionTimers.defaultExpires}${this._ua.configuration.session_timers_force_refresher ? ';refresher=uac' : ''}`)
        }

        this._request = new SIPMessage.InitialOutgoingInviteRequest(
            target, this._ua, requestParams, extraHeaders)

        this._id = this._request.call_id + this._from_tag

        // Create a new RTCPeerConnection instance.
        this._createRTCConnection(pcConfig, rtcConstraints)

        // Set internal properties.
        this._direction = 'outgoing'
        this._local_identity = this._request.from
        this._remote_identity = this._request.to

        // User explicitly provided a newRTCSession callback for this session.
        if (initCallback) {
            initCallback(this)
        }

        this._newJanusSession('local', this._request)

        this._sendInitialRequest(mediaConstraints, rtcOfferConstraints, mediaStream)
    }

    /*async connectBlur () {
        const options = {
            audio: this.isAudioOn,
            video: this.isVideoOn
        }

        this.streamMask = new StreamMaskPlugin({
            effect: 'backgroundImageEffect',
            mediaConstraints: options,
            base64Image: base64Image ? base64Image : null
        })
        //screenSharePlugin.connect(options)

        //const { stream } = await this.loadStream()

        console.log('options 1', options)

        const stream = await navigator.mediaDevices.getUserMedia(options)

        console.log('options 2', options)

        //bokehEffect
        //backgroundImageEffect
        const canvasStream = await this.streamMask.start(stream)

        this._overrideSenderTracks(canvasStream)

        this._ua.emit('startBlur')

        this._ua.emit('changeMainVideoStream', {
            name: this.display_name,
            stream: canvasStream
        })
    }*/

    /*stopBlur () {
        const originalStream = this.streamMask.stop()
        this._overrideSenderTracks(originalStream)

        this._ua.emit('stopBlur')

        this._ua.emit('changeMainVideoStream', {
            name: this.display_name,
            stream: originalStream
        })
    }*/

    _overrideSenderTracks (stream, connection) {
        stream.getTracks().forEach(track => {
            const senders = connection.getSenders()
            senders.forEach(async (sender) => {
                if (sender.track.kind !== track.kind) {
                    return
                }

                if (track.kind === 'audio' && !this.isAudioOn) {
                    track.enabled = false
                }
                if (track.kind === 'video' && !this.isVideoOn) {
                    track.enabled = false
                }
                await sender.replaceTrack(track)
            })
        })
    }

    init_incoming (request, initCallback) {
        logger.debug('init_incoming()')

        let expires
        const contentType = request.hasHeader('Content-Type') ?
            request.getHeader('Content-Type').toLowerCase() : undefined

        // Check body and content type.
        if (request.body && (contentType !== 'application/sdp')) {
            request.reply(415)

            return
        }

        // Session parameter initialization.
        this._status = C.STATUS_INVITE_RECEIVED
        this._from_tag = request.from_tag
        this._id = request.call_id + this._from_tag
        this._request = request
        this._contact = this._ua.contact.toString()

        // Get the Expires header value if exists.
        if (request.hasHeader('expires')) {
            expires = request.getHeader('expires') * 1000
        }

        /* Set the to_tag before
         * replying a response code that will create a dialog.
         */
        request.to_tag = Utils.newTag()

        // An error on dialog creation will fire 'failed' event.
        if (!this._createDialog(request, 'UAS', true)) {
            request.reply(500, 'Missing Contact header field')

            return
        }

        if (request.body) {
            this._late_sdp = false
        } else {
            this._late_sdp = true
        }

        this._status = C.STATUS_WAITING_FOR_ANSWER

        // Set userNoAnswerTimer.
        this._timers.userNoAnswerTimer = setTimeout(() => {
            request.reply(408)
            this._failed('local', null, JsSIP_C.causes.NO_ANSWER)
        }, this._ua.configuration.no_answer_timeout
        )

        /* Set expiresTimer
         * RFC3261 13.3.1
         */
        if (expires) {
            this._timers.expiresTimer = setTimeout(() => {
                if (this._status === C.STATUS_WAITING_FOR_ANSWER) {
                    request.reply(487)
                    this._failed('system', null, JsSIP_C.causes.EXPIRES)
                }
            }, expires
            )
        }

        // Set internal properties.
        this._direction = 'incoming'
        this._local_identity = request.to
        this._remote_identity = request.from

        // A init callback was specifically defined.
        if (initCallback) {
            initCallback(this)
        }

        // Fire 'newRTCSession' event.
        this._newJanusSession('remote', request)

        // The user may have rejected the call in the 'newRTCSession' event.
        if (this._status === C.STATUS_TERMINATED) {
            return
        }

        // Reply 180.
        request.reply(180, null, [ `Contact: ${this._contact}` ])

        // Fire 'progress' event.
        // TODO: Document that 'response' field in 'progress' event is null for incoming calls.
        this._progress('local', null)
    }

    /**
     * Answer the call.
     */
    answer (options = {}) {
        logger.debug('answer()')

        const request = this._request
        const extraHeaders = Utils.cloneArray(options.extraHeaders)
        const mediaConstraints = Utils.cloneObject(options.mediaConstraints)
        const mediaStream = options.mediaStream || null
        const pcConfig = Utils.cloneObject(options.pcConfig, { iceServers: [] })
        const rtcConstraints = options.rtcConstraints || null
        const rtcAnswerConstraints = options.rtcAnswerConstraints || null
        const rtcOfferConstraints = Utils.cloneObject(options.rtcOfferConstraints)

        let tracks
        let peerHasAudioLine = false
        let peerHasVideoLine = false
        let peerOffersFullAudio = false
        let peerOffersFullVideo = false

        this._rtcAnswerConstraints = rtcAnswerConstraints
        this._rtcOfferConstraints = options.rtcOfferConstraints || null

        this._data = options.data || this._data

        // Check Session Direction and Status.
        if (this._direction !== 'incoming') {
            throw new Exceptions.NotSupportedError('"answer" not supported for outgoing RTCSession')
        }

        // Check Session status.
        if (this._status !== C.STATUS_WAITING_FOR_ANSWER) {
            throw new Exceptions.InvalidStateError(this._status)
        }

        // Session Timers.
        if (this._sessionTimers.enabled) {
            if (Utils.isDecimal(options.sessionTimersExpires)) {
                if (options.sessionTimersExpires >= JsSIP_C.MIN_SESSION_EXPIRES) {
                    this._sessionTimers.defaultExpires = options.sessionTimersExpires
                } else {
                    this._sessionTimers.defaultExpires = JsSIP_C.SESSION_EXPIRES
                }
            }
        }

        this._status = C.STATUS_ANSWERED

        // An error on dialog creation will fire 'failed' event.
        if (!this._createDialog(request, 'UAS')) {
            request.reply(500, 'Error creating dialog')

            return
        }

        clearTimeout(this._timers.userNoAnswerTimer)

        extraHeaders.unshift(`Contact: ${this._contact}`)

        // Determine incoming media from incoming SDP offer (if any).
        const sdp = request.parseSDP()

        // Make sure sdp.media is an array, not the case if there is only one media.
        if (!Array.isArray(sdp.media)) {
            sdp.media = [ sdp.media ]
        }

        // Go through all medias in SDP to find offered capabilities to answer with.
        for (const m of sdp.media) {
            if (m.type === 'audio') {
                peerHasAudioLine = true
                if (!m.direction || m.direction === 'sendrecv') {
                    peerOffersFullAudio = true
                }
            }
            if (m.type === 'video') {
                peerHasVideoLine = true
                if (!m.direction || m.direction === 'sendrecv') {
                    peerOffersFullVideo = true
                }
            }
        }

        // Remove audio from mediaStream if suggested by mediaConstraints.
        if (mediaStream && mediaConstraints.audio === false) {
            tracks = mediaStream.getAudioTracks()
            for (const track of tracks) {
                mediaStream.removeTrack(track)
            }
        }

        // Remove video from mediaStream if suggested by mediaConstraints.
        if (mediaStream && mediaConstraints.video === false) {
            tracks = mediaStream.getVideoTracks()
            for (const track of tracks) {
                mediaStream.removeTrack(track)
            }
        }

        // Set audio constraints based on incoming stream if not supplied.
        if (!mediaStream && mediaConstraints.audio === undefined) {
            mediaConstraints.audio = peerOffersFullAudio
        }

        // Set video constraints based on incoming stream if not supplied.
        if (!mediaStream && mediaConstraints.video === undefined) {
            mediaConstraints.video = peerOffersFullVideo
        }

        // Don't ask for audio if the incoming offer has no audio section.
        if (!mediaStream && !peerHasAudioLine && !rtcOfferConstraints.offerToReceiveAudio) {
            mediaConstraints.audio = false
        }

        // Don't ask for video if the incoming offer has no video section.
        if (!mediaStream && !peerHasVideoLine && !rtcOfferConstraints.offerToReceiveVideo) {
            mediaConstraints.video = false
        }

        // Create a new RTCPeerConnection instance.
        // TODO: This may throw an error, should react.
        this._createRTCConnection(pcConfig, rtcConstraints)

        Promise.resolve()
            // Handle local MediaStream.
            .then(() => {
                // A local MediaStream is given, use it.
                if (mediaStream) {
                    return mediaStream
                } else if (mediaConstraints.audio || mediaConstraints.video) {
                    // Audio and/or video requested, prompt getUserMedia.
                    this._localMediaStreamLocallyGenerated = true

                    return this.loadStream()//navigator.mediaDevices.getUserMedia(mediaConstraints)
                        .catch((error) => {
                            if (this._status === C.STATUS_TERMINATED) {
                                throw new Error('terminated')
                            }

                            request.reply(480)
                            this._failed('local', null, JsSIP_C.causes.USER_DENIED_MEDIA_ACCESS)

                            logger.warn('emit "getusermediafailed" [error:%o]', error)

                            this.emit('getusermediafailed', error)

                            throw new Error('getUserMedia() failed')
                        })
                }
            })
            // Attach MediaStream to RTCPeerconnection.
            .then((stream) => {
                if (this._status === C.STATUS_TERMINATED) {
                    throw new Error('terminated')
                }

                this._localMediaStream = stream
                if (stream) {
                    stream.getTracks().forEach((track) => {
                        this._connection.addTrack(track, stream)
                    })
                }
            })
            // Set remote description.
            .then(() => {
                if (this._late_sdp) {
                    return
                }

                const e = {
                    originator: 'remote',
                    type: 'offer',
                    sdp: request.body
                }

                logger.debug('emit "sdp"')
                this.emit('sdp', e)

                const offer = new RTCSessionDescription({
                    type: 'offer',
                    sdp: e.sdp
                })

                this._connectionPromiseQueue = this._connectionPromiseQueue
                    .then(() => this._connection.setRemoteDescription(offer))
                    .catch((error) => {
                        request.reply(488)

                        this._failed('system', null, JsSIP_C.causes.WEBRTC_ERROR)

                        logger.warn('emit "peerconnection:setremotedescriptionfailed" [error:%o]', error)

                        this.emit('peerconnection:setremotedescriptionfailed', error)

                        throw new Error('peerconnection.setRemoteDescription() failed')
                    })

                return this._connectionPromiseQueue
            })
            // Create local description.
            .then(() => {
                if (this._status === C.STATUS_TERMINATED) {
                    throw new Error('terminated')
                }

                // TODO: Is this event already useful?
                this._connecting(request)

                if (!this._late_sdp) {
                    return this._createLocalDescription('answer', rtcAnswerConstraints)
                        .catch(() => {
                            request.reply(500)

                            throw new Error('_createLocalDescription() failed')
                        })
                } else {
                    return this._createLocalDescription('offer', this._rtcOfferConstraints)
                        .catch(() => {
                            request.reply(500)

                            throw new Error('_createLocalDescription() failed')
                        })
                }
            })
            // Send reply.
            .then((desc) => {
                if (this._status === C.STATUS_TERMINATED) {
                    throw new Error('terminated')
                }

                this._handleSessionTimersInIncomingRequest(request, extraHeaders)

                request.reply(200, null, extraHeaders,
                    desc,
                    () => {
                        this._status = C.STATUS_WAITING_FOR_ACK

                        this._setInvite2xxTimer(request, desc)
                        this._setACKTimer()
                        this._accepted('local')
                    },
                    () => {
                        this._failed('system', null, JsSIP_C.causes.CONNECTION_ERROR)
                    }
                )
            })
            .catch((error) => {
                if (this._status === C.STATUS_TERMINATED) {
                    return
                }

                logger.warn(error)
            })
    }

    /**
     * Terminate the call.
     */
    terminate (options = {}) {
        logger.debug('terminate()')

        const cause = options.cause || JsSIP_C.causes.BYE
        const extraHeaders = Utils.cloneArray(options.extraHeaders)
        const body = options.body

        let cancel_reason
        let status_code = options.status_code
        let reason_phrase = options.reason_phrase

        // Check Session Status.
        if (this._status === C.STATUS_TERMINATED) {
            throw new Exceptions.InvalidStateError(this._status)
        }

        switch (this._status) {
            // - UAC -
            case C.STATUS_NULL:
            case C.STATUS_INVITE_SENT:
            case C.STATUS_1XX_RECEIVED:
                logger.debug('canceling session')

                if (status_code && (status_code < 200 || status_code >= 700)) {
                    throw new TypeError(`Invalid status_code: ${status_code}`)
                } else if (status_code) {
                    reason_phrase = reason_phrase || JsSIP_C.REASON_PHRASE[status_code] || ''
                    cancel_reason = `SIP ;cause=${status_code} ;text="${reason_phrase}"`
                }

                // Check Session Status.
                if (this._status === C.STATUS_NULL || this._status === C.STATUS_INVITE_SENT) {
                    this._is_canceled = true
                    this._cancel_reason = cancel_reason
                } else if (this._status === C.STATUS_1XX_RECEIVED) {
                    this._request.cancel(cancel_reason)
                }

                this._status = C.STATUS_CANCELED

                this._failed('local', null, JsSIP_C.causes.CANCELED)
                break

            // - UAS -
            case C.STATUS_WAITING_FOR_ANSWER:
            case C.STATUS_ANSWERED:
                logger.debug('rejecting session')

                status_code = status_code || 480

                if (status_code < 300 || status_code >= 700) {
                    throw new TypeError(`Invalid status_code: ${status_code}`)
                }

                this._request.reply(status_code, reason_phrase, extraHeaders, body)
                this._failed('local', null, JsSIP_C.causes.REJECTED)
                break

            case C.STATUS_WAITING_FOR_ACK:
            case C.STATUS_CONFIRMED:
                logger.debug('terminating session')

                reason_phrase = options.reason_phrase || JsSIP_C.REASON_PHRASE[status_code] || ''

                if (status_code && (status_code < 200 || status_code >= 700)) {
                    throw new TypeError(`Invalid status_code: ${status_code}`)
                } else if (status_code) {
                    extraHeaders.push(`Reason: SIP ;cause=${status_code}; text="${reason_phrase}"`)
                }

                /* RFC 3261 section 15 (Terminating a session):
                  *
                  * "...the callee's UA MUST NOT send a BYE on a confirmed dialog
                  * until it has received an ACK for its 2xx response or until the server
                  * transaction times out."
                  */
                if (this._status === C.STATUS_WAITING_FOR_ACK &&
                    this._direction === 'incoming' &&
                    this._request.server_transaction.state !== Transactions.C.STATUS_TERMINATED) {

                    // Save the dialog for later restoration.
                    const dialog = this._dialog

                    // Send the BYE as soon as the ACK is received...
                    this.receiveRequest = ({ method }) => {
                        if (method === JsSIP_C.ACK) {
                            this.sendRequest(JsSIP_C.BYE, {
                                extraHeaders,
                                body
                            })
                            dialog.terminate()
                            this.closeSession()
                        }
                    }

                    // .., or when the INVITE transaction times out
                    this._request.server_transaction.on('stateChanged', () => {
                        if (this._request.server_transaction.state ===
                            Transactions.C.STATUS_TERMINATED) {
                            this.sendRequest(JsSIP_C.BYE, {
                                extraHeaders,
                                body
                            })
                            dialog.terminate()
                            this.closeSession()
                        }
                    })

                    this._ended('local', null, cause)

                    // Restore the dialog into 'this' in order to be able to send the in-dialog BYE :-).
                    this._dialog = dialog

                    // Restore the dialog into 'ua' so the ACK can reach 'this' session.
                    this._ua.newDialog(dialog)
                } else {
                    const byeBody = {
                        janus: 'leave'
                    }

                    const extraHeaders = [
                        'Content-Type: application/json',
                        this.getPTypeHeader(P_TYPES.LEAVE)
                    ]

                    this.sendRequest(JsSIP_C.BYE, {
                        extraHeaders,
                        body: JSON.stringify(byeBody)
                    })

                    this.closeSession()
                    this._ended('local', null, cause)
                }
        }
    }

    configureMedia (settings) {
        this.isAudioOn = settings.audio
        this.isVideoOn = settings.video
    }

    enableAudio (state) {
        const body = {
            janus: 'message',
            body: {
                audio: state
            },
            handle_id: this.handle_id,
            session_id: this.session_id
        }

        const extraHeaders = [
            'Content-Type: application/json',
            this.getPTypeHeader(P_TYPES.AUDIO_CHANGE)
        ]

        this.sendRequest(JsSIP_C.INFO, {
            extraHeaders,
            body: JSON.stringify(body),
            eventHandlers: {
                onSuccessResponse: async (response) => {
                    if (response.status_code === 200) {
                        this._ua.emit('changeAudioState', state)

                        this.sendStateMessage({
                            audio: state
                        })
                    }
                },
            }
        })
    }

    startAudio () {
        DeviceManager.toggleAudioMute(this.stream)
        this._toggleMuteAudio(false)
        this.enableAudio(true)
        this.isAudioOn = true
    }

    stopAudio () {
        DeviceManager.toggleAudioMute(this.stream)
        this._toggleMuteAudio(true)
        this.enableAudio(false)
        this.isAudioOn = false
    }

    enableVideo (state) {
        const body = {
            janus: 'message',
            body: {
                video: state
            },
            handle_id: this.handle_id,
            session_id: this.session_id
        }

        const extraHeaders = [
            'Content-Type: application/json',
            this.getPTypeHeader(P_TYPES.VIDEO_CHANGE)
        ]

        this.sendRequest(JsSIP_C.INFO, {
            extraHeaders,
            body: JSON.stringify(body),
            eventHandlers: {
                onSuccessResponse: async (response) => {
                    if (response.status_code === 200) {
                        this._ua.emit('changeVideoState', state)

                        this.sendStateMessage({
                            video: state
                        })
                    }
                },
            }
        })
    }

    startVideo () {
        DeviceManager.toggleVideoMute(this.stream)
        this._toggleMuteVideo(false)
        this.enableVideo(true)
        this.isVideoOn = true
    }

    stopVideo () {
        DeviceManager.toggleVideoMute(this.stream)
        // do track.stop() instead of track.enabled = false
        this._toggleMuteVideo(true)
        this.enableVideo(false)
        this.isVideoOn = false
    }


    sendStateMessage (data) {
        const body = {
            janus: 'message',
            body: {
                request: 'state',
                data,
            },
            handle_id: this.handle_id,
            session_id: this.session_id
        }

        const extraHeaders = [
            'Content-Type: application/json',
            this.getPTypeHeader(P_TYPES.STATE)
        ]

        this.sendRequest(JsSIP_C.INFO, {
            extraHeaders,
            body: JSON.stringify(body)
        })
    }

    /*sendDTMF (tones, options = {}) {
        logger.debug('sendDTMF() | tones: %s', tones)

        let position = 0
        let duration = options.duration || null
        let interToneGap = options.interToneGap || null
        const transportType = options.transportType || JsSIP_C.DTMF_TRANSPORT.INFO

        if (tones === undefined) {
            throw new TypeError('Not enough arguments')
        }

        // Check Session Status.
        if (
            this._status !== C.STATUS_CONFIRMED &&
            this._status !== C.STATUS_WAITING_FOR_ACK &&
            this._status !== C.STATUS_1XX_RECEIVED
        ) {
            throw new Exceptions.InvalidStateError(this._status)
        }

        // Check Transport type.
        if (
            transportType !== JsSIP_C.DTMF_TRANSPORT.INFO &&
            transportType !== JsSIP_C.DTMF_TRANSPORT.RFC2833
        ) {
            throw new TypeError(`invalid transportType: ${transportType}`)
        }

        // Convert to string.
        if (typeof tones === 'number') {
            tones = tones.toString()
        }

        // Check tones.
        if (!tones || typeof tones !== 'string' || !tones.match(/^[0-9A-DR#*,]+$/i)) {
            throw new TypeError(`Invalid tones: ${tones}`)
        }

        // Check duration.
        if (duration && !Utils.isDecimal(duration)) {
            throw new TypeError(`Invalid tone duration: ${duration}`)
        } else if (!duration) {
            duration = RTCSession_DTMF.C.DEFAULT_DURATION
        } else if (duration < RTCSession_DTMF.C.MIN_DURATION) {
            logger.debug(`"duration" value is lower than the minimum allowed, setting it to ${RTCSession_DTMF.C.MIN_DURATION} milliseconds`)
            duration = RTCSession_DTMF.C.MIN_DURATION
        } else if (duration > RTCSession_DTMF.C.MAX_DURATION) {
            logger.debug(`"duration" value is greater than the maximum allowed, setting it to ${RTCSession_DTMF.C.MAX_DURATION} milliseconds`)
            duration = RTCSession_DTMF.C.MAX_DURATION
        } else {
            duration = Math.abs(duration)
        }
        options.duration = duration

        // Check interToneGap.
        if (interToneGap && !Utils.isDecimal(interToneGap)) {
            throw new TypeError(`Invalid interToneGap: ${interToneGap}`)
        } else if (!interToneGap) {
            interToneGap = RTCSession_DTMF.C.DEFAULT_INTER_TONE_GAP
        } else if (interToneGap < RTCSession_DTMF.C.MIN_INTER_TONE_GAP) {
            logger.debug(`"interToneGap" value is lower than the minimum allowed, setting it to ${RTCSession_DTMF.C.MIN_INTER_TONE_GAP} milliseconds`)
            interToneGap = RTCSession_DTMF.C.MIN_INTER_TONE_GAP
        } else {
            interToneGap = Math.abs(interToneGap)
        }

        // RFC2833. Let RTCDTMFSender enqueue the DTMFs.
        if (transportType === JsSIP_C.DTMF_TRANSPORT.RFC2833) {
            // Send DTMF in current audio RTP stream.
            const sender = this._getDTMFRTPSender()

            if (sender) {
                // Add remaining buffered tones.
                tones = sender.toneBuffer + tones
                // Insert tones.
                sender.insertDTMF(tones, duration, interToneGap)
            }

            return
        }

        if (this._tones) {
            // Tones are already queued, just add to the queue.
            this._tones += tones

            return
        }

        this._tones = tones

        // Send the first tone.
        _sendDTMF.call(this)

        function _sendDTMF () {
            let timeout

            if (this._status === C.STATUS_TERMINATED ||
                !this._tones || position >= this._tones.length) {
                // Stop sending DTMF.
                this._tones = null

                return
            }

            const tone = this._tones[position]

            position += 1

            if (tone === ',') {
                timeout = 2000
            } else {
                // Send DTMF via SIP INFO messages.
                const dtmf = new RTCSession_DTMF(this)

                options.eventHandlers = {
                    onFailed: () => { this._tones = null }
                }
                dtmf.send(tone, options)
                timeout = duration + interToneGap
            }

            // Set timeout for the next tone.
            setTimeout(_sendDTMF.bind(this), timeout)
        }
    }*/

    sendInfo (contentType, body, options = {}) {
        logger.debug('sendInfo()')

        // Check Session Status.
        if (
            this._status !== C.STATUS_CONFIRMED &&
            this._status !== C.STATUS_WAITING_FOR_ACK &&
            this._status !== C.STATUS_1XX_RECEIVED
        ) {
            throw new Exceptions.InvalidStateError(this._status)
        }

        const info = new RTCSession_Info(this)

        info.send(contentType, body, options)
    }

    /**
     * Mute
     */
    mute (options = {
        audio: true,
        video: false
    }) {
        logger.debug('mute()')

        let audioMuted = false, videoMuted = false

        if (this._audioMuted === false && options.audio) {
            audioMuted = true
            this._audioMuted = true
            this._toggleMuteAudio(true)
        }

        if (this._videoMuted === false && options.video) {
            videoMuted = true
            this._videoMuted = true
            this._toggleMuteVideo(true)
        }

        if (audioMuted === true || videoMuted === true) {
            this._onmute({
                audio: audioMuted,
                video: videoMuted
            })
        }
    }

    /**
     * Unmute
     */
    unmute (options = {
        audio: true,
        video: true
    }) {
        logger.debug('unmute()')

        let audioUnMuted = false, videoUnMuted = false

        if (this._audioMuted === true && options.audio) {
            audioUnMuted = true
            this._audioMuted = false

            if (this._localHold === false) {
                this._toggleMuteAudio(false)
            }
        }

        if (this._videoMuted === true && options.video) {
            videoUnMuted = true
            this._videoMuted = false

            if (this._localHold === false) {
                this._toggleMuteVideo(false)
            }
        }

        if (audioUnMuted === true || videoUnMuted === true) {
            this._onunmute({
                audio: audioUnMuted,
                video: videoUnMuted
            })
        }
    }

    /**
     * Hold
     */
    hold (options = {}, done) {
        logger.debug('hold()')

        if (this._status !== C.STATUS_WAITING_FOR_ACK && this._status !== C.STATUS_CONFIRMED) {
            return false
        }

        if (this._localHold === true) {
            return false
        }

        if (!this._isReadyToReOffer()) {
            return false
        }

        this._localHold = true
        this._onhold('local')

        const eventHandlers = {
            succeeded: () => {
                if (done) { done() }
            },
            failed: () => {
                this.terminate({
                    cause: JsSIP_C.causes.WEBRTC_ERROR,
                    status_code: 500,
                    reason_phrase: 'Hold Failed'
                })
            }
        }

        if (options.useUpdate) {
            this._sendUpdate({
                sdpOffer: true,
                eventHandlers,
                extraHeaders: options.extraHeaders
            })
        } else {
            this._sendReinvite({
                eventHandlers,
                extraHeaders: options.extraHeaders
            })
        }

        return true
    }

    unhold (options = {}, done) {
        logger.debug('unhold()')

        if (this._status !== C.STATUS_WAITING_FOR_ACK && this._status !== C.STATUS_CONFIRMED) {
            return false
        }

        if (this._localHold === false) {
            return false
        }

        if (!this._isReadyToReOffer()) {
            return false
        }

        this._localHold = false
        this._onunhold('local')

        const eventHandlers = {
            succeeded: () => {
                if (done) { done() }
            },
            failed: () => {
                this.terminate({
                    cause: JsSIP_C.causes.WEBRTC_ERROR,
                    status_code: 500,
                    reason_phrase: 'Unhold Failed'
                })
            }
        }

        if (options.useUpdate) {
            this._sendUpdate({
                sdpOffer: true,
                eventHandlers,
                extraHeaders: options.extraHeaders
            })
        } else {
            this._sendReinvite({
                eventHandlers,
                extraHeaders: options.extraHeaders
            })
        }

        return true
    }

    renegotiate (options = {}, done) {
        logger.debug('renegotiate()')

        const rtcOfferConstraints = options.rtcOfferConstraints || null

        if (this._status !== C.STATUS_WAITING_FOR_ACK && this._status !== C.STATUS_CONFIRMED) {
            return false
        }

        if (!this._isReadyToReOffer()) {
            return false
        }

        const eventHandlers = {
            succeeded: () => {
                if (done) { done() }
            },
            failed: () => {
                this.terminate({
                    cause: JsSIP_C.causes.WEBRTC_ERROR,
                    status_code: 500,
                    reason_phrase: 'Media Renegotiation Failed'
                })
            }
        }

        this._setLocalMediaStatus()

        if (options.useUpdate) {
            this._sendUpdate({
                sdpOffer: true,
                eventHandlers,
                rtcOfferConstraints,
                extraHeaders: options.extraHeaders
            })
        } else {
            this._sendReinvite({
                eventHandlers,
                rtcOfferConstraints,
                extraHeaders: options.extraHeaders
            })
        }

        return true
    }

    /**
     * Refer
     */
    refer (target, options) {
        logger.debug('refer()')

        const originalTarget = target

        if (this._status !== C.STATUS_WAITING_FOR_ACK && this._status !== C.STATUS_CONFIRMED) {
            return false
        }

        // Check target validity.
        target = this._ua.normalizeTarget(target)
        if (!target) {
            throw new TypeError(`Invalid target: ${originalTarget}`)
        }

        const referSubscriber = new RTCSession_ReferSubscriber(this)

        referSubscriber.sendRefer(target, options)

        // Store in the map.
        const id = referSubscriber.id

        this._referSubscribers[id] = referSubscriber

        // Listen for ending events so we can remove it from the map.
        referSubscriber.on('requestFailed', () => {
            delete this._referSubscribers[id]
        })
        referSubscriber.on('accepted', () => {
            delete this._referSubscribers[id]
        })
        referSubscriber.on('failed', () => {
            delete this._referSubscribers[id]
        })

        return referSubscriber
    }

    /**
     * Send a generic in-dialog Request
     */
    sendRequest (method, options) {
        logger.debug('sendRequest()')

        return this._dialog.sendRequest(method, options)
    }

    receiveNotify (request) {
        logger.debug('receiveRequest()')
    }

    /**
     * In dialog Request Reception
     */
    receiveRequest (request) {
        logger.debug('receiveRequest()')

        if (request.method === JsSIP_C.CANCEL) {
            /* RFC3261 15 States that a UAS may have accepted an invitation while a CANCEL
            * was in progress and that the UAC MAY continue with the session established by
            * any 2xx response, or MAY terminate with BYE. JsSIP does continue with the
            * established session. So the CANCEL is processed only if the session is not yet
            * established.
            */

            /*
            * Terminate the whole session in case the user didn't accept (or yet send the answer)
            * nor reject the request opening the session.
            */
            if (this._status === C.STATUS_WAITING_FOR_ANSWER ||
                this._status === C.STATUS_ANSWERED) {
                this._status = C.STATUS_CANCELED
                this._request.reply(487)
                this._failed('remote', request, JsSIP_C.causes.CANCELED)
            }
        } else {
            // Requests arriving here are in-dialog requests.
            switch (request.method) {
                case JsSIP_C.ACK:
                    if (this._status !== C.STATUS_WAITING_FOR_ACK) {
                        return
                    }

                    // Update signaling status.
                    this._status = C.STATUS_CONFIRMED

                    clearTimeout(this._timers.ackTimer)
                    clearTimeout(this._timers.invite2xxTimer)

                    if (this._late_sdp) {
                        if (!request.body) {
                            this.terminate({
                                cause: JsSIP_C.causes.MISSING_SDP,
                                status_code: 400
                            })
                            break
                        }

                        const e = {
                            originator: 'remote',
                            type: 'answer',
                            sdp: request.body
                        }

                        logger.debug('emit "sdp"')
                        this.emit('sdp', e)

                        const answer = new RTCSessionDescription({
                            type: 'answer',
                            sdp: e.sdp
                        })

                        this._connectionPromiseQueue = this._connectionPromiseQueue
                            .then(() => this._connection.setRemoteDescription(answer))
                            .then(() => {
                                if (!this._is_confirmed) {
                                    this._confirmed('remote', request)
                                }
                            })
                            .catch((error) => {
                                this.terminate({
                                    cause: JsSIP_C.causes.BAD_MEDIA_DESCRIPTION,
                                    status_code: 488
                                })

                                logger.warn('emit "peerconnection:setremotedescriptionfailed" [error:%o]', error)
                                this.emit('peerconnection:setremotedescriptionfailed', error)
                            })
                    } else
                    if (!this._is_confirmed) {
                        this._confirmed('remote', request)
                    }

                    break
                case JsSIP_C.BYE:
                    if (this._status === C.STATUS_CONFIRMED ||
                        this._status === C.STATUS_WAITING_FOR_ACK) {
                        request.reply(200)
                        this._ended('remote', request, JsSIP_C.causes.BYE)
                    } else if (this._status === C.STATUS_INVITE_RECEIVED ||
                        this._status === C.STATUS_WAITING_FOR_ANSWER) {
                        request.reply(200)
                        this._request.reply(487, 'BYE Received')
                        this._ended('remote', request, JsSIP_C.causes.BYE)
                    } else {
                        request.reply(403, 'Wrong Status')
                    }
                    break
                case JsSIP_C.INVITE:
                    if (this._status === C.STATUS_CONFIRMED) {
                        if (request.hasHeader('replaces')) {
                            this._receiveReplaces(request)
                        } else {
                            this._receiveReinvite(request)
                        }
                    } else {
                        request.reply(403, 'Wrong Status')
                    }
                    break
                case JsSIP_C.INFO:
                    if (this._status === C.STATUS_1XX_RECEIVED ||
                        this._status === C.STATUS_WAITING_FOR_ANSWER ||
                        this._status === C.STATUS_ANSWERED ||
                        this._status === C.STATUS_WAITING_FOR_ACK ||
                        this._status === C.STATUS_CONFIRMED) {
                        const contentType = request.hasHeader('Content-Type') ?
                            request.getHeader('Content-Type').toLowerCase() : undefined

                        if (contentType && (contentType.match(/^application\/dtmf-relay/i))) {
                            new RTCSession_DTMF(this).init_incoming(request)
                        } else if (contentType !== undefined) {
                            new RTCSession_Info(this).init_incoming(request)
                        } else {
                            request.reply(415)
                        }
                    } else {
                        request.reply(403, 'Wrong Status')
                    }
                    break
                case JsSIP_C.UPDATE:
                    if (this._status === C.STATUS_CONFIRMED) {
                        this._receiveUpdate(request)
                    } else {
                        request.reply(403, 'Wrong Status')
                    }
                    break
                case JsSIP_C.REFER:
                    if (this._status === C.STATUS_CONFIRMED) {
                        this._receiveRefer(request)
                    } else {
                        request.reply(403, 'Wrong Status')
                    }
                    break
                case JsSIP_C.NOTIFY:
                    if (this._status === C.STATUS_CONFIRMED) {
                        this._receiveNotify(request)
                    } else {
                        request.reply(403, 'Wrong Status')
                    }
                    break
                default:
                    request.reply(501)
            }
        }
    }

    /**
     * Session Callbacks
     */

    onTransportError () {
        logger.warn('onTransportError()')

        if (this._status !== C.STATUS_TERMINATED) {
            this.terminate({
                status_code: 500,
                reason_phrase: JsSIP_C.causes.CONNECTION_ERROR,
                cause: JsSIP_C.causes.CONNECTION_ERROR
            })
        }
    }

    onRequestTimeout () {
        logger.warn('onRequestTimeout()')

        if (this._status !== C.STATUS_TERMINATED) {
            this.terminate({
                status_code: 408,
                reason_phrase: JsSIP_C.causes.REQUEST_TIMEOUT,
                cause: JsSIP_C.causes.REQUEST_TIMEOUT
            })
        }
    }

    onDialogError () {
        logger.warn('onDialogError()')

        if (this._status !== C.STATUS_TERMINATED) {
            this.terminate({
                status_code: 500,
                reason_phrase: JsSIP_C.causes.DIALOG_ERROR,
                cause: JsSIP_C.causes.DIALOG_ERROR
            })
        }
    }

    // Called from DTMF handler.
    newDTMF (data) {
        logger.debug('newDTMF()')

        this.emit('newDTMF', data)
    }

    // Called from Info handler.
    newInfo (data) {
        logger.debug('newInfo()')

        this.emit('newInfo', data)
    }

    /**
     * Check if RTCSession is ready for an outgoing re-INVITE or UPDATE with SDP.
     */
    _isReadyToReOffer () {
        if (!this._rtcReady) {
            logger.debug('_isReadyToReOffer() | internal WebRTC status not ready')

            return false
        }

        // No established yet.
        if (!this._dialog) {
            logger.debug('_isReadyToReOffer() | session not established yet')

            return false
        }

        // Another INVITE transaction is in progress.
        if (this._dialog.uac_pending_reply === true ||
            this._dialog.uas_pending_reply === true) {
            logger.debug('_isReadyToReOffer() | there is another INVITE/UPDATE transaction in progress')

            return false
        }

        return true
    }

    _close () {
        logger.debug('close()')

        // Close local MediaStream if it was not given by the user.
        if (this._localMediaStream && this._localMediaStreamLocallyGenerated) {
            logger.debug('close() | closing local MediaStream')

            Utils.closeMediaStream(this._localMediaStream)
        }

        if (this._status === C.STATUS_TERMINATED) {
            return
        }

        this._status = C.STATUS_TERMINATED

        // Terminate RTC.
        if (this._connection) {
            try {
                this._connection.close()
            } catch (error) {
                logger.warn('close() | error closing the RTCPeerConnection: %o', error)
            }
        }

        // Terminate signaling.

        // Clear SIP timers.
        for (const timer in this._timers) {
            if (Object.prototype.hasOwnProperty.call(this._timers, timer)) {
                clearTimeout(this._timers[timer])
            }
        }

        // Clear Session Timers.
        clearTimeout(this._sessionTimers.timer)

        // Terminate confirmed dialog.
        if (this._dialog) {
            this._dialog.terminate()
            delete this._dialog
        }

        // Terminate early dialogs.
        for (const dialog in this._earlyDialogs) {
            if (Object.prototype.hasOwnProperty.call(this._earlyDialogs, dialog)) {
                this._earlyDialogs[dialog].terminate()
                delete this._earlyDialogs[dialog]
            }
        }

        // Terminate REFER subscribers.
        for (const subscriber in this._referSubscribers) {
            if (Object.prototype.hasOwnProperty.call(this._referSubscribers, subscriber)) {
                delete this._referSubscribers[subscriber]
            }
        }

        this._ua.destroyRTCSession(this)
    }

    /**
     * Private API.
     */

    /**
     * RFC3261 13.3.1.4
     * Response retransmissions cannot be accomplished by transaction layer
     *  since it is destroyed when receiving the first 2xx answer
     */
    _setInvite2xxTimer (request, body) {
        let timeout = Timers.T1

        function invite2xxRetransmission () {
            if (this._status !== C.STATUS_WAITING_FOR_ACK) {
                return
            }

            request.reply(200, null, [ `Contact: ${this._contact}` ], body)

            if (timeout < Timers.T2) {
                timeout = timeout * 2
                if (timeout > Timers.T2) {
                    timeout = Timers.T2
                }
            }

            this._timers.invite2xxTimer = setTimeout(
                invite2xxRetransmission.bind(this), timeout)
        }

        this._timers.invite2xxTimer = setTimeout(
            invite2xxRetransmission.bind(this), timeout)
    }


    /**
     * RFC3261 14.2
     * If a UAS generates a 2xx response and never receives an ACK,
     *  it SHOULD generate a BYE to terminate the dialog.
     */
    _setACKTimer () {
        this._timers.ackTimer = setTimeout(() => {
            if (this._status === C.STATUS_WAITING_FOR_ACK) {
                logger.debug('no ACK received, terminating the session')

                clearTimeout(this._timers.invite2xxTimer)
                this.sendRequest(JsSIP_C.BYE)
                this._ended('remote', null, JsSIP_C.causes.NO_ACK)
            }
        }, Timers.TIMER_H)
    }

    _createRTCConnection (pcConfig, rtcConstraints) {
        const config = {
            iceServers: this.stunServers,
            sdpSemantics: 'unified-plan',
        }
        this._connection = new RTCPeerConnection(pcConfig, rtcConstraints)

        this._connection.addEventListener('iceconnectionstatechange', () => {
            const state = this._connection.iceConnectionState

            // TODO: Do more with different states.
            if (state === 'failed') {
                this.terminate({
                    cause: JsSIP_C.causes.RTP_TIMEOUT,
                    status_code: 408,
                    reason_phrase: JsSIP_C.causes.RTP_TIMEOUT
                })
            }
        })

        let iceCandidateTimeout

        const onIceCandidate = (event) => {
            if (this._connection.signalingState !== 'stable' && this._connection.signalingState !== 'have-local-offer') {
                return
            }
            if (!event.candidate) {
                return
            }

            this._candidates.push(event.candidate)

            clearTimeout(iceCandidateTimeout)

            // Debounce calling configure request with trickles till the last trickle
            iceCandidateTimeout = setTimeout(() => {
                this.lastTrickleReceived = true

                if (this.subscribeSent && !this.isConfigureSent) {
                    this.addTracks(this.stream.getTracks())

                    this._ua.emit('changeMainVideoStream', {
                        name: this.display_name,
                        stream: this.stream
                    })

                    this._sendConfigureMessage({
                        audio: true,
                        video: true,
                    }).then(() => {
                        //this.sendInitialState()
                    })
                }
            }, 500)
        }

        this._connection.onicecandidate = onIceCandidate

        logger.debug('emit "peerconnection"')

        this.emit('peerconnection', {
            peerconnection: this._connection
        })
    }

    _createLocalDescription (type, constraints) {
        logger.debug('createLocalDescription()')

        if (type !== 'offer' && type !== 'answer')
            throw new Error(`createLocalDescription() | invalid type "${type}"`)

        const connection = this._connection

        this._rtcReady = false

        return Promise.resolve()
            // Create Offer or Answer.
            .then(() => {
                if (type === 'offer') {
                    return connection.createOffer(constraints)
                        .catch((error) => {
                            logger.warn('emit "peerconnection:createofferfailed" [error:%o]', error)

                            this.emit('peerconnection:createofferfailed', error)

                            return Promise.reject(error)
                        })
                } else {
                    return connection.createAnswer(constraints)
                        .catch((error) => {
                            logger.warn('emit "peerconnection:createanswerfailed" [error:%o]', error)

                            this.emit('peerconnection:createanswerfailed', error)

                            return Promise.reject(error)
                        })
                }
            })
            // Set local description.
            .then((desc) => {
                this.jsepOffer = desc
                return connection.setLocalDescription(desc)
                    .catch((error) => {
                        this._rtcReady = true

                        logger.warn('emit "peerconnection:setlocaldescriptionfailed" [error:%o]', error)

                        this.emit('peerconnection:setlocaldescriptionfailed', error)

                        return Promise.reject(error)
                    })
            })
            .then(() => {
                // Resolve right away if 'pc.iceGatheringState' is 'complete'.
                /**
                 * Resolve right away if:
                 * - 'connection.iceGatheringState' is 'complete' and no 'iceRestart' constraint is set.
                 * - 'connection.iceGatheringState' is 'gathering' and 'iceReady' is true.
                 */
                const iceRestart = constraints && constraints.iceRestart

                if ((connection.iceGatheringState === 'complete' && !iceRestart) ||
                    (connection.iceGatheringState === 'gathering' && this._iceReady)) {
                    this._rtcReady = true

                    const e = {
                        originator: 'local',
                        type: type,
                        sdp: connection.localDescription.sdp
                    }

                    logger.debug('emit "sdp"')

                    this.emit('sdp', e)

                    return Promise.resolve(e.sdp)
                }

                // Add 'pc.onicencandidate' event handler to resolve on last candidate.
                return new Promise((resolve) => {
                    let finished = false
                    let iceCandidateListener
                    let iceGatheringStateListener

                    this._iceReady = false

                    const ready = () => {
                        connection.removeEventListener('icecandidate', iceCandidateListener)
                        connection.removeEventListener('icegatheringstatechange', iceGatheringStateListener)

                        finished = true
                        this._rtcReady = true

                        // connection.iceGatheringState will still indicate 'gathering' and thus be blocking.
                        this._iceReady = true

                        const e = {
                            originator: 'local',
                            type: type,
                            sdp: connection.localDescription.sdp
                        }

                        logger.debug('emit "sdp"')

                        this.emit('sdp', e)

                        resolve(e.sdp)
                    }

                    connection.addEventListener('icecandidate', iceCandidateListener = (event) => {
                        const candidate = event.candidate

                        if (candidate) {
                            this.emit('icecandidate', {
                                candidate,
                                ready
                            })
                        } else if (!finished) {
                            ready()
                        }
                    })

                    connection.addEventListener('icegatheringstatechange', iceGatheringStateListener = () => {
                        if ((connection.iceGatheringState === 'complete') && !finished) {
                            ready()
                        }
                    })
                })
            })
    }

    /**
     * Dialog Management
     */
    _createDialog (message, type, early) {
        const local_tag = (type === 'UAS') ? message.to_tag : message.from_tag
        const remote_tag = (type === 'UAS') ? message.from_tag : message.to_tag
        const id = message.call_id + local_tag + remote_tag

        /*message.headers.Contact = [
            {
                parsed: '<sip:665@192.168.181.88:5060>',
                raw: '<sip:665@192.168.181.88:5060>'
            }
        ]*/

        let early_dialog = this._earlyDialogs[id]

        // Early Dialog.
        if (early) {
            if (early_dialog) {
                return true
            } else {
                early_dialog = new Dialog(this, message, type, Dialog.C.STATUS_EARLY)

                // Dialog has been successfully created.
                if (early_dialog.error) {
                    logger.debug(early_dialog.error)
                    this._failed('remote', message, JsSIP_C.causes.INTERNAL_ERROR)

                    return false
                } else {
                    this._earlyDialogs[id] = early_dialog

                    return true
                }
            }
        } else {
            // Confirmed Dialog.
            this._from_tag = message.from_tag
            this._to_tag = message.to_tag

            // In case the dialog is in _early_ state, update it.
            if (early_dialog) {
                early_dialog.update(message, type)
                this._dialog = early_dialog
                delete this._earlyDialogs[id]

                return true
            }

            // Otherwise, create a _confirmed_ dialog.
            const dialog = new Dialog(this, message, type)

            if (dialog.error) {
                logger.debug(dialog.error)
                this._failed('remote', message, JsSIP_C.causes.INTERNAL_ERROR)

                return false
            } else {
                this._dialog = dialog

                return true
            }
        }
    }

    /**
     * In dialog INVITE Reception
     */

    _receiveReinvite (request) {
        logger.debug('receiveReinvite()')

        const contentType = request.hasHeader('Content-Type') ?
            request.getHeader('Content-Type').toLowerCase() : undefined
        const data = {
            request,
            callback: undefined,
            reject: reject.bind(this)
        }

        let rejected = false

        function reject (options = {}) {
            rejected = true

            const status_code = options.status_code || 403
            const reason_phrase = options.reason_phrase || ''
            const extraHeaders = Utils.cloneArray(options.extraHeaders)

            if (this._status !== C.STATUS_CONFIRMED) {
                return false
            }

            if (status_code < 300 || status_code >= 700) {
                throw new TypeError(`Invalid status_code: ${status_code}`)
            }

            request.reply(status_code, reason_phrase, extraHeaders)
        }

        // Emit 'reinvite'.
        this.emit('reinvite', data)

        if (rejected) {
            return
        }

        this._late_sdp = false

        // Request without SDP.
        if (!request.body) {
            this._late_sdp = true
            if (this._remoteHold) {
                this._remoteHold = false
                this._onunhold('remote')
            }
            this._connectionPromiseQueue = this._connectionPromiseQueue
                .then(() => this._createLocalDescription('offer', this._rtcOfferConstraints))
                .then((sdp) => {
                    sendAnswer.call(this, sdp)
                })
                .catch(() => {
                    request.reply(500)
                })

            return
        }

        // Request with SDP.
        if (contentType !== 'application/sdp') {
            logger.debug('invalid Content-Type')
            request.reply(415)

            return
        }

        this._processInDialogSdpOffer(request)
            // Send answer.
            .then((desc) => {
                if (this._status === C.STATUS_TERMINATED) {
                    return
                }

                sendAnswer.call(this, desc)
            })
            .catch((error) => {
                logger.warn(error)
            })

        function sendAnswer (desc) {
            const extraHeaders = [ `Contact: ${this._contact}` ]

            this._handleSessionTimersInIncomingRequest(request, extraHeaders)

            if (this._late_sdp) {
                desc = this._mangleOffer(desc)
            }

            request.reply(200, null, extraHeaders, desc,
                () => {
                    this._status = C.STATUS_WAITING_FOR_ACK
                    this._setInvite2xxTimer(request, desc)
                    this._setACKTimer()
                }
            )

            // If callback is given execute it.
            if (typeof data.callback === 'function') {
                data.callback()
            }
        }
    }

    /**
     * In dialog UPDATE Reception
     */
    _receiveUpdate (request) {
        logger.debug('receiveUpdate()')

        const contentType = request.hasHeader('Content-Type') ?
            request.getHeader('Content-Type').toLowerCase() : undefined
        const data = {
            request,
            callback: undefined,
            reject: reject.bind(this)
        }

        let rejected = false

        function reject (options = {}) {
            rejected = true

            const status_code = options.status_code || 403
            const reason_phrase = options.reason_phrase || ''
            const extraHeaders = Utils.cloneArray(options.extraHeaders)

            if (this._status !== C.STATUS_CONFIRMED) {
                return false
            }

            if (status_code < 300 || status_code >= 700) {
                throw new TypeError(`Invalid status_code: ${status_code}`)
            }

            request.reply(status_code, reason_phrase, extraHeaders)
        }

        // Emit 'update'.
        this.emit('update', data)

        if (rejected) {
            return
        }

        if (!request.body) {
            sendAnswer.call(this, null)

            return
        }

        if (contentType !== 'application/sdp') {
            logger.debug('invalid Content-Type')

            request.reply(415)

            return
        }

        this._processInDialogSdpOffer(request)
            // Send answer.
            .then((desc) => {
                if (this._status === C.STATUS_TERMINATED) {
                    return
                }

                sendAnswer.call(this, desc)
            })
            .catch((error) => {
                logger.warn(error)
            })

        function sendAnswer (desc) {
            const extraHeaders = [ `Contact: ${this._contact}` ]

            this._handleSessionTimersInIncomingRequest(request, extraHeaders)

            request.reply(200, null, extraHeaders, desc)

            // If callback is given execute it.
            if (typeof data.callback === 'function') {
                data.callback()
            }
        }
    }

    _processInDialogSdpOffer (request) {
        logger.debug('_processInDialogSdpOffer()')

        const sdp = request.parseSDP()

        let hold = false

        for (const m of sdp.media) {
            if (holdMediaTypes.indexOf(m.type) === -1) {
                continue
            }

            const direction = m.direction || sdp.direction || 'sendrecv'

            if (direction === 'sendonly' || direction === 'inactive') {
                hold = true
            } else {
                // If at least one of the streams is active don't emit 'hold'.
                hold = false
                break
            }
        }

        const e = {
            originator: 'remote',
            type: 'offer',
            sdp: request.body
        }

        logger.debug('emit "sdp"')
        this.emit('sdp', e)

        const offer = new RTCSessionDescription({
            type: 'offer',
            sdp: e.sdp
        })

        this._connectionPromiseQueue = this._connectionPromiseQueue
            // Set remote description.
            .then(() => {
                if (this._status === C.STATUS_TERMINATED) {
                    throw new Error('terminated')
                }

                return this._connection.setRemoteDescription(offer)
                    .catch((error) => {
                        request.reply(488)
                        logger.warn('emit "peerconnection:setremotedescriptionfailed" [error:%o]', error)

                        this.emit('peerconnection:setremotedescriptionfailed', error)

                        throw error
                    })
            })
            .then(() => {
                if (this._status === C.STATUS_TERMINATED) {
                    throw new Error('terminated')
                }

                if (this._remoteHold === true && hold === false) {
                    this._remoteHold = false
                    this._onunhold('remote')
                } else if (this._remoteHold === false && hold === true) {
                    this._remoteHold = true
                    this._onhold('remote')
                }
            })
            // Create local description.
            .then(() => {
                if (this._status === C.STATUS_TERMINATED) {
                    throw new Error('terminated')
                }

                return this._createLocalDescription('answer', this._rtcAnswerConstraints)
                    .catch((error) => {
                        request.reply(500)
                        logger.warn('emit "peerconnection:createtelocaldescriptionfailed" [error:%o]', error)

                        throw error
                    })
            })
            .catch((error) => {
                logger.warn('_processInDialogSdpOffer() failed [error: %o]', error)
            })

        return this._connectionPromiseQueue
    }

    /**
     * In dialog Refer Reception
     */
    _receiveRefer (request) {
        logger.debug('receiveRefer()')

        if (!request.refer_to) {
            logger.debug('no Refer-To header field present in REFER')
            request.reply(400)

            return
        }

        if (request.refer_to.uri.scheme !== JsSIP_C.SIP) {
            logger.debug('Refer-To header field points to a non-SIP URI scheme')
            request.reply(416)

            return
        }

        // Reply before the transaction timer expires.
        request.reply(202)

        const notifier = new RTCSession_ReferNotifier(this, request.cseq)

        logger.debug('emit "refer"')

        // Emit 'refer'.
        this.emit('refer', {
            request,
            accept: (initCallback, options) => {
                accept.call(this, initCallback, options)
            },
            reject: () => {
                reject.call(this)
            }
        })

        function accept (initCallback, options = {}) {
            initCallback = (typeof initCallback === 'function')? initCallback : null

            if (this._status !== C.STATUS_WAITING_FOR_ACK &&
                this._status !== C.STATUS_CONFIRMED) {
                return false
            }

            const session = new RTCSession(this._ua)

            session.on('progress', ({ response }) => {
                notifier.notify(response.status_code, response.reason_phrase)
            })

            session.on('accepted', ({ response }) => {
                notifier.notify(response.status_code, response.reason_phrase)
            })

            session.on('_failed', ({ message, cause }) => {
                if (message) {
                    notifier.notify(message.status_code, message.reason_phrase)
                } else {
                    notifier.notify(487, cause)
                }
            })

            // Consider the Replaces header present in the Refer-To URI.
            if (request.refer_to.uri.hasHeader('replaces')) {
                const replaces = decodeURIComponent(request.refer_to.uri.getHeader('replaces'))

                options.extraHeaders = Utils.cloneArray(options.extraHeaders)
                options.extraHeaders.push(`Replaces: ${replaces}`)
            }

            session.connect(request.refer_to.uri.toAor(), options, initCallback)
        }

        function reject () {
            notifier.notify(603)
        }
    }

    /**
     * In dialog Notify Reception
     */
    _receiveNotify (request) {
        logger.debug('receiveNotify()')

        if (!request.event) {
            request.reply(400)
        }

        switch (request.event.event) {
            case 'refer': {
                let id
                let referSubscriber

                if (request.event.params && request.event.params.id) {
                    id = request.event.params.id
                    referSubscriber = this._referSubscribers[id]
                } else if (Object.keys(this._referSubscribers).length === 1) {
                    referSubscriber = this._referSubscribers[
                        Object.keys(this._referSubscribers)[0]]
                } else {
                    request.reply(400, 'Missing event id parameter')

                    return
                }

                if (!referSubscriber) {
                    request.reply(481, 'Subscription does not exist')

                    return
                }

                referSubscriber.receiveNotify(request)
                request.reply(200)

                break
            }

            default: {
                request.reply(489)
            }
        }
    }

    /**
     * INVITE with Replaces Reception
     */
    _receiveReplaces (request) {
        logger.debug('receiveReplaces()')

        function accept (initCallback) {
            if (this._status !== C.STATUS_WAITING_FOR_ACK &&
                this._status !== C.STATUS_CONFIRMED) {
                return false
            }

            const session = new RTCSession(this._ua)

            // Terminate the current session when the new one is confirmed.
            session.on('confirmed', () => {
                this.terminate()
            })

            session.init_incoming(request, initCallback)
        }

        function reject () {
            logger.debug('Replaced INVITE rejected by the user')
            request.reply(486)
        }

        // Emit 'replace'.
        this.emit('replaces', {
            request,
            accept: (initCallback) => { accept.call(this, initCallback) },
            reject: () => { reject.call(this) }
        })
    }

    _getNextTransactionId () {
        const nextTransaction = this.lastTransaction + 1
        return nextTransaction.toString()
    }

    /**
     * Initial Request Sender
     */
    _sendInitialRequest (mediaConstraints, rtcOfferConstraints, mediaStream) {
        this.ackSent = false
        this.publisherSubscribeSent = false

        const request_sender = new RequestSender(this._ua, this._request, {
            onRequestTimeout: () => {
                this.onRequestTimeout()
            },
            onTransportError: () => {
                this.onTransportError()
            },
            // Update the request on authentication.
            onAuthenticated: (request) => {
                this._request = request
            },
            onReceiveResponse: (response) => {
                this._receiveInviteResponse(response)
            }
        })

        // This Promise is resolved within the next iteration, so the app has now
        // a chance to set events such as 'peerconnection' and 'connecting'.
        Promise.resolve()
            // Get a stream if required.
            .then(() => {
                // A stream is given, let the app set events such as 'peerconnection' and 'connecting'.
                if (mediaStream) {
                    return mediaStream
                } else if (mediaConstraints.audio || mediaConstraints.video) {
                    // Request for user media access.
                    this._localMediaStreamLocallyGenerated = true

                    return this.loadStream() //navigator.mediaDevices.getUserMedia(mediaConstraints)
                        .catch((error) => {
                            if (this._status === C.STATUS_TERMINATED) {
                                throw new Error('terminated')
                            }

                            this._failed('local', null, JsSIP_C.causes.USER_DENIED_MEDIA_ACCESS)

                            logger.warn('emit "getusermediafailed" [error:%o]', error)

                            this.emit('getusermediafailed', error)

                            throw error
                        })
                }
            })
            .then((stream) => {
                if (this._status === C.STATUS_TERMINATED) {
                    throw new Error('terminated')
                }

                this._localMediaStream = stream

                if (stream) {
                    stream.getTracks().forEach((track) => {
                        this._connection.addTrack(track, stream)
                    })
                }

                // TODO: should this be triggered here?
                this._connecting(this._request)

                return this._createLocalDescription('offer', rtcOfferConstraints)
                    .catch((error) => {
                        this._failed('local', null, JsSIP_C.causes.WEBRTC_ERROR)

                        throw error
                    })
            })
            .then((desc) => {
                if (this._is_canceled || this._status === C.STATUS_TERMINATED) {
                    throw new Error('terminated')
                }

                const inviteData = {
                    janus: 'attach',
                    plugin: 'janus.plugin.videoroom',
                    opaque_id: this.opaque_id
                }

                const bodyStringified = JSON.stringify(inviteData)

                this._request.body = bodyStringified
                this._status = C.STATUS_INVITE_SENT

                logger.debug('emit "sending" [request:%o]', this._request)

                // Emit 'sending' so the app can mangle the body before the request is sent.
                this.emit('sending', {
                    request: this._request
                })

                request_sender.send()
            })
            .catch((error) => {
                if (this._status === C.STATUS_TERMINATED) {
                    return
                }

                logger.warn(error)
            })
    }

    /**
     * Get DTMF RTCRtpSender.
     */
    /*_getDTMFRTPSender () {
        const sender = this._connection.getSenders().find((rtpSender) => {
            return rtpSender.track && rtpSender.track.kind === 'audio'
        })

        if (!(sender && sender.dtmf)) {
            logger.warn('sendDTMF() | no local audio track to send DTMF with')

            return
        }

        return sender.dtmf
    }*/

    async requestAudioAndVideoPermissions () {
        this.stream = await this.loadStream()
    }

    async setupMediaStream () {
        await this.requestAudioAndVideoPermissions()
        await this.processPlugins()
    }

    async changeMediaConstraints (constraints) {
        this.mediaConstraints = { ...constraints }

        await this.processPlugins()

        this.addTracks(this.stream.getTracks())
        this._ua.emit('changeMainVideoStream', {
            name: this.display_name,
            stream: this.stream
        })
    }

    async loadStream () {
        const options = {}

        if (this.isAudioOn) {
            if (this.mediaConstraints.audio) {
                options.audio = this.mediaConstraints.audio
            } else {
                options.audio = true
            }
        } else {
            options.audio = false
        }

        if (this.isVideoOn) {
            if (this.mediaConstraints.video) {
                options.video = this.mediaConstraints.video
            } else {
                options.video = true
            }
        } else {
            options.video = false
        }

        let stream = null

        try {
            stream = await navigator.mediaDevices.getUserMedia(options)
        } catch (e) {
            try {
                options.video = false
                stream = await navigator.mediaDevices.getUserMedia(options)
            } catch (ex) {
                options.audio = false
                options.video = false
                stream = await navigator.mediaDevices.getUserMedia(options)
            }
        }

        return stream

        //this.originalStream = this.stream.clone()
        // this.trackMicrophoneVolume()
        /*return {
            stream: this.stream,
            options
        }*/
    }

    addTracks (tracks) {
        this._connection.getSenders().forEach((sender) => {
            this._connection.removeTrack(sender)
        })

        tracks.forEach((track) => {
            this._connection.addTrack(track)
        })
    }

    getRecordFileName () {
        return RECORDING_PATH + this.room_id + btoa(unescape(encodeURIComponent(this.displayName))) + Date.now()
    }

    async processIceCandidates () {
        for(let i = 0; i < this.iceCandidates.length; i++) {
            await this._connection.addIceCandidate(this.iceCandidates[i])
        }
        this.iceCandidates = []
    }

    async _sendConfigureMessage (options) {
        const offerOptions = {
            offerToReceiveAudio: false,
            offerToReceiveVideo: false
        }

        // TODO: don't create offer here as it is already created
        //const jsepOffer = await this._connection.createOffer(offerOptions)
        //await this._connection.setLocalDescription(jsepOffer)

        const candidatesArray = this._candidates.map((candidate) => ({
            janus: 'trickle',
            candidate,
            handle_id: this.handle_id,
            session_id: this.session_id
        }))

        const configureBody = {
            janus: 'message',
            body: {
                request: 'configure',
                record: true,
                filename: this.getRecordFileName(),
                ...options
            },
            jsep: this.jsepOffer,
            handle_id: this.handle_id,
            session_id: this.session_id
        }

        const body = {
            configure: configureBody,
            trickles: [ ...candidatesArray ]
        }

        const extraHeaders = [
            'Content-Type: application/json',
            this.getPTypeHeader(P_TYPES.ICE)
        ]

        this.sendRequest(JsSIP_C.INFO, {
            extraHeaders,
            body: JSON.stringify(body),
            eventHandlers: {
                onSuccessResponse: async (response) => {
                    this.isConfigureSent = true
                    const messageData = response.data
                    const messageBody = messageData.split('\r\n')
                    const data = messageBody[messageBody.length - 1]
                    const parsed = JSON.parse(data)
                    await this._connection.setRemoteDescription(parsed.jsep)
                    //await this.processIceCandidates()
                    this._candidates = []
                },
            }
        })
    }

    _sendMemberStartMessage (member, jsep) {
        const body = {
            janus: 'message',
            body: {
                request: 'start',
                room: this.room_id
            },
            handle_id: member.handleId,
            session_id: this.session_id,
            jsep
        }

        const extraHeaders = [
            'Content-Type: application/json',
            this.getPTypeHeader(P_TYPES.CONFIGURE)
        ]

        this.sendRequest(JsSIP_C.INFO, {
            extraHeaders,
            body: JSON.stringify(body),
            eventHandlers: {
                onSuccessResponse: async (response) => {
                    if (response.status_code === 200) {
                        await member.rtcpPeer.setLocalDescription(jsep)
                    }
                }
            }
        })
    }

    _sendTrickleMessage (candidates) {
        const candidatesArray = candidates.map((candidate) => ({
            janus: 'trickle',
            candidate,
            handle_id: this.handle_id,
            session_id: this.session_id
        }))

        const body = {
            trickles: [ ...candidatesArray ]
        }

        const extraHeaders = [ this.getPTypeHeader(P_TYPES.TRICKLE) ]

        this.sendRequest(JsSIP_C.INFO, {
            extraHeaders,
            body: JSON.stringify(body),
            eventHandlers: {
                onSuccessResponse: async (response) => {},
            }
        })
    }

    async _answerAttachedStream (member, attachedStreamInfo) {
        let answerSdp = null
        const RTCPeerOnAddStream = async (event) => {
            if (!member.rtcpPeer  ) {
                return
            }
            if ( member.loaded) {
                return
            } else {
                member.loaded = true
                const options = {
                    audio: true,
                    video: true,
                }

                await new Promise((resolve) => {setTimeout(resolve,100)})
                answerSdp = await member.rtcpPeer.createAnswer(options)

                this._sendMemberStartMessage(member, answerSdp)
            }

            const aTracks = event.streams[0].getAudioTracks()
            const  vTracks = event.streams[0].getVideoTracks()

            const tracksToApply = []
            if (aTracks[0]) {
                tracksToApply.push(aTracks[0])
            }
            if (vTracks[0]) {
                tracksToApply.push(vTracks[0])
            }

            const mediaStream = new MediaStream(tracksToApply)

            member.stream = mediaStream
            this._ua.emit('memberJoin', member.memberInfo)
        }

        let iceCandidateTimeout
        let candidates = []
        // Send ICE events to Janus.
        const RTCPeerOnIceCandidate = (event) => {
            if (member.rtcpPeer.signalingState !== 'stable' &&
                member.rtcpPeer.signalingState !== 'have-local-offer') return

            candidates.push(event.candidate || null)

            clearTimeout(iceCandidateTimeout)

            iceCandidateTimeout = setTimeout(() => {
                this._sendTrickleMessage(candidates)
            }, 500)
        }

        member.rtcpPeer = new RTCPeerConnection()
        //this.rtcpPeer.onaddstream = RTCPeerOnAddStream;
        member.rtcpPeer.ontrack  = RTCPeerOnAddStream
        member.rtcpPeer.onicecandidate = RTCPeerOnIceCandidate
        member.rtcpPeer.sender = attachedStreamInfo.sender
        await member.rtcpPeer.setRemoteDescription(attachedStreamInfo.jsep)
        //this.setupMetrics()
    }

    _sendJoinMemberRequest (member) {
        const registerBody = {
            janus: 'message',
            body: {
                request: 'join',
                room: this.room_id,
                feed: member.info.id,
                ptype: 'subscriber'
            },
            handle_id: member.handleId,
            session_id: this.session_id
        }

        const registerExtraHeaders = [ this.getPTypeHeader(P_TYPES.SUBSCRIBER) ]

        this.sendRequest(JsSIP_C.SUBSCRIBE, {
            extraHeaders: registerExtraHeaders,
            body: JSON.stringify(registerBody),
            eventHandlers: {
                onSuccessResponse: async (response) => {
                    if (response.status_code === 200) {
                        const body = JSON.parse(response.body)

                        if (body?.plugindata?.data?.id) {
                            await this._answerAttachedStream(member, body)
                        }
                    }
                },
            }
        })
    }

    _attachMember (member) {
        const registerBody = {
            janus: 'attach',
            opaque_id: this.opaque_id,
            plugin: 'janus.plugin.videoroom',
            session_id: this.session_id
        }

        const registerExtraHeaders = [ this.getPTypeHeader(P_TYPES.SUBSCRIBER) ]

        this.sendRequest(JsSIP_C.INFO, {
            extraHeaders: registerExtraHeaders,
            body: JSON.stringify(registerBody),
            eventHandlers: {
                onSuccessResponse: async (response) => {
                    if (response.status_code === 200) {
                        const parsedBody = JSON.parse(response.body)
                        const memberHandleId = parsedBody.data.id
                        member.handleId = memberHandleId

                        this._sendJoinMemberRequest(member)
                    }
                },
            }
        })
    }

    _detachMember (member) {
        const body = {
            janus: 'detach',
            handle_id: member.handleId,
            session_id: this.session_id
        }

        const registerExtraHeaders = [ this.getPTypeHeader(P_TYPES.SUBSCRIBER) ]

        this.sendRequest(JsSIP_C.INFO, {
            extraHeaders: registerExtraHeaders,
            body: JSON.stringify(body)
        })

        DeviceManager.stopStreamTracks(member.memberInfo.stream)
        this._ua.emit('memberHangup', member.memberInfo)
    }

    receivePublishers (msg) {
        const unprocessedMembers = { ...this.memberList }
        msg?.plugindata?.data?.publishers.forEach((publisher) => {

            delete unprocessedMembers[publisher.id]
            if (
                !this.memberList[publisher.id]
                && !this.myFeedList.includes(publisher.id)
                &&  publisher.clientID !== this.client_id
                //&&  publisher.clientID !== this.screen_share_client_id
            ) {

                this.memberList[publisher.id] = new Member(publisher, this)
                this._attachMember(this.memberList[publisher.id])
            }
        })

        if (msg?.plugindata?.data?.videoroom === 'synced') {
            Object.keys(unprocessedMembers).forEach(key => {
                unprocessedMembers[key].hangup()
                delete this.memberList[key]
            })
        }
        this.publishers = msg?.plugindata?.data?.publishers
        this.private_id = msg?.plugindata?.data?.private_id
    }

    receiveUnpublished (member) {
        const hangupMember = this.memberList[member]

        if (!hangupMember) {
            return
        }

        hangupMember.hangup()
        this._detachMember(hangupMember)

        delete this.memberList[member]
    }

    closeSession () {
        if (this.stream) {
            this.stream.getTracks().forEach(track => {
                track.stop()
            })
        }

        const members = Object.values(this.memberList)
        members.forEach((member) => {
            member.hangup()
            this._detachMember(member)
        })

        this._ua.emit('conferenceEnd', this.id)
    }

    async processPlugins () {
        const plugins = this._ua.processStreamPlugins
        let baseStream = await this.loadStream() //this.originalStream.clone()

        for (const plugin of plugins) {
            baseStream = await plugin.process(baseStream)
        }

        this.stream.getTracks().forEach((track) => {
            this.stream.removeTrack(track)
            track.stop()
        })

        baseStream.getTracks().forEach((track) => {
            this.stream.addTrack(track)
        })

        //this.stream = baseStream
    }

    async resyncPlugins (type) {
        const plugins = this._ua.processStreamPlugins.filter((plugin) => plugin.type === type)

        for (const plugin of plugins) {
            if (plugin.running) {
                plugin.terminate()
            }
        }

        if (type === 'video') {
            let baseStream = await this.loadStream()

            for (const plugin of plugins) {
                if (plugin.running) {
                    baseStream = await plugin.start(baseStream)
                }
            }

            this.stream.getTracks().forEach((track) => {
                this.stream.removeTrack(track)
                track.stop()
            })

            baseStream.getTracks().forEach((track) => {
                this.stream.addTrack(track)
            })

            this._overrideSenderTracks(this.stream, this._connection)

            this._ua.emit('changeMainVideoStream', {
                name: this.display_name,
                stream: this.stream
            })
        } else {
            const typePlugin = this._ua.newStreamPlugins //newStreamPlugins
                .find((plugin) => plugin.type === type)

            const pluginStream = typePlugin.getStream()

            let baseStream = pluginStream.clone()

            for (const plugin of plugins) {
                if (plugin.running) {
                    baseStream = await plugin.start(baseStream)
                }
            }

            /*pluginStream.getTracks().forEach((track) => {
                pluginStream.removeTrack(track)
                track.stop()
            })

            baseStream.getTracks().forEach((track) => {
                pluginStream.addTrack(track.clone())

                baseStream.removeTrack(track)
                track.stop()
            })*/

            const pluginConnection = typePlugin.getConnection()
            this._overrideSenderTracks(baseStream, pluginConnection)

            this._ua.emit('changePluginStream', {
                type,
                stream: baseStream
            })
            /*const typePlugin = this._ua.processStreamPlugins
                .find((plugin) => plugin.type === type)

            const baseStream = await typePlugin.start()*/

            /*const typePlugin = this._ua.newStreamPlugins //newStreamPlugins
                .find((plugin) => plugin.name === 'ScreenSharePlugin')

            console.log('RRR screen share plugin', typePlugin)

            const pluginStream = typePlugin.getStream()

            console.log('this._ua.processStreamPlugins', this._ua.processStreamPlugins)
            const typePlugin2 = this._ua.processStreamPlugins //newStreamPlugins
                .find((plugin) => plugin.name === 'ScreenShareWhiteboardPlugin')

            const baseStream = await typePlugin2.start()

            this._ua.emit('changeMainVideoStream', {
                name: this.display_name,
                stream: baseStream
            })*/

            /*console.log('RRR screen share plugin stream', pluginStream)

            //let baseStream = pluginStream.clone()

            const sshwPlugin = this._ua.processStreamPlugins
                .find((plugin) => plugin.type === type)

            const baseStream = await sshwPlugin.start()

            console.log('RRR sshw stream', baseStream)

            /!*for (const plugin of plugins) {
                if (plugin.running) {
                    baseStream = await plugin.start(baseStream)
                }
            }*!/

            pluginStream.getTracks().forEach((track) => {
                pluginStream.removeTrack(track)
                track.stop()
            })

            baseStream.getTracks().forEach((track) => {
                pluginStream.addTrack(track.clone())

                baseStream.removeTrack(track)
                track.stop()
            })

            const pluginConnection = typePlugin.getConnection()
            console.log('RRR _overrideSenderTracks', pluginStream.getTracks())
            this._overrideSenderTracks(pluginStream, pluginConnection)

            /!*this._ua.emit('changePluginStream', {
                type,
                stream: pluginStream
            })*!/

            this._ua.emit('changeMainVideoStream', {
                name: this.display_name,
                stream: pluginStream
            })*/
        }

        /*else if (type === 'screen') {
            const screenSharePlugin = this._ua.newStreamPlugins
                .filter((plugin) => plugin.name === 'ScreenSharePlugin')

            if (!screenSharePlugin) {
                throw new Error('ScreenSharePlugin is not found')
            }

            /!*for (const plugin of plugins) {
                if (plugin.running) {
                    //baseStream = await plugin.start(baseStream)
                }
            }*!/
        }*/
    }

    stopProcessPlugins (type) {
        const plugins = this._ua.processStreamPlugins.filter((plugin) => plugin.type === type)

        for (const plugin of plugins) {
            if (plugin.running) {
                plugin.kill()
            }
        }
    }

    /**
     * Reception of Response for Initial INVITE
     */
    _receiveInviteResponse (response) {
        logger.debug('receiveInviteResponse()')

        // Handle 2XX retransmissions and responses from forked requests.
        if (this._dialog && (response.status_code >=200 && response.status_code <=299) && !this.ackSent) {
            /*
             * If it is a retransmission from the endpoint that established
             * the dialog, send an ACK
             */
            if (this._dialog.id.call_id === response.call_id &&
                this._dialog.id.local_tag === response.from_tag &&
                this._dialog.id.remote_tag === response.to_tag) {
                this.ackSent = true
                this.sendRequest(JsSIP_C.ACK)

                return
            } else {
                // If not, send an ACK  and terminate.
                const dialog = new Dialog(this, response, 'UAC')

                if (dialog.error !== undefined) {
                    logger.debug(dialog.error)

                    return
                }

                this.sendRequest(JsSIP_C.ACK)
                this.sendRequest(JsSIP_C.BYE)

                return
            }

        }

        if (this.ackSent && !this.publisherSubscribeSent) {
            const parsedBody = JSON.parse(response.body)
            //console.log('parsedBody', parsedBody)

            this.setupMediaStream().then(() => {
                this.session_id = parsedBody.session_id
                this.handle_id = parsedBody.data.id
                this.client_id = uuidv4()

                const registerBody = {
                    janus: 'message',
                    body: {
                        request: 'join',
                        room: this.room_id,
                        ptype: 'publisher',
                        display: this.display_name,
                        clientID: this.client_id,
                        opaque_id: this.opaque_id,
                    },
                    handle_id: this.handle_id
                }

                const registerExtraHeaders = [ this.getPTypeHeader(P_TYPES.PUBLISHER) ]

                this.sendRequest(JsSIP_C.SUBSCRIBE, {
                    extraHeaders: registerExtraHeaders,
                    body: JSON.stringify(registerBody),
                    eventHandlers: {
                        onSuccessResponse: async (response) => {
                            if (response.status_code === 200) {
                                this.subscribeSent = true

                                if (response.body) {
                                    try {
                                        const bodyParsed = JSON.parse(response.body) || {}

                                        if (bodyParsed.plugindata?.data?.videoroom === 'joined') {
                                            this.myFeedList.push(bodyParsed.plugindata.data.id)
                                        }

                                        if (bodyParsed.plugindata?.data?.publishers){
                                            this.receivePublishers(bodyParsed)
                                        }
                                    } catch (e) {
                                        console.error(e)
                                    }
                                }

                                if (this.lastTrickleReceived && !this.isConfigureSent) {
                                    this.addTracks(this.stream.getTracks())

                                    this._ua.emit('changeMainVideoStream', {
                                        name: this.display_name,
                                        stream: this.stream
                                    })

                                    this._sendConfigureMessage({
                                        audio: true,
                                        video: true,
                                    }).then(() => {})
                                }

                                this._ua.emit('conferenceStart')
                            }
                        },
                    }
                })

                this.publisherSubscribeSent = true
            })
        }

        // Proceed to cancellation if the user requested.
        if (this._is_canceled) {
            if (response.status_code >= 100 && response.status_code < 200) {
                this._request.cancel(this._cancel_reason)
            } else if (response.status_code >= 200 && response.status_code < 299) {
                this._acceptAndTerminate(response)
            }

            return
        }

        if (this._status !== C.STATUS_INVITE_SENT && this._status !== C.STATUS_1XX_RECEIVED) {
            return
        }

        switch (true) {
            case /^100$/.test(response.status_code):
                this._status = C.STATUS_1XX_RECEIVED
                break

            case /^1[0-9]{2}$/.test(response.status_code):
            {
                // Do nothing with 1xx responses without To tag.
                if (!response.to_tag) {
                    logger.debug('1xx response received without to tag')
                    break
                }

                // Create Early Dialog if 1XX comes with contact.
                if (response.hasHeader('contact')) {
                    // An error on dialog creation will fire 'failed' event.
                    if (!this._createDialog(response, 'UAC', true)) {
                        break
                    }
                }

                this._status = C.STATUS_1XX_RECEIVED

                if (!response.body) {
                    this._progress('remote', response)
                    break
                }

                const e = {
                    originator: 'remote',
                    type: 'answer',
                    sdp: response.body
                }

                logger.debug('emit "sdp"')
                this.emit('sdp', e)

                const answer = new RTCSessionDescription({
                    type: 'answer',
                    sdp: e.sdp
                })

                this._connectionPromiseQueue = this._connectionPromiseQueue
                    .then(() => this._connection.setRemoteDescription(answer))
                    .then(() => this._progress('remote', response))
                    .catch((error) => {
                        logger.warn('emit "peerconnection:setremotedescriptionfailed" [error:%o]', error)

                        this.emit('peerconnection:setremotedescriptionfailed', error)
                    })
                break
            }

            case /^2[0-9]{2}$/.test(response.status_code):
            {
                this._status = C.STATUS_CONFIRMED

                if (!response.body) {
                    this._acceptAndTerminate(response, 400, JsSIP_C.causes.MISSING_SDP)
                    this._failed('remote', response, JsSIP_C.causes.BAD_MEDIA_DESCRIPTION)
                    break
                }

                // An error on dialog creation will fire 'failed' event.
                if (!this._createDialog(response, 'UAC')) {
                    break
                }

                break

                const e = {
                    originator: 'remote',
                    type: 'answer',
                    sdp: response.body
                }

                logger.debug('emit "sdp"')
                this.emit('sdp', e)

                const answer = new RTCSessionDescription({
                    type: 'answer',
                    sdp: e.sdp
                })

                this._connectionPromiseQueue = this._connectionPromiseQueue
                    .then(() => {
                        // Be ready for 200 with SDP after a 180/183 with SDP.
                        // We created a SDP 'answer' for it, so check the current signaling state.
                        if (this._connection.signalingState === 'stable') {
                            return this._connection.createOffer(this._rtcOfferConstraints)
                                .then((offer) => this._connection.setLocalDescription(offer))
                                .catch((error) => {
                                    this._acceptAndTerminate(response, 500, error.toString())
                                    this._failed('local', response, JsSIP_C.causes.WEBRTC_ERROR)
                                })
                        }
                    })
                    .then(() => {
                        this._connection.setRemoteDescription(answer)
                            .then(() => {
                                // Handle Session Timers.
                                this._handleSessionTimersInIncomingResponse(response)

                                this._accepted('remote', response)
                                this.sendRequest(JsSIP_C.ACK)
                                this._confirmed('local', null)
                            })
                            .catch((error) => {
                                this._acceptAndTerminate(response, 488, 'Not Acceptable Here')
                                this._failed('remote', response, JsSIP_C.causes.BAD_MEDIA_DESCRIPTION)

                                logger.warn('emit "peerconnection:setremotedescriptionfailed" [error:%o]', error)

                                this.emit('peerconnection:setremotedescriptionfailed', error)
                            })
                    })
                break
            }

            default:
            {
                const cause = Utils.sipErrorCause(response.status_code)

                this._failed('remote', response, cause)
            }
        }
    }

    /**
     * Send Re-INVITE
     */
    _sendReinvite (options = {}) {
        logger.debug('sendReinvite()')

        const extraHeaders = Utils.cloneArray(options.extraHeaders)
        const eventHandlers = Utils.cloneObject(options.eventHandlers)
        const rtcOfferConstraints = options.rtcOfferConstraints ||
            this._rtcOfferConstraints || null

        let succeeded = false

        extraHeaders.push(`Contact: ${this._contact}`)
        extraHeaders.push('Content-Type: application/sdp')

        // Session Timers.
        if (this._sessionTimers.running) {
            extraHeaders.push(`Session-Expires: ${this._sessionTimers.currentExpires};refresher=${this._sessionTimers.refresher ? 'uac' : 'uas'}`)
        }

        this._connectionPromiseQueue = this._connectionPromiseQueue
            .then(() => this._createLocalDescription('offer', rtcOfferConstraints))
            .then((sdp) => {
                sdp = this._mangleOffer(sdp)

                const e = {
                    originator: 'local',
                    type: 'offer',
                    sdp
                }

                logger.debug('emit "sdp"')
                this.emit('sdp', e)

                this.sendRequest(JsSIP_C.INVITE, {
                    extraHeaders,
                    body: sdp,
                    eventHandlers: {
                        onSuccessResponse: (response) => {
                            onSucceeded.call(this, response)
                            succeeded = true
                        },
                        onErrorResponse: (response) => {
                            onFailed.call(this, response)
                        },
                        onTransportError: () => {
                            this.onTransportError() // Do nothing because session ends.
                        },
                        onRequestTimeout: () => {
                            this.onRequestTimeout() // Do nothing because session ends.
                        },
                        onDialogError: () => {
                            this.onDialogError() // Do nothing because session ends.
                        }
                    }
                })
            })
            .catch(() => {
                onFailed()
            })

        function onSucceeded (response) {
            if (this._status === C.STATUS_TERMINATED) {
                return
            }

            this.sendRequest(JsSIP_C.ACK)

            // If it is a 2XX retransmission exit now.
            if (succeeded) { return }

            // Handle Session Timers.
            this._handleSessionTimersInIncomingResponse(response)

            // Must have SDP answer.
            if (!response.body) {
                onFailed.call(this)

                return
            } else if (!response.hasHeader('Content-Type') || response.getHeader('Content-Type').toLowerCase() !== 'application/sdp') {
                onFailed.call(this)

                return
            }

            const e = {
                originator: 'remote',
                type: 'answer',
                sdp: response.body
            }

            logger.debug('emit "sdp"')
            this.emit('sdp', e)

            const answer = new RTCSessionDescription({
                type: 'answer',
                sdp: e.sdp
            })

            this._connectionPromiseQueue = this._connectionPromiseQueue
                .then(() => this._connection.setRemoteDescription(answer))
                .then(() => {
                    if (eventHandlers.succeeded) {
                        eventHandlers.succeeded(response)
                    }
                })
                .catch((error) => {
                    onFailed.call(this)

                    logger.warn('emit "peerconnection:setremotedescriptionfailed" [error:%o]', error)

                    this.emit('peerconnection:setremotedescriptionfailed', error)
                })
        }

        function onFailed (response) {
            if (eventHandlers.failed) {
                eventHandlers.failed(response)
            }
        }
    }

    /**
     * Send UPDATE
     */
    _sendUpdate (options = {}) {
        logger.debug('sendUpdate()')

        const extraHeaders = Utils.cloneArray(options.extraHeaders)
        const eventHandlers = Utils.cloneObject(options.eventHandlers)
        const rtcOfferConstraints = options.rtcOfferConstraints ||
            this._rtcOfferConstraints || null
        const sdpOffer = options.sdpOffer || false

        let succeeded = false

        extraHeaders.push(`Contact: ${this._contact}`)

        // Session Timers.
        if (this._sessionTimers.running) {
            extraHeaders.push(`Session-Expires: ${this._sessionTimers.currentExpires};refresher=${this._sessionTimers.refresher ? 'uac' : 'uas'}`)
        }

        if (sdpOffer) {
            extraHeaders.push('Content-Type: application/sdp')

            this._connectionPromiseQueue = this._connectionPromiseQueue
                .then(() => this._createLocalDescription('offer', rtcOfferConstraints))
                .then((sdp) => {
                    sdp = this._mangleOffer(sdp)

                    const e = {
                        originator: 'local',
                        type: 'offer',
                        sdp
                    }

                    logger.debug('emit "sdp"')
                    this.emit('sdp', e)

                    this.sendRequest(JsSIP_C.UPDATE, {
                        extraHeaders,
                        body: sdp,
                        eventHandlers: {
                            onSuccessResponse: (response) => {
                                onSucceeded.call(this, response)
                                succeeded = true
                            },
                            onErrorResponse: (response) => {
                                onFailed.call(this, response)
                            },
                            onTransportError: () => {
                                this.onTransportError() // Do nothing because session ends.
                            },
                            onRequestTimeout: () => {
                                this.onRequestTimeout() // Do nothing because session ends.
                            },
                            onDialogError: () => {
                                this.onDialogError() // Do nothing because session ends.
                            }
                        }
                    })
                })
                .catch(() => {
                    onFailed.call(this)
                })
        } else {
            // No SDP.
            this.sendRequest(JsSIP_C.UPDATE, {
                extraHeaders,
                eventHandlers: {
                    onSuccessResponse: (response) => {
                        onSucceeded.call(this, response)
                    },
                    onErrorResponse: (response) => {
                        onFailed.call(this, response)
                    },
                    onTransportError: () => {
                        this.onTransportError() // Do nothing because session ends.
                    },
                    onRequestTimeout: () => {
                        this.onRequestTimeout() // Do nothing because session ends.
                    },
                    onDialogError: () => {
                        this.onDialogError() // Do nothing because session ends.
                    }
                }
            })
        }

        function onSucceeded (response) {
            if (this._status === C.STATUS_TERMINATED) {
                return
            }

            // If it is a 2XX retransmission exit now.
            if (succeeded) { return }

            // Handle Session Timers.
            this._handleSessionTimersInIncomingResponse(response)

            // Must have SDP answer.
            if (sdpOffer) {
                if (!response.body) {
                    onFailed.call(this)

                    return
                } else if (!response.hasHeader('Content-Type') || response.getHeader('Content-Type').toLowerCase() !== 'application/sdp') {
                    onFailed.call(this)

                    return
                }

                const e = {
                    originator: 'remote',
                    type: 'answer',
                    sdp: response.body
                }

                logger.debug('emit "sdp"')
                this.emit('sdp', e)

                const answer = new RTCSessionDescription({
                    type: 'answer',
                    sdp: e.sdp
                })

                this._connectionPromiseQueue = this._connectionPromiseQueue
                    .then(() => this._connection.setRemoteDescription(answer))
                    .then(() => {
                        if (eventHandlers.succeeded) {
                            eventHandlers.succeeded(response)
                        }
                    })
                    .catch((error) => {
                        onFailed.call(this)

                        logger.warn('emit "peerconnection:setremotedescriptionfailed" [error:%o]', error)

                        this.emit('peerconnection:setremotedescriptionfailed', error)
                    })
            } else if (eventHandlers.succeeded) {
                // No SDP answer.
                eventHandlers.succeeded(response)
            }
        }

        function onFailed (response) {
            if (eventHandlers.failed) { eventHandlers.failed(response) }
        }
    }

    _acceptAndTerminate (response, status_code, reason_phrase) {
        logger.debug('acceptAndTerminate()')

        const extraHeaders = []

        if (status_code) {
            reason_phrase = reason_phrase || JsSIP_C.REASON_PHRASE[status_code] || ''
            extraHeaders.push(`Reason: SIP ;cause=${status_code}; text="${reason_phrase}"`)
        }

        // An error on dialog creation will fire 'failed' event.
        if (this._dialog || this._createDialog(response, 'UAC')) {
            this.sendRequest(JsSIP_C.ACK)
            this.sendRequest(JsSIP_C.BYE, {
                extraHeaders
            })
        }

        // Update session status.
        this._status = C.STATUS_TERMINATED
    }

    /**
     * Correctly set the SDP direction attributes if the call is on local hold
     */
    _mangleOffer (sdp) {

        if (!this._localHold && !this._remoteHold) {
            return sdp
        }

        sdp = sdp_transform.parse(sdp)

        // Local hold.
        if (this._localHold && !this._remoteHold) {
            logger.debug('mangleOffer() | me on hold, mangling offer')
            for (const m of sdp.media) {
                if (holdMediaTypes.indexOf(m.type) === -1) {
                    continue
                }
                if (!m.direction) {
                    m.direction = 'sendonly'
                } else if (m.direction === 'sendrecv') {
                    m.direction = 'sendonly'
                } else if (m.direction === 'recvonly') {
                    m.direction = 'inactive'
                }
            }
        } else if (this._localHold && this._remoteHold) {
            // Local and remote hold.
            logger.debug('mangleOffer() | both on hold, mangling offer')
            for (const m of sdp.media) {
                if (holdMediaTypes.indexOf(m.type) === -1) {
                    continue
                }
                m.direction = 'inactive'
            }
        } else if (this._remoteHold) {
            // Remote hold.
            logger.debug('mangleOffer() | remote on hold, mangling offer')
            for (const m of sdp.media) {
                if (holdMediaTypes.indexOf(m.type) === -1) {
                    continue
                }
                if (!m.direction) {
                    m.direction = 'recvonly'
                } else if (m.direction === 'sendrecv') {
                    m.direction = 'recvonly'
                } else if (m.direction === 'recvonly') {
                    m.direction = 'inactive'
                }
            }
        }

        return sdp_transform.write(sdp)
    }

    _setLocalMediaStatus () {
        let enableAudio = true, enableVideo = true

        if (this._localHold || this._remoteHold) {
            enableAudio = false
            enableVideo = false
        }

        if (this._audioMuted) {
            enableAudio = false
        }

        if (this._videoMuted) {
            enableVideo = false
        }

        this._toggleMuteAudio(!enableAudio)
        this._toggleMuteVideo(!enableVideo)
    }

    /**
     * Handle SessionTimers for an incoming INVITE or UPDATE.
     * @param  {IncomingRequest} request
     * @param  {Array} responseExtraHeaders  Extra headers for the 200 response.
     */
    _handleSessionTimersInIncomingRequest (request, responseExtraHeaders) {
        if (!this._sessionTimers.enabled) { return }

        let session_expires_refresher

        if (request.session_expires && request.session_expires >= JsSIP_C.MIN_SESSION_EXPIRES) {
            this._sessionTimers.currentExpires = request.session_expires
            session_expires_refresher = request.session_expires_refresher || 'uas'
        } else {
            this._sessionTimers.currentExpires = this._sessionTimers.defaultExpires
            session_expires_refresher = 'uas'
        }

        responseExtraHeaders.push(`Session-Expires: ${this._sessionTimers.currentExpires};refresher=${session_expires_refresher}`)

        this._sessionTimers.refresher = (session_expires_refresher === 'uas')
        this._runSessionTimer()
    }

    /**
     * Handle SessionTimers for an incoming response to INVITE or UPDATE.
     * @param  {IncomingResponse} response
     */
    _handleSessionTimersInIncomingResponse (response) {
        if (!this._sessionTimers.enabled) { return }

        let session_expires_refresher

        if (response.session_expires &&
            response.session_expires >= JsSIP_C.MIN_SESSION_EXPIRES) {
            this._sessionTimers.currentExpires = response.session_expires
            session_expires_refresher = response.session_expires_refresher || 'uac'
        } else {
            this._sessionTimers.currentExpires = this._sessionTimers.defaultExpires
            session_expires_refresher = 'uac'
        }

        this._sessionTimers.refresher = (session_expires_refresher === 'uac')
        this._runSessionTimer()
    }

    _runSessionTimer () {
        const expires = this._sessionTimers.currentExpires

        this._sessionTimers.running = true

        clearTimeout(this._sessionTimers.timer)

        // I'm the refresher.
        if (this._sessionTimers.refresher) {
            this._sessionTimers.timer = setTimeout(() => {
                if (this._status === C.STATUS_TERMINATED) { return }

                if (!this._isReadyToReOffer()) { return }

                logger.debug('runSessionTimer() | sending session refresh request')

                if (this._sessionTimers.refreshMethod === JsSIP_C.UPDATE) {
                    this._sendUpdate()
                } else {
                    this._sendReinvite()
                }
            }, expires * 500) // Half the given interval (as the RFC states).
        } else {
            // I'm not the refresher.
            this._sessionTimers.timer = setTimeout(() => {
                if (this._status === C.STATUS_TERMINATED) { return }

                logger.warn('runSessionTimer() | timer expired, terminating the session')

                this.terminate({
                    cause: JsSIP_C.causes.REQUEST_TIMEOUT,
                    status_code: 408,
                    reason_phrase: 'Session Timer Expired'
                })
            }, expires * 1100)
        }
    }

    _toggleMuteAudio (mute) {
        const senders = this._connection.getSenders().filter((sender) => {
            return sender.track && sender.track.kind === 'audio'
        })

        for (const sender of senders) {
            sender.track.enabled = !mute
        }
    }

    _toggleMuteVideo (mute) {
        const senders = this._connection.getSenders().filter((sender) => {
            return sender.track && sender.track.kind === 'video'
        })

        for (const sender of senders) {
            sender.track.enabled = !mute
        }
    }

    _newJanusSession (originator, request) {
        logger.debug('newRTCSession()')

        this._ua.newJanusSession(this, {
            originator,
            session: this,
            request
        })
    }

    _connecting (request) {
        logger.debug('session connecting')

        logger.debug('emit "connecting"')

        this.emit('connecting', {
            request
        })
    }

    _progress (originator, response) {
        logger.debug('session progress')

        logger.debug('emit "progress"')

        this.emit('progress', {
            originator,
            response: response || null
        })
    }

    _accepted (originator, message) {
        logger.debug('session accepted')

        this._start_time = new Date()

        logger.debug('emit "accepted"')

        this.emit('accepted', {
            originator,
            response: message || null
        })
    }

    _confirmed (originator, ack) {
        logger.debug('session confirmed')

        this._is_confirmed = true

        logger.debug('emit "confirmed"')

        this.emit('confirmed', {
            originator,
            ack: ack || null
        })
    }

    _ended (originator, message, cause) {
        logger.debug('session ended')

        this._end_time = new Date()

        this._close()

        logger.debug('emit "ended"')

        this.emit('ended', {
            originator,
            message: message || null,
            cause
        })
    }

    _failed (originator, message, cause) {
        logger.debug('session failed')

        // Emit private '_failed' event first.
        logger.debug('emit "_failed"')

        this.emit('_failed', {
            originator,
            message: message || null,
            cause
        })

        this._close()

        logger.debug('emit "failed"')

        this.emit('failed', {
            originator,
            message: message || null,
            cause
        })
    }

    _onhold (originator) {
        logger.debug('session onhold')

        this._setLocalMediaStatus()

        logger.debug('emit "hold"')

        this.emit('hold', {
            originator
        })
    }

    _onunhold (originator) {
        logger.debug('session onunhold')

        this._setLocalMediaStatus()

        logger.debug('emit "unhold"')

        this.emit('unhold', {
            originator
        })
    }

    _onmute ({ audio, video }) {
        logger.debug('session onmute')

        this._setLocalMediaStatus()

        logger.debug('emit "muted"')

        this.emit('muted', {
            audio,
            video
        })
    }

    _onunmute ({ audio, video }) {
        logger.debug('session onunmute')

        this._setLocalMediaStatus()

        logger.debug('emit "unmuted"')

        this.emit('unmuted', {
            audio,
            video
        })
    }
}
