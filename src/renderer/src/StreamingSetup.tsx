import { useState } from 'react'
import { ArrowUpRight, CheckCircle2, Circle, Monitor, RefreshCw } from 'lucide-react'
import type { DesktopCapabilities, Device } from '../../shared/types'
import { streamingSetup, type SetupResource } from '../../shared/streaming-setup'
import { api, Modal, message } from './components'

export function StreamingSetup({
  device,
  report,
  streamRunning,
  onClose,
  onVnc,
}: {
  device: Device
  report: DesktopCapabilities
  streamRunning: boolean
  onClose(): void
  onVnc(): void
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const next = streamingSetup(report),
    checking = report.state === 'checking'
  async function perform(action: () => Promise<unknown>) {
    setError('')
    setBusy(true)
    try {
      await action()
    } catch (error) {
      setError(message(error))
    } finally {
      setBusy(false)
    }
  }
  const open = (resource: SetupResource) => void perform(() => api.openSetupResource(resource))
  const icon = (done: boolean) =>
    done ? (
      <CheckCircle2 size={19} className="success-text" />
    ) : (
      <Circle size={19} className="muted" />
    )
  return (
    <Modal
      title="设置高性能串流"
      subtitle={`${device.name} · Moonlight + Sunshine`}
      onClose={onClose}
    >
      <div className="streaming-setup-content">
        <div className="streaming-setup-summary">
          <strong>{next.title}</strong>
          <p>{next.detail}</p>
        </div>
        <ol className="streaming-setup-steps">
          <li>
            {icon(report.sunshineInstalled === true)}
            <div>
              <h3>1. 在被控 Mac 安装 Sunshine</h3>
              <span className="setup-status">
                {report.sunshineInstalled === null
                  ? '尚未确认'
                  : report.sunshineInstalled
                    ? '已安装'
                    : '未检测到安装'}
              </span>
              <p>
                在 {device.name} 上下载与芯片架构匹配的 macOS 安装包，将 Sunshine
                放入“应用程序”。服务端只需要安装一次。
              </p>
              <div className="setup-actions">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => open('sunshine-download')}
                >
                  Sunshine 官方下载
                  <ArrowUpRight size={14} />
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => open('sunshine-guide')}
                >
                  安装说明
                </button>
              </div>
              <small>以上链接在当前电脑的浏览器打开；Sunshine 需要安装在被控 Mac。</small>
              <details>
                <summary>Mac 已有 Homebrew？</summary>
                <p>也可在被控 Mac 的终端执行：</p>
                <pre>brew tap LizardByte/homebrew{'\n'}brew install sunshine</pre>
              </details>
            </div>
          </li>
          <li>
            {icon(report.sunshineRunning === true)}
            <div>
              <h3>2. 启动并完成 Mac 授权</h3>
              <span className="setup-status">
                {report.sunshineRunning === null
                  ? '尚未确认'
                  : report.sunshineRunning
                    ? '进程正在运行 · 系统授权仍需确认'
                    : '尚未运行'}
              </span>
              <p>
                在 Mac 的已登录桌面中启动
                Sunshine，按提示授予屏幕录制、音频与输入相关权限，然后在管理页设置账户。Homebrew
                安装可在 Mac 终端运行 sunshine。
              </p>
              <div className="setup-actions">
                <button
                  className="button secondary"
                  disabled={busy || !report.sunshineRunning}
                  onClick={() => void perform(() => api.openSunshine(device.id))}
                >
                  Sunshine 管理页
                  <ArrowUpRight size={14} />
                </button>
                {report.vncAvailable && (
                  <button className="text-button" onClick={onVnc}>
                    <Monitor size={14} />
                    通过 VNC 操作 Mac
                  </button>
                )}
              </div>
              <small>管理页打不开时，可在 Mac 浏览器打开 https://localhost:47990。</small>
            </div>
          </li>
          <li>
            {icon(report.moonlightInstalled)}
            <div>
              <h3>3. 在当前电脑安装 Moonlight</h3>
              <span className="setup-status">
                {report.moonlightInstalled ? '已找到本机客户端' : '未找到本机客户端'}
              </span>
              <p>
                macLinker 调用官方 Moonlight 完成音视频串流，桌面会在独立窗口打开。已有便携版可在
                macLinker 设置中指定程序路径。
              </p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => open('moonlight-download')}
              >
                Moonlight 官方下载
                <ArrowUpRight size={14} />
              </button>
            </div>
          </li>
          <li>
            <Circle size={19} className="muted" />
            <div>
              <h3>4. 配对并验证画面与声音</h3>
              <span className="setup-status">配对状态需在 Moonlight 中确认</span>
              <p>
                首次配对时，将 Moonlight 显示的 PIN 输入 Sunshine
                管理页。配对完成后返回概览打开桌面；已配对的设备可直接连接。
              </p>
              <button
                className="button secondary"
                disabled={busy || checking || next.stage !== 'pair' || streamRunning}
                onClick={() => void perform(() => api.pair(device.id))}
              >
                开始 Moonlight 配对
              </button>
            </div>
          </li>
        </ol>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button
            className="button secondary"
            disabled={busy || checking}
            onClick={() => void perform(() => api.inspectDesktop())}
          >
            <RefreshCw size={15} />
            {checking ? '检查中…' : '重新检查串流环境'}
          </button>
          <button className="button primary" onClick={onClose}>
            返回设备概览
          </button>
        </footer>
      </div>
    </Modal>
  )
}
