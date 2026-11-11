import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, type ChildProcess } from 'node:child_process'
import type { AppEvent, Device, StreamOptions } from '../shared/types'
import { streamSchema } from './validation'

export function findMoonlight(custom: string): string | undefined {
  const filenames = process.platform === 'win32' ? ['Moonlight.exe'] : ['moonlight', 'moonlight-qt']
  const candidates = custom
    ? [custom.replace(/^~(?=[/\\])/, os.homedir())]
    : [
        '/Applications/Moonlight.app/Contents/MacOS/Moonlight',
        path.join(os.homedir(), 'Applications/Moonlight.app/Contents/MacOS/Moonlight'),
        path.join(
          process.env.ProgramFiles || 'C:\\Program Files',
          'Moonlight Game Streaming',
          'Moonlight.exe',
        ),
        ...[
          ...(process.env.PATH || '').split(path.delimiter),
          path.join(os.homedir(), '.local/bin'),
        ].flatMap((dir) => filenames.map((file) => path.join(dir, file))),
      ]
  return candidates.find((candidate) => {
    try {
      fs.accessSync(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK)
      return fs.statSync(candidate).isFile()
    } catch {
      return false
    }
  })
}
export function streamArgs(device: Device, input: StreamOptions): string[] {
  const options = streamSchema.parse(input)
  return [
    'stream',
    '--resolution',
    options.resolution,
    '--fps',
    String(options.fps),
    '--bitrate',
    String(options.bitrate),
    '--absolute-mouse',
    '--audio-config',
    'stereo',
    '--display-mode',
    'windowed',
    '--',
    device.streamHost || device.host,
    device.streamApp,
  ]
}
export class Moonlight {
  private child?: ChildProcess
  constructor(private emit: (event: AppEvent) => void) {}
  get running() {
    return Boolean(this.child)
  }
  async launch(device: Device, custom: string, options?: StreamOptions) {
    if (this.child) throw new Error('Moonlight 已在运行，请先结束当前窗口')
    const binary = findMoonlight(custom)
    if (!binary) throw new Error('未找到 Moonlight。安装 Moonlight Qt 后重试，或在设置中指定路径。')
    const child = spawn(
      binary,
      options ? streamArgs(device, options) : ['pair', '--', device.streamHost || device.host],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false },
    )
    this.child = child
    let detail = ''
    const capture = (data: Buffer) => {
      detail = (detail + data.toString()).slice(-4000)
    }
    child.stdout?.on('data', capture)
    child.stderr?.on('data', capture)
    child.on('exit', (code) => {
      if (this.child === child) {
        this.child = undefined
        this.emit({
          type: 'stream',
          running: false,
          error: code ? `Moonlight 退出 (${code})：${detail}` : undefined,
        })
      }
    })
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => {
        this.emit({ type: 'stream', running: true })
        resolve()
      })
      child.once('error', (error) => {
        if (this.child === child) this.child = undefined
        this.emit({ type: 'stream', running: false, error: error.message })
        reject(error)
      })
    })
  }
  stop() {
    this.child?.kill()
  }
}
