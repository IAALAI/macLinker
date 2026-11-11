import type { API } from '../../shared/types'

// noVNC accepts a WebSocket-like data channel. IPC keeps the VNC transport
// entirely inside Electron; no localhost HTTP/WebSocket listener is needed.
export class VncChannel {
  binaryType = 'arraybuffer'
  protocol = ''
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: Uint8Array }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null
  private unsubscribe: () => void
  constructor(
    private api: API,
    readonly id: string,
  ) {
    this.unsubscribe = api.onVnc((event) => {
      if (event.sessionId !== id || this.readyState === 3) return
      if (event.type === 'closed') {
        this.finish(event.error)
        return
      }
      try {
        this.onmessage?.({ data: event.data })
        void api.vncAck(id).catch((error) => this.fail(error))
      } catch (error) {
        this.fail(error)
      }
    })
  }
  open() {
    if (this.readyState !== 0) return
    this.readyState = 1
    this.onopen?.()
    void this.api.vncAck(this.id).catch((error) => this.fail(error))
  }
  send(data: Uint8Array) {
    if (this.readyState !== 1) throw new Error('VNC 通道已关闭')
    // noVNC reuses its send buffer immediately after send() returns.
    void this.api.vncSend(this.id, data.slice()).catch((error) => this.fail(error))
  }
  close() {
    if (this.readyState === 3) return
    this.finish()
    void this.api.closeVnc(this.id).catch(() => {})
  }
  private fail(error: unknown) {
    if (this.readyState === 3) return
    const reason = error instanceof Error ? error.message : String(error)
    this.onerror?.({ message: reason })
    this.finish(reason)
    void this.api.closeVnc(this.id).catch(() => {})
  }
  private finish(error?: string) {
    if (this.readyState === 3) return
    this.readyState = 3
    this.unsubscribe()
    this.onclose?.({ code: error ? 1011 : 1000, reason: error || '', wasClean: !error })
  }
}
