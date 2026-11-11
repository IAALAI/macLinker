import { Client, type SFTPWrapper, type ClientChannel } from 'ssh2'
import fs from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import type {
  AppEvent,
  Connection,
  Credentials,
  Device,
  Directory,
  CommandResult,
  Transfer,
} from '../shared/types'
import { errorMessage, pathSchema } from './validation'

export class Remote {
  private client?: Client
  private sftp?: SFTPWrapper
  private generation = 0
  private commands = new Set<ClientChannel>()
  private transfers = new Map<string, { data: Transfer; abort: AbortController }>()
  connection: Connection = { state: 'disconnected' }
  constructor(private emit: (event: AppEvent) => void) {}

  private state(connection: Connection) {
    this.connection = connection
    this.emit({ type: 'connection', connection })
  }
  connected(deviceId?: string) {
    return (
      this.connection.state === 'connected' && (!deviceId || this.connection.deviceId === deviceId)
    )
  }
  forwardLoopback(port: number, timeout = 5000): Promise<ClientChannel> {
    if (!this.connected() || !this.client) return Promise.reject(new Error('请先连接 SSH'))
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      return Promise.reject(new Error('端口无效'))
    const client = this.client,
      generation = this.generation
    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        settled = true
        reject(new Error('SSH 隧道连接超时；请检查远端服务和 SSH 端口转发权限'))
      }, timeout)
      client.forwardOut('127.0.0.1', 0, '127.0.0.1', port, (error, channel) => {
        clearTimeout(timer)
        if (settled || generation !== this.generation) {
          channel?.destroy()
          if (!settled) reject(new Error('SSH 连接已改变'))
          return
        }
        settled = true
        if (error) reject(error)
        else {
          channel.pause()
          // Keep a listener even before the consumer attaches its own handler.
          channel.on('error', () => {})
          resolve(channel)
        }
      })
    })
  }
  async connect(
    device: Device,
    credentials: Credentials,
    verify: (fingerprint: string) => Promise<boolean>,
  ): Promise<Connection> {
    this.disconnect()
    const generation = ++this.generation
    this.state({ state: 'connecting', deviceId: device.id })
    const client = new Client()
    this.client = client
    try {
      const privateKey = device.identity
        ? await fs.readFile(device.identity.replace(/^~(?=[/\\])/, os.homedir()))
        : undefined
      if (generation !== this.generation) throw new Error('连接已取消')
      await new Promise<void>((resolve, reject) => {
        let settled = false,
          verificationError: Error | undefined
        const fail = (error: Error) => {
          if (!settled) {
            settled = true
            reject(verificationError ?? error)
          } else if (generation === this.generation && this.connection.state === 'connected')
            this.disconnect(error.message)
        }
        client.on('error', fail)
        client.once('ready', () => {
          settled = true
          resolve()
        })
        client.on('close', () => {
          fail(new Error('SSH 连接已关闭'))
          if (generation === this.generation && this.connection.state !== 'disconnected')
            this.disconnect('SSH 连接已关闭')
        })
        client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
          finish(
            prompts.map((prompt) =>
              /password/i.test(prompt.prompt) ? credentials.password || '' : '',
            ),
          )
        })
        client.connect({
          host: device.host,
          port: device.port,
          username: device.username,
          password: credentials.password || undefined,
          privateKey,
          passphrase: credentials.passphrase || undefined,
          agent: !privateKey && !credentials.password ? process.env.SSH_AUTH_SOCK : undefined,
          tryKeyboard: Boolean(credentials.password),
          readyTimeout: 30000,
          keepaliveInterval: 15000,
          keepaliveCountMax: 3,
          hostVerifier: (key: Buffer, callback: (verified: boolean) => void) => {
            const fingerprint =
              'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
            void verify(fingerprint).then(
              (allowed) => callback(generation === this.generation && allowed),
              (error) => {
                verificationError = new Error(errorMessage(error))
                callback(false)
              },
            )
          },
        })
      })
      const sftp = await new Promise<SFTPWrapper>((resolve, reject) =>
        client.sftp((error, sftp) => (error ? reject(error) : resolve(sftp))),
      )
      const home = await new Promise<string>((resolve, reject) =>
        sftp.realpath('.', (error, result) => (error ? reject(error) : resolve(result))),
      )
      if (generation !== this.generation) throw new Error('连接已取消')
      this.sftp = sftp
      this.state({ state: 'connected', deviceId: device.id, home })
      return this.connection
    } catch (error) {
      if (generation === this.generation) this.disconnect(errorMessage(error))
      else client.end()
      throw error
    }
  }
  disconnect(error?: string) {
    ++this.generation
    this.cancelCommands()
    for (const task of this.transfers.values())
      if (task.data.state === 'running') task.abort.abort()
    this.sftp = undefined
    const client = this.client
    this.client = undefined
    client?.end()
    this.state({ state: 'disconnected', error })
  }
  private channel(): SFTPWrapper {
    if (!this.connected() || !this.sftp) throw new Error('请先连接设备')
    return this.sftp
  }
  resolvePath(input: string): string {
    pathSchema.parse(input)
    const home = this.connection.home
    if (!home) throw new Error('请先连接设备')
    if (input === '~') return home
    if (input.startsWith('~/')) return path.posix.resolve(home, input.slice(2))
    if (!input.startsWith('/')) throw new Error('远程路径需要以 / 或 ~/ 开头')
    return path.posix.normalize(input)
  }
  async list(input: string): Promise<Directory> {
    const sftp = this.channel(),
      directory = this.resolvePath(input)
    const canonical = await new Promise<string>((resolve, reject) =>
      sftp.realpath(directory, (error, value) => (error ? reject(error) : resolve(value))),
    )
    const files = await new Promise<import('ssh2').FileEntry[]>((resolve, reject) =>
      sftp.readdir(canonical, (error, files) => (error ? reject(error) : resolve(files))),
    )
    return {
      path: canonical,
      entries: files
        .filter((file) => !['.', '..'].includes(file.filename))
        .map((file) => ({
          name: file.filename,
          path: path.posix.join(canonical, file.filename),
          kind:
            (file.attrs.mode & 0o170000) === 0o040000
              ? ('directory' as const)
              : (file.attrs.mode & 0o170000) === 0o120000
                ? ('link' as const)
                : ('file' as const),
          size: file.attrs.size,
          modified: file.attrs.mtime * 1000,
        }))
        .sort(
          (a, b) =>
            Number(b.kind === 'directory') - Number(a.kind === 'directory') ||
            a.name.localeCompare(b.name),
        ),
    }
  }
  async read(input: string, limit = 65536): Promise<string> {
    const sftp = this.channel(),
      target = this.resolvePath(input)
    const stat = await new Promise<import('ssh2').Stats>((resolve, reject) =>
      sftp.stat(target, (error, value) => (error ? reject(error) : resolve(value))),
    )
    if (!stat.isFile()) throw new Error('只能预览普通文件')
    const chunks: Buffer[] = []
    const stream = sftp.createReadStream(target, { start: 0, end: Math.max(0, limit - 1) })
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    const content = Buffer.concat(chunks)
    if (content.includes(0)) throw new Error('这是二进制文件，请下载后打开')
    return content.toString('utf8') + (stat.size > limit ? '\n\n[仅显示前 64 KiB]' : '')
  }
  async mkdir(input: string) {
    const sftp = this.channel(),
      target = this.resolvePath(input)
    await new Promise<void>((resolve, reject) =>
      sftp.mkdir(target, (error) => (error ? reject(error) : resolve())),
    )
  }
  execute(command: string, signal?: AbortSignal): Promise<CommandResult> {
    if (!this.connected() || !this.client) return Promise.reject(new Error('请先连接设备'))
    if (!command.trim() || command.length > 32768 || command.includes('\0'))
      return Promise.reject(new Error('命令为空或过长'))
    const client = this.client
    return new Promise((resolve, reject) => {
      let stream: ClientChannel | undefined,
        complete = false,
        stdout = '',
        stderr = '',
        bytes = 0,
        truncated = false
      const end = (error?: Error, code = 0) => {
        if (complete) return
        complete = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        if (stream) this.commands.delete(stream)
        if (error) {
          stream?.close()
          reject(error)
        } else resolve({ stdout, stderr, code, truncated })
      }
      const abort = () => end(new Error('操作已取消；远程命令可能仍在运行'))
      const timer = setTimeout(() => end(new Error('命令超过 60 秒；远程任务可能仍在运行')), 60000)
      if (signal?.aborted) {
        abort()
        return
      }
      signal?.addEventListener('abort', abort, { once: true })
      client.exec(command, (error, channel) => {
        if (error) {
          end(error)
          return
        }
        stream = channel
        if (complete) {
          channel.close()
          return
        }
        this.commands.add(channel)
        const data = (chunk: Buffer, isError: boolean) => {
          const remaining = 256 * 1024 - bytes
          if (chunk.length > remaining) truncated = true
          const text = chunk.subarray(0, Math.max(0, remaining)).toString('utf8')
          bytes += Math.min(chunk.length, Math.max(0, remaining))
          if (isError) stderr += text
          else stdout += text
        }
        channel.on('data', (chunk: Buffer) => data(chunk, false))
        channel.stderr.on('data', (chunk: Buffer) => data(chunk, true))
        channel.on('error', end)
        channel.on('close', (code: number | null, remoteSignal: string | null) =>
          end(undefined, typeof code === 'number' ? code : remoteSignal ? 128 : 255),
        )
      })
    })
  }
  cancelCommands() {
    for (const command of this.commands) command.close()
    this.commands.clear()
  }
  transferList() {
    return [...this.transfers.values()].map((task) => ({ ...task.data }))
  }
  cancelTransfer(id: string) {
    this.transfers.get(id)?.abort.abort()
  }
  async transfer(direction: 'upload' | 'download', local: string, input: string): Promise<void> {
    const sftp = this.channel(),
      remote = this.resolvePath(input)
    const generation = this.generation
    const stat =
      direction === 'upload'
        ? await fs.stat(local)
        : await new Promise<import('ssh2').Stats>((resolve, reject) =>
            sftp.stat(remote, (error, value) => (error ? reject(error) : resolve(value))),
          )
    if (generation !== this.generation) throw new Error('连接已改变，传输未开始')
    if (!stat.isFile()) throw new Error('当前传输支持单个文件，暂不支持上传或下载整个目录')
    const id = randomUUID(),
      abort = new AbortController()
    const data: Transfer = {
      id,
      name: path.posix.basename(remote),
      direction,
      total: stat.size,
      done: 0,
      state: 'running',
    }
    this.transfers.set(id, { data, abort })
    const publish = () => this.emit({ type: 'transfer', transfer: { ...data } })
    publish()
    // Download to a sibling temporary file; preserve an existing target if cancelled.
    const partial = local + '.maclinker-' + id + '.part'
    let lastUpdate = 0
    const progress = new Transform({
      transform(chunk, _encoding, callback) {
        data.done += chunk.length
        if (Date.now() - lastUpdate > 100) {
          lastUpdate = Date.now()
          publish()
        }
        callback(null, chunk)
      },
    })
    try {
      const reader =
        direction === 'upload' ? createReadStream(local) : sftp.createReadStream(remote)
      const writer =
        direction === 'upload'
          ? sftp.createWriteStream(remote, { flags: 'wx', mode: 0o600 })
          : createWriteStream(partial, { flags: 'wx', mode: 0o600 })
      await pipeline(reader, progress, writer, { signal: abort.signal })
      if (direction === 'download') await fs.rename(partial, local)
      data.state = 'completed'
      data.done = data.total
    } catch (error) {
      data.state = abort.signal.aborted ? 'cancelled' : 'failed'
      data.error = errorMessage(error)
      if (direction === 'download') await fs.rm(partial, { force: true })
      // Uploads use exclusive creation. A failed upload may leave a partial file;
      // report it, never remove a file that might belong to another writer.
      if (direction === 'upload') data.error += '。目标已存在或上传未完成；请检查远程文件。'
    } finally {
      publish()
      if (this.transfers.size > 100)
        for (const [key, item] of this.transfers)
          if (item.data.state !== 'running' && key !== id) {
            this.transfers.delete(key)
            break
          }
    }
  }
}
