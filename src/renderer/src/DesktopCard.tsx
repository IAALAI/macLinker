import { useState } from 'react'
import {
  ArrowUpRight,
  Command,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Square,
  Volume2,
  Zap,
} from 'lucide-react'
import type { DesktopCapabilities, Device, StreamOptions } from '../../shared/types'
import { streamingSetup } from '../../shared/streaming-setup'
import { StreamingSetup } from './StreamingSetup'

export function DesktopCard({
  device,
  connected,
  capabilities,
  streamRunning,
  onStream,
  onVnc,
  onConnect,
  onStop,
  onRetry,
  onPair,
  onSunshine,
}: {
  device?: Device
  connected: boolean
  capabilities?: DesktopCapabilities
  streamRunning: boolean
  onStream(options: StreamOptions): Promise<void>
  onVnc(): void
  onConnect(): void
  onStop(): void
  onRetry(): void
  onPair(): void
  onSunshine(): void
}) {
  const [options, setOptions] = useState<StreamOptions>({
    resolution: '1920x1080',
    fps: 60,
    bitrate: 20000,
  })
  const [opening, setOpening] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const checking = capabilities?.state === 'checking'
  const recommended = capabilities?.recommendation
  const subtitle = !connected
    ? '先连接 SSH，自动检查桌面服务'
    : checking
      ? '正在检查 Sunshine 与 VNC…'
      : recommended === 'moonlight'
        ? '优先使用 Moonlight，支持 VNC 回退'
        : recommended === 'vnc'
          ? '当前使用内置 VNC 回退'
          : '当前仅 SSH 功能可用'
  async function open() {
    setOpening(true)
    try {
      await onStream(options)
    } finally {
      setOpening(false)
    }
  }
  return (
    <section className="panel stream-panel desktop-card">
      <div className="section-title">
        <span className="icon-tile">
          <Monitor size={19} />
        </span>
        <div>
          <h2>打开远程桌面</h2>
          <p>{subtitle}</p>
        </div>
        <ArrowUpRight size={17} className="muted" />
      </div>
      {connected && capabilities && !checking && (
        <div className={'desktop-readiness ' + recommended}>
          <strong>
            {recommended === 'moonlight'
              ? 'Sunshine 已就绪'
              : recommended === 'vnc'
                ? '屏幕共享 / VNC 已响应'
                : 'SSH 已就绪，桌面服务待开启'}
          </strong>
          <p>
            {recommended === 'moonlight'
              ? '使用高画质、低延迟串流；首次使用需要配对。'
              : recommended === 'vnc'
                ? '通过 SSH 加密连接，直接在此窗口操作；VNC 不提供音频。'
                : '可以先使用文件、命令和 AI。要查看桌面，请在 Mac 开启屏幕共享，或安装并启动 Sunshine。'}
          </p>
          {capabilities.sunshineInstalled === false && (
            <small>未检测到 Sunshine（Moonlight 服务端）</small>
          )}
          {capabilities.sunshineInstalled === true && capabilities.sunshineRunning === false && (
            <small>Sunshine 已安装，但尚未运行</small>
          )}
          {capabilities.state === 'error' && <small>部分检查未完成，可点击重新检查。</small>}
        </div>
      )}
      {(!connected || checking || recommended === 'moonlight') && (
        <>
          <div className="stream-features">
            <span>
              <Zap size={14} />
              低延迟
            </span>
            <span>
              <Volume2 size={14} />
              立体声
            </span>
            <span>
              <Command size={14} />
              键鼠控制
            </span>
          </div>
          <div className="stream-config">
            <label>
              分辨率
              <select
                aria-label="串流分辨率"
                value={options.resolution}
                onChange={(event) =>
                  setOptions((previous) => ({ ...previous, resolution: event.target.value }))
                }
              >
                <option value="1280x720">720p</option>
                <option value="1920x1080">1080p · Full HD</option>
                <option value="2560x1440">1440p · QHD</option>
                <option value="3840x2160">2160p · 4K</option>
              </select>
            </label>
            <div className="form-row">
              <label>
                帧率
                <select
                  aria-label="串流帧率"
                  value={options.fps}
                  onChange={(event) =>
                    setOptions((previous) => ({ ...previous, fps: Number(event.target.value) }))
                  }
                >
                  {[30, 60, 120].map((value) => (
                    <option key={value} value={value}>
                      {value} FPS
                    </option>
                  ))}
                </select>
              </label>
              <label>
                码率
                <select
                  aria-label="串流码率"
                  value={options.bitrate}
                  onChange={(event) =>
                    setOptions((previous) => ({ ...previous, bitrate: Number(event.target.value) }))
                  }
                >
                  {[10000, 20000, 40000, 80000].map((value) => (
                    <option key={value} value={value}>
                      {value / 1000} Mbps
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </>
      )}
      {connected && !checking && recommended === 'ssh' && (
        <div className="desktop-setup">
          <ShieldCheck size={18} />
          <p>
            Mac：系统设置 → 通用 → 共享 → 屏幕共享。若使用远程管理，请在其中配置访问权限。
            <br />
            仅开启 SSH 不会自动启用图形桌面。
          </p>
        </div>
      )}
      {connected && capabilities && !checking && recommended !== 'moonlight' && (
        <div className="streaming-upgrade">
          <Zap size={17} />
          <div>
            <strong>{streamingSetup(capabilities).title}</strong>
            <p>{streamingSetup(capabilities).detail}</p>
            <button className="text-button" onClick={() => setSetupOpen(true)}>
              设置高性能串流
              <ArrowUpRight size={13} />
            </button>
          </div>
        </div>
      )}
      <button
        className="button dark full-width"
        disabled={
          !device ||
          opening ||
          (!streamRunning && connected && (checking || !capabilities || recommended === 'ssh'))
        }
        onClick={() => (streamRunning ? onStop() : !connected ? onConnect() : void open())}
      >
        {streamRunning ? (
          <>
            <Square size={15} />
            结束 Moonlight 进程
          </>
        ) : checking ? (
          <>正在检查桌面服务…</>
        ) : (
          <>
            <Monitor size={16} />
            {!connected
              ? '先连接 SSH'
              : opening
                ? '正在准备桌面…'
                : recommended === 'vnc'
                  ? '使用 VNC 打开桌面'
                  : recommended === 'ssh'
                    ? '请先开启桌面服务'
                    : '打开桌面（自动选择）'}
            <ArrowUpRight size={16} />
          </>
        )}
      </button>
      <div className="desktop-secondary">
        {connected && (
          <button className="text-button" disabled={checking} onClick={onRetry}>
            <RefreshCw size={12} />
            重新检查
          </button>
        )}
        {connected && capabilities?.vncAvailable && recommended === 'moonlight' && (
          <button className="text-button" onClick={onVnc}>
            改用 VNC
          </button>
        )}
        {connected && recommended === 'moonlight' && (
          <button className="text-button" onClick={() => setSetupOpen(true)}>
            串流设置指南
          </button>
        )}
      </div>
      <div className="stream-links">
        <button
          disabled={
            !connected ||
            !capabilities?.sunshineRunning ||
            !capabilities?.moonlightInstalled ||
            !capabilities?.streamReachable ||
            streamRunning ||
            checking
          }
          onClick={onPair}
        >
          Moonlight 配对
        </button>
        <span>·</span>
        <button disabled={!device} onClick={onSunshine}>
          Sunshine 管理页
          <ArrowUpRight size={12} />
        </button>
      </div>
      {setupOpen && connected && device && capabilities && (
        <StreamingSetup
          device={device}
          report={capabilities}
          streamRunning={streamRunning}
          onClose={() => setSetupOpen(false)}
          onVnc={onVnc}
        />
      )}
    </section>
  )
}
