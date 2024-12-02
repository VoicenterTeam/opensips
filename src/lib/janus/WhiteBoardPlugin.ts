// @ts-nocheck
import { loadImage } from './utils/util'
import { CONFERENCING_MODE, ConferencingModeType } from './enum/conferencing.enum'
import { KonvaDrawer } from './utils/KonvaDrawer'
import { KonvaDrawerOptions } from './types/konvaDrawer'

import { BaseNewStreamPlugin } from '@/lib/janus/BaseNewStreamPlugin'

export class WhiteBoardPlugin extends BaseNewStreamPlugin {
    private visualizationConfig = {}
    private rafId: number | null = null
    private imageSrc: string | null = null
    private konvaDrawer: KonvaDrawer | null = null
    public mode: ConferencingModeType = undefined

    constructor (options: any = {}) {
        super('WhiteBoardPlugin')

        this.mode = options.mode
        if (options.imageSrc) {
            this.imageSrc = options.imageSrc
        }
    }

    private static createVideoElement () {
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

    static getAspectRatioDimensions (stream: MediaStream, wrapperEl: HTMLElement) {
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
    static async startScreenShareWhiteboard (stream) {
        this.createVideoElement()

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
    static stopScreenShareWhiteboard () {
        const stream = this.initialStream
        this.initialStream = null
        this.video = null
        this.wrapperEl = null
        this.screenShareKonvaDrawer = null
        return stream
    }

    setupDrawerOptions (options: KonvaDrawerOptions) {
        if (this.konvaDrawer) {
            this.konvaDrawer.setupDrawerOptions(options)
        }
    }

    static setupScreenShareDrawerOptions (options: KonvaDrawerOptions) {
        if (this.screenShareKonvaDrawer) {
            this.screenShareKonvaDrawer.setupDrawerOptions(options)
        }
    }

    drawEmptyWhiteboard () {
        const wrapperEl = document.getElementById('presentation-video-container')

        const width = wrapperEl.clientWidth
        const height = wrapperEl.clientHeight

        this.konvaDrawer = new KonvaDrawer({
            container: 'presentationCanvasWrapper',
            width: width,
            height: height
        })

        const layer = this.konvaDrawer.addLayer()
        this.konvaDrawer.addRect(layer, width, height)

        this.konvaDrawer.initFreeDrawing(layer)
    }

    async drawImageWhiteboard () {
        const wrapperEl = document.getElementById('presentation-video-container')

        const width = wrapperEl.clientWidth
        const height = wrapperEl.clientHeight

        //const imageSrc = 'data:image/png;base64,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'; // Replace with your Base64 image data

        const imageObj = await loadImage(this.imageSrc)

        this.konvaDrawer = new KonvaDrawer({
            container: 'presentationCanvasWrapper',
            width: width,
            height: height
        })

        const layer = this.konvaDrawer.addLayer()
        this.konvaDrawer.addImage(layer, imageObj)
        layer.batchDraw()

        this.konvaDrawer.initFreeDrawing(layer)
    }

    async generateStream () {
        if (this.mode === CONFERENCING_MODE.WHITEBOARD) {
            this.drawEmptyWhiteboard()
        } else if (this.mode === CONFERENCING_MODE.IMAGE_WHITEBOARD) {
            await this.drawImageWhiteboard()
        } else {
            return
        }

        const container = document.getElementById('presentationCanvasWrapper')
        const canvas = container.querySelector('canvas')

        const presentationCtx = canvas.getContext('2d')

        function draw () {
            presentationCtx.fillRect(0,0,1,1)

            requestAnimationFrame(draw)
        }

        draw()

        const presentationCanvasStream = canvas.captureStream(30)

        this.stream = presentationCanvasStream
    }

    async kill () {
        this.konvaDrawer = null

        await this.stop()
        this.session._ua.emit('stopWhiteboard')
    }
}
