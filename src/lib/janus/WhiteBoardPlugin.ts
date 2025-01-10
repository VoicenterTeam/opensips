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
        super('WhiteBoard')

        this.mode = options.mode
        if (options.imageSrc) {
            this.imageSrc = options.imageSrc
        }
    }

    setupDrawerOptions (options: KonvaDrawerOptions) {
        if (this.konvaDrawer) {
            this.konvaDrawer.setupDrawerOptions(options)
        }
    }

    setupDrawerImage (imageSrc) {
        this.imageSrc = imageSrc
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
