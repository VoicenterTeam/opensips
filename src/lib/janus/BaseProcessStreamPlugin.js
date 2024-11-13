import { BasePlugin } from '@/lib/janus/BasePlugin'

export class BaseProcessStreamPlugin extends BasePlugin {
    stream = null
    running = false

    constructor (name, options = {}) {
        super(name)
        this.immediate = options.immediate || false
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
        await this.session.resyncPlugins()
    }

    _stop () {
        this.stop()
    }

    async kill () {
        this.stop()
        this.running = false
        await this.session.resyncPlugins()
    }
}
