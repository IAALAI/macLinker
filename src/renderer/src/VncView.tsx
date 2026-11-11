import { useEffect, useRef, useState, type FormEvent } from 'react'
import RFB from '@novnc/novnc'
import { ArrowLeft, Monitor, RefreshCw, ShieldCheck } from 'lucide-react'
import type { Device } from '../../shared/types'
import { api, Field, message } from './components'
import { VncChannel } from './vnc-channel'

export function VncView({ device, onBack }: { device: Device; onBack(): void }) {
  const target = useRef<HTMLDivElement>(null),
    rfb = useRef<RFB | undefined>(undefined)
  const [status, setStatus] = useState('正在建立 SSH 隧道…'),
    [error, setError] = useState('')
  const [required, setRequired] = useState<string[]>([]),
    [username, setUsername] = useState(device.username)
  const [password, setPassword] = useState(''),
    [attempt, setAttempt] = useState(0),
    [connected, setConnected] = useState(false)
  const [viewOnly, setViewOnly] = useState(false)
  useEffect(() => {
    let disposed = false,
      channel: VncChannel | undefined,
      client: RFB | undefined
    setError('')
    setRequired([])
    setPassword('')
    setConnected(false)
    setViewOnly(false)
    setStatus('正在建立 SSH 隧道…')
    void api
      .openVnc(device.id)
      .then((session) => {
        if (disposed) {
          void api.closeVnc(session.sessionId).catch(() => {})
          return
        }
        channel = new VncChannel(api, session.sessionId)
        client = new RFB(target.current!, channel, { shared: true })
        rfb.current = client
        client.scaleViewport = true
        client.resizeSession = false
        client.background = '#1d2923'
        client.focusOnClick = true
        client.addEventListener('connect', () => {
          if (disposed) return
          setConnected(true)
          setRequired([])
          setPassword('')
          setStatus('VNC 已连接 · SSH 加密传输')
        })
        client.addEventListener('credentialsrequired', (event) => {
          if (disposed) return
          const types = (event as CustomEvent<{ types: string[] }>).detail.types
          setRequired(types)
          setStatus('请完成 VNC 桌面认证')
        })
        client.addEventListener('securityfailure', (event) => {
          if (disposed) return
          const detail = (event as CustomEvent<{ reason?: string }>).detail
          setRequired([])
          setPassword('')
          setError(detail.reason || 'VNC 认证失败，请检查屏幕共享的访问权限和密码')
        })
        client.addEventListener('disconnect', (event) => {
          if (disposed) return
          setConnected(false)
          setRequired([])
          setPassword('')
          setStatus('VNC 已断开')
          if (!(event as CustomEvent<{ clean: boolean }>).detail.clean)
            setError(
              (previous) =>
                previous || 'VNC 连接未完成或已中断。请检查远端屏幕共享、认证方式和桌面登录状态。',
            )
        })
        channel.open()
      })
      .catch((error) => {
        channel?.close()
        if (!disposed) {
          setError(message(error))
          setStatus('VNC 无法连接')
        }
      })
    return () => {
      disposed = true
      rfb.current = undefined
      client?.disconnect()
      channel?.close()
    }
  }, [device.id, attempt])
  function authenticate(event: FormEvent) {
    event.preventDefault()
    rfb.current?.sendCredentials({ username, password })
    setPassword('')
    setRequired([])
    setStatus('正在验证桌面凭据…')
  }
  return (
    <div className="workspace-page vnc-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">DESKTOP OVER SSH</p>
          <h1>{device.name} · VNC</h1>
          <p>内置远程桌面回退 · 不提供音频 · 离开此页会断开 VNC</p>
        </div>
        <button className="button secondary" onClick={onBack}>
          <ArrowLeft size={15} />
          返回概览
        </button>
      </div>
      <section className="panel vnc-panel">
        <header>
          <span>
            <ShieldCheck size={16} />
            {status}
          </span>
          <div>
            <label className="checkbox">
              <input
                type="checkbox"
                disabled={!connected}
                checked={viewOnly}
                onChange={(event) => {
                  setViewOnly(event.target.checked)
                  if (rfb.current) rfb.current.viewOnly = event.target.checked
                }}
              />
              仅查看
            </label>
            <button
              className="icon-button"
              aria-label="重连 VNC"
              onClick={() => setAttempt((value) => value + 1)}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </header>
        {error && (
          <div role="alert" className="inline-error">
            {error}
          </div>
        )}
        <div className="vnc-screen" ref={target} data-testid="vnc-screen" />
        {required.length > 0 && (
          <form className="vnc-auth" onSubmit={authenticate}>
            <Monitor size={24} />
            <h2>VNC 桌面认证</h2>
            <p>
              {required.includes('username')
                ? '请输入屏幕共享允许访问的 Mac 账户。'
                : '请输入远端屏幕共享设置中的 VNC 密码；它可能与 SSH 密码不同。'}
            </p>
            {required.includes('username') && (
              <Field label="VNC 用户名">
                <input
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                />
              </Field>
            )}
            <Field label="VNC 密码">
              <input
                autoFocus
                type="password"
                autoComplete="off"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </Field>
            <button className="button primary">验证并连接</button>
          </form>
        )}
      </section>
    </div>
  )
}
