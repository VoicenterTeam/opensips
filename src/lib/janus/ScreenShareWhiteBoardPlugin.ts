// @ts-nocheck
import { ConferencingModeType } from './enum/conferencing.enum'
import { KonvaDrawer } from './utils/KonvaDrawer'
import { KonvaDrawerOptions } from './types/konvaDrawer'
import { BaseProcessStreamPlugin } from '@/lib/janus/BaseProcessStreamPlugin'

export class ScreenShareWhiteBoardPlugin extends BaseProcessStreamPlugin{
    private static video: HTMLVideoElement | null = null
    private static wrapperEl: HTMLDivElement | null = null
    private static screenShareKonvaDrawer: KonvaDrawer | null = null
    private static initialStream: MediaStream | null = null
    private imageSrc: string | null = null
    private konvaDrawer: KonvaDrawer | null = null
    public mode: ConferencingModeType = undefined
    private screenSharePlugin: unknown = null
    //rtcConnection: any = null
    //name = 'janus.plugin.videoroom'
    //stunServers: StunServer[]

    //VideoRoomPlugin = null
    //ScreenSharePlugin = null

    constructor (screenSharePlugin) {
        super('ScreenShareWhiteboard', 'screen')

        this.screenSharePlugin = screenSharePlugin
    }

    private createVideoElement () {
        const video = document.createElement('video')
        video.setAttribute('id', 'whiteboard-source-video')
        video.setAttribute('autoplay', '')
        // Uncomment to flip horizontally as the image from camera is mirrored.
        /*video.style.setProperty('-webkit-transform', 'scaleX(-1)')
    video.style.setProperty('transform', 'scaleX(-1)')*/
        video.style.setProperty('visibility', 'hidden')
        video.style.setProperty('width', 'auto')
        video.style.setProperty('height', 'auto')
        this.video = video

        const divWrapper = document.createElement('div')
        divWrapper.classList.add('whiteboard-wrapper')
        divWrapper.style.setProperty('display', 'none')
        divWrapper.appendChild(video)

        this.wrapperEl = divWrapper

        document.body.appendChild(divWrapper)
    }

    getAspectRatioDimensions (stream: MediaStream, wrapperEl: HTMLElement) {
        const streamSettings = stream.getTracks()[0].getSettings()

        const wrapperWidth = wrapperEl.clientWidth
        const wrapperHeight = wrapperEl.clientHeight

        console.log('getAspectRatioDimensions streamSettings', streamSettings)

        const videoStreamWidth = streamSettings.width
        const videoStreamHeight = streamSettings.height

        // Calculate aspect ratio
        const videoAspectRatio = videoStreamWidth / videoStreamHeight
        const wrapperAspectRatio = wrapperWidth / wrapperHeight

        let width = 0
        let height = 0

        // Determine which aspect ratio is limiting
        if (videoAspectRatio > wrapperAspectRatio) {
            // Limited by width
            width = wrapperWidth
            height = wrapperWidth / videoAspectRatio
        } else {
            // Limited by height
            height = wrapperHeight
            width = wrapperHeight * videoAspectRatio
            console.log('getAspectRatioDimensions else wrapperHeight', wrapperHeight)
            console.log('getAspectRatioDimensions else videoAspectRatio', videoAspectRatio)
            console.log('getAspectRatioDimensions else width', width)
        }

        return {
            width,
            height
        }
    }

    /**
   * Starts stream processing to add mask effect for it
   * This method is useful in cases like drawing over the screen share as we
   * already have a screen share stream and there is no need to create another one
   * @param {MediaStream} stream
   * @return {MediaStream} processed stream with mask effect
   */
    async start (stream) {
        this.createVideoElement()

        //const stream = this.screenSharePlugin.getStream()
        this.initialStream = stream
        this.video.srcObject = stream

        const wrapperEl = document.getElementById('screen-share-video-container')
        const compositeCanvasContainerEl = document.getElementById('composite-canvas-container')

        const { width, height } = this.getAspectRatioDimensions(stream, wrapperEl)
        let shareWidth = width, shareHeight = height

        this.screenShareKonvaDrawer = new KonvaDrawer({
            container: 'container',
            width: shareWidth,
            height: shareHeight
        })

        const layer = this.screenShareKonvaDrawer.addLayer()
        this.screenShareKonvaDrawer.initFreeDrawing(layer)

        const container = document.getElementById('container')
        const canvas = container.querySelector('canvas')
        const canvasContent = container.querySelector('.konvajs-content')


        const compositeCanvas = document.getElementById('composite-canvas') as HTMLCanvasElement
        const compositeCtx = compositeCanvas.getContext('2d')

        const resizeCanvasElements = () => {
            const { width, height } = this.getAspectRatioDimensions(stream, wrapperEl)
            shareWidth = width
            shareHeight = height

            // Set dimensions similar to the drawing canvas or screen capture
            canvas.width = width
            canvas.height = height
            canvas.style.width = `${width}px`
            canvas.style.height = `${height}px`

            canvasContent.style.width = `${width}px`
            canvasContent.style.height = `${height}px`

            compositeCanvasContainerEl.style.height = `${height}px`

            compositeCanvas.width = width
            compositeCanvas.height = height
        }

        resizeCanvasElements()
        // TODO Remove once detached
        window.addEventListener('resize', () => {
            resizeCanvasElements()
            this.screenShareKonvaDrawer.addWakeupLine(layer)
        })

        const screenVideo = this.video

        const draw = ()=>  {
            // Draw the video frame
            compositeCtx.drawImage(screenVideo, 0, 0, shareWidth, shareHeight)

            // Draw the drawing canvas
            compositeCtx.drawImage(canvas, 0, 0, shareWidth, shareHeight)

            requestAnimationFrame(draw)
        }

        draw()

        return compositeCanvas.captureStream(30) // 30 FPS
    }

    /**
   * Stops stream processing
   */
    stop () {
        const stream = this.initialStream
        this.initialStream = null
        this.video = null
        this.wrapperEl = null
        this.screenShareKonvaDrawer = null
        return stream
    }

    setupScreenShareDrawerOptions (options: KonvaDrawerOptions) {
        if (this.screenShareKonvaDrawer) {
            this.screenShareKonvaDrawer.setupDrawerOptions(options)
        }
    }
}
