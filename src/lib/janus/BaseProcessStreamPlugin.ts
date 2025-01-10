import { BasePlugin } from '@/lib/janus/BasePlugin'

interface BaseProcessStreamPluginOptions {
    immediate?: boolean
}

export class BaseProcessStreamPlugin extends BasePlugin {
    public stream = null
    public running = false
    public immediate = false
    public type = 'video'

    constructor (name, type, options: BaseProcessStreamPluginOptions = {}) {
        super(name)
        this.immediate = options.immediate || false
        this.type = type
    }

    start (stream) {
        return stream
    }

    stop () {
        console.log('stop')
    }

    async process (stream) {
        if (this.immediate) {
            const processedStream = await this.start(stream)
            this.running = true
            return processedStream
        }

        return stream
    }

    async connect () {
        this.running = true
        await this.session.resyncPlugins(this.type)
    }

    terminate () {
        this.stop()
    }

    async kill () {
        this.stop()
        this.running = false
        await this.session.resyncPlugins(this.type)
    }
}
