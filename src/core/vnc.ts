import { randomUUID } from 'node:crypto'
import type { ClientChannel } from 'ssh2'
import type { VncEvent } from '../shared/types'

export class VncTunnel {
  private session?: {
    id: string
    channel: ClientChannel
    awaitingAck: boolean
    pending: number
    timer: NodeJS.Timeout
  }
  private generation = 0
  constructor(private emit: (event: VncEvent) => void) {}
  async open(forward: () => Promise<ClientChannel>): Promise<{ sessionId: string }> {
    this.stop()
    const generation = this.generation
    const channel = await forward()
    if (generation !== this.generation) {
      channel.destroy()
      throw new Error('VNC 连接已取消')
    }
    channel.pause()
    const id = randomUUID()
    const session = {
      id,
      channel,
      awaitingAck: true,
      pending: 0,
      timer: setTimeout(() => this.stop(id, 'VNC 界面未响应，隧道已关闭'), 30000),
    }
    this.session = session
    channel.on('data', (chunk: Buffer) => {
      if (this.session !== session) return
      channel.pause()
      session.awaitingAck = true
      clearTimeout(session.timer)
      session.timer = setTimeout(() => this.stop(id, 'VNC 界面未响应，隧道已关闭'), 30000)
      this.emit({ type: 'data', sessionId: id, data: new Uint8Array(chunk) })
    })
    channel.on('error', (error: Error) => this.stop(id, error.message))
    channel.on('close', () => this.stop(id, '远端关闭了 VNC 连接'))
    return { sessionId: id }
  }
  ack(id: string) {
    const session = this.session
    if (!session || session.id !== id) throw new Error('VNC 会话已结束')
    if (!session.awaitingAck) return
    session.awaitingAck = false
    clearTimeout(session.timer)
    session.channel.resume()
  }
  send(id: string, data: Uint8Array): Promise<void> {
    const session = this.session
    if (!session || session.id !== id) return Promise.reject(new Error('VNC 会话已结束'))
    if (!(data instanceof Uint8Array) || data.byteLength > 256 * 1024)
      return Promise.reject(new Error('VNC 消息无效'))
    if (session.pending + data.byteLength > 4 * 1024 * 1024) {
      this.stop(id, 'VNC 发送队列已满')
      return Promise.reject(new Error('VNC 发送队列已满'))
    }
    session.pending += data.byteLength
    return new Promise((resolve, reject) =>
      session.channel.write(Buffer.from(data), (error?: Error | null) => {
        session.pending -= data.byteLength
        if (error) reject(error)
        else resolve()
      }),
    )
  }
  stop(id?: string, error?: string) {
    if (id && this.session?.id !== id) return
    ++this.generation
    const session = this.session
    this.session = undefined
    if (!session) return
    clearTimeout(session.timer)
    session.channel.destroy()
    this.emit({ type: 'closed', sessionId: session.id, error })
  }
}
