export default class WebrctClient {
  wsUri: string
  videoElement: HTMLVideoElement
  terminated: boolean = false
  restartPause: number = 2000
  ws: WebSocket | null = null
  pc: RTCPeerConnection | null = null
  restartTimeout: number | null = null
  onOnline: () => void
  onOffline: () => void

  constructor(options: { videoElement: HTMLVideoElement; wsUri: string; onOnline: () => void; onOffline: () => void }) {
    if (!options?.videoElement) throw new Error('videoElement is required')
    if (!options.wsUri) throw new Error('wsUri is required')
    this.wsUri = options.wsUri
    this.videoElement = options.videoElement
    this.onOnline = options.onOnline
    this.onOffline = options.onOffline
  }

  start() {
    console.log('connecting')

    this.ws = new WebSocket(this.wsUri)

    this.ws.onerror = () => {
      console.log('ws error')
      if (this.ws === null) {
        return
      }
      this.ws.close()
      this.ws = null
    }

    this.ws.onclose = () => {
      console.log('ws closed')
      this.ws = null
      this.onOffline()
      this.scheduleRestart()
    }

    this.ws.onmessage = msg => this.onIceServers(msg)
  }

  onIceServers(msg: MessageEvent) {
    if (this.ws === null) {
      return
    }

    const iceServers = JSON.parse(msg.data)

    this.pc = new RTCPeerConnection({
      iceServers
    })

    this.ws.onmessage = msg => this.onRemoteDescription(msg)
    this.pc.onicecandidate = evt => this.onIceCandidate(evt)

    this.pc.oniceconnectionstatechange = () => {
      if (this.pc === null) {
        return
      }

      console.log('peer connection state:', this.pc.iceConnectionState)

      switch (this.pc.iceConnectionState) {
        case 'connected':
          this.pc.onicecandidate = undefined
          this.ws.onmessage = undefined
          this.ws.onerror = undefined
          this.ws.onclose = undefined
          // do not close the WebSocket connection
          // in order to allow the other side of the connection
          // to switch to the "connected" state before WebSocket is closed.
          this.onOnline()
          break

        case 'disconnected':
          this.scheduleRestart()
          this.onOffline()
      }
    }

    this.pc.ontrack = evt => {
      console.log('new track ' + evt.track.kind)
      this.videoElement.srcObject = evt.streams[0]
    }

    const direction = 'sendrecv'
    this.pc.addTransceiver('video', { direction })
    this.pc.addTransceiver('audio', { direction })

    this.pc.createOffer().then(desc => {
      if (this.pc === null || this.ws === null) {
        return
      }

      this.pc.setLocalDescription(desc)

      console.log('sending offer')
      this.ws.send(JSON.stringify(desc))
    })
  }

  onRemoteDescription(msg) {
    if (this.pc === null || this.ws === null) {
      return
    }

    this.pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(msg.data)))
    this.ws.onmessage = msg => this.onRemoteCandidate(msg)
  }

  onIceCandidate(evt) {
    if (this.ws === null) {
      return
    }

    if (evt.candidate !== null) {
      if (evt.candidate.candidate !== '') {
        this.ws.send(JSON.stringify(evt.candidate))
      }
    }
  }

  onRemoteCandidate(msg) {
    if (this.pc === null) {
      return
    }

    this.pc.addIceCandidate(JSON.parse(msg.data))
  }

  scheduleRestart() {
    if (this.terminated) {
      return
    }

    if (this.ws !== null) {
      this.ws.close()
      this.ws = null
    }

    if (this.pc !== null) {
      this.pc.close()
      this.pc = null
    }

    this.restartTimeout = window.setTimeout(() => {
      this.restartTimeout = null
      this.start()
    }, this.restartPause)
  }
}
