import net from 'node:net'
import type { ClientChannel } from 'ssh2'
import type { Remote } from './remote'
import type { DesktopCapabilities, Device, Check } from '../shared/types'
import { errorMessage } from './validation'

export const HOST_PROBE = `
printf 'MACLINKER_OS='; uname -s
if [ "$(uname -s)" = Darwin ]; then sw_vers; fi
if [ -d /Applications/Sunshine.app ] || [ -d "$HOME/Applications/Sunshine.app" ] ||
   [ -x /opt/homebrew/bin/sunshine ] || [ -x /usr/local/bin/sunshine ] || command -v sunshine >/dev/null 2>&1; then
  echo MACLINKER_SUNSHINE_INSTALLED=1
else echo MACLINKER_SUNSHINE_INSTALLED=0; fi
if pgrep -ix sunshine >/dev/null 2>&1; then echo MACLINKER_SUNSHINE_RUNNING=1
else echo MACLINKER_SUNSHINE_RUNNING=0; fi
`

export function tcpReachable(host: string, port: number, timeout = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const timer = setTimeout(() => finish(false), timeout)
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(ok)
    }
    socket.on('connect', () => finish(true))
    socket.on('error', () => finish(false))
  })
}

export async function probeVnc(
  open: () => Promise<ClientChannel>,
  timeout = 2500,
): Promise<{ ok: boolean; detail: string }> {
  let channel: ClientChannel
  try {
    channel = await open()
  } catch (error) {
    return { ok: false, detail: '无法通过 SSH 连接远端 VNC：' + errorMessage(error) }
  }
  return new Promise((resolve) => {
    let banner = Buffer.alloc(0),
      settled = false
    const finish = (ok: boolean, detail: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      channel.destroy()
      resolve({ ok, detail })
    }
    const timer = setTimeout(() => finish(false, '远端端口未返回 VNC 协议标识'), timeout)
    channel.on('data', (chunk: Buffer) => {
      banner = Buffer.concat([banner, chunk.subarray(0, 12 - banner.length)])
      if (banner.length < 12) return
      const ok = /^RFB \d{3}\.\d{3}\n$/.test(banner.toString('ascii'))
      finish(
        ok,
        ok ? 'VNC 已响应，可通过 SSH 隧道连接；仍需完成桌面认证' : '端口有响应，但不是 VNC 服务',
      )
    })
    channel.once('error', (error: Error) => finish(false, errorMessage(error)))
    channel.once('close', () => finish(false, 'VNC 服务在握手前关闭连接'))
    channel.resume()
  })
}

export function preferredDesktop(
  input: Pick<
    DesktopCapabilities,
    | 'sunshineInstalled'
    | 'sunshineRunning'
    | 'streamReachable'
    | 'moonlightInstalled'
    | 'vncAvailable'
  >,
): DesktopCapabilities['recommendation'] {
  if (
    input.sunshineInstalled &&
    input.sunshineRunning &&
    input.streamReachable &&
    input.moonlightInstalled
  )
    return 'moonlight'
  return input.vncAvailable ? 'vnc' : 'ssh'
}

type ProbeRemote = Pick<Remote, 'execute' | 'forwardLoopback'>
export async function inspectDesktop(
  remote: ProbeRemote,
  device: Device,
  moonlightPath: string | undefined,
  tcp: typeof tcpReachable = tcpReachable,
): Promise<DesktopCapabilities> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    const [host, stream, web, vnc] = await Promise.all([
      remote.execute(HOST_PROBE, controller.signal).then(
        (result) => ({ result, error: '' }),
        (error) => ({ result: null, error: errorMessage(error) }),
      ),
      tcp(device.streamHost || device.host, 47989),
      tcp(device.streamHost || device.host, 47990),
      probeVnc(() => remote.forwardLoopback(device.vncPort ?? 5900)),
    ])
    const text = host.result?.stdout ?? ''
    const installed = /^MACLINKER_SUNSHINE_INSTALLED=([01])$/m.exec(text)
    const running = /^MACLINKER_SUNSHINE_RUNNING=([01])$/m.exec(text)
    const sunshineRunning = running ? running[1] === '1' : null
    const sunshineInstalled = sunshineRunning || (installed ? installed[1] === '1' : null)
    const checks: Check[] = [
      { name: 'SSH 连接', ok: true, detail: '已认证；文件、命令和 AI 工具可用' },
      {
        name: 'Sunshine 安装',
        ok: sunshineInstalled === true,
        detail:
          sunshineInstalled === null
            ? '检查失败，可重试；SSH 仍然可用'
            : sunshineInstalled
              ? '被控端已安装 Moonlight 的服务端 Sunshine'
              : '未检测到 Sunshine；可使用已开启的屏幕共享 / VNC',
      },
      {
        name: 'Sunshine 运行',
        ok: sunshineRunning === true,
        detail: sunshineRunning
          ? '服务正在运行'
          : '未检测到运行中的 Sunshine，可在 Mac 桌面会话中启动',
      },
      {
        name: 'Moonlight 客户端',
        ok: Boolean(moonlightPath),
        detail: moonlightPath || '本机未找到 Moonlight；内置 VNC 无需额外客户端',
      },
      {
        name: '串流 TCP 47989',
        ok: stream,
        detail: stream ? '端口可达；音视频与 UDP 仍需实际连接验证' : '串流端口不可达',
      },
      { name: '管理页 TCP 47990', ok: web, detail: web ? '管理页端口可达' : '管理页端口不可达' },
      { name: `VNC / 屏幕共享 ${device.vncPort ?? 5900}`, ok: vnc.ok, detail: vnc.detail },
    ]
    const capabilities: DesktopCapabilities = {
      deviceId: device.id,
      state: host.result?.code === 0 && installed && running ? 'ready' : 'error',
      sunshineInstalled,
      sunshineRunning,
      moonlightInstalled: Boolean(moonlightPath),
      streamReachable: stream,
      vncAvailable: vnc.ok,
      recommendation: 'ssh',
      checks,
      checkedAt: Date.now(),
      error:
        host.error ||
        (host.result?.code !== 0 ? host.result?.stderr || '远端检查未完成' : undefined),
    }
    capabilities.recommendation = preferredDesktop(capabilities)
    return capabilities
  } finally {
    clearTimeout(timeout)
  }
}
