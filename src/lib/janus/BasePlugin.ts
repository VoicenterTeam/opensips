export class BasePlugin {
    public opensips = null
    public session = null
    public name: string = null

    constructor (name) {
        this.name = name
    }

    setOpensips (opensips) {
        this.opensips = opensips
    }

    setSession (session) {
        this.session = session
    }

    kill () {
        this.opensips.kill(this.name)
    }
}
