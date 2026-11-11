import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  ArrowUpFromLine,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  Command,
  Folder,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  Monitor,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Volume2,
  Wifi,
  X,
  Zap,
} from 'lucide-react'
import type {
  Boot,
  Check as DiagnosticCheck,
  DesktopCapabilities,
  Device,
  StreamOptions,
  Transfer,
} from '../../shared/types'
import { api, bytes, ConnectModal, DeviceModal, message, SettingsView } from './components'
import { AgentView, CommandsView, FilesView } from './WorkspaceViews'
import { DesktopCard } from './DesktopCard'
import { VncView } from './VncView'

type View = 'vnc' | 'overview' | 'files' | 'commands' | 'agent' | 'settings'
const navigation = [
  { id: 'overview', label: '设备概览', icon: LayoutDashboard },
  { id: 'vnc', label: 'VNC 桌面', icon: Monitor },
  { id: 'files', label: '文件', icon: Folder },
  { id: 'commands', label: '远程命令', icon: Terminal },
  { id: 'agent', label: 'AI 助手', icon: Sparkles },
] as const

export function App() {
  const [boot, setBoot] = useState<Boot>(),
    [fatal, setFatal] = useState(''),
    [selected, setSelected] = useState(''),
    [view, setView] = useState<View>('overview')
  const [editing, setEditing] = useState<Device | 'new'>(),
    [connecting, setConnecting] = useState<Device>(),
    [notice, setNotice] = useState('')
  const [diagnosing, setDiagnosing] = useState(false)
  const [transfersOpen, setTransfersOpen] = useState(false)
  const content = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!api) {
      setFatal('请通过 Electron 启动 macLinker：运行 npm run dev 或 npm start。')
      return
    }
    let alive = true
    void api
      .boot()
      .then((data) => {
        if (alive) {
          setBoot(data)
          setSelected(data.devices[0]?.id || '')
        }
      })
      .catch((error) => {
        if (alive) setFatal(message(error))
      })
    const unsubscribe = api.onEvent((event) => {
      setBoot((previous) => {
        if (!previous) return previous
        if (event.type === 'desktop-capabilities')
          return { ...previous, desktopCapabilities: event.capabilities }
        if (event.type === 'connection') return { ...previous, connection: event.connection }
        if (event.type === 'transfer')
          return {
            ...previous,
            transfers: [
              ...previous.transfers.filter((item) => item.id !== event.transfer.id),
              event.transfer,
            ],
          }
        if (event.type === 'agent')
          return { ...previous, agentEvents: [...previous.agentEvents.slice(-199), event.event] }
        if (event.type === 'agent-state') return { ...previous, agentRunning: event.running }
        return { ...previous, streamRunning: event.running }
      })
      if (event.type === 'connection' && event.connection.error) setNotice(event.connection.error)
      if (event.type === 'stream' && event.error) setNotice(event.error)
      if (
        event.type === 'transfer' &&
        event.transfer.state === 'running' &&
        event.transfer.done === 0
      )
        setTransfersOpen(true)
      if (event.type === 'transfer' && event.transfer.state === 'failed') setTransfersOpen(true)
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])
  useEffect(() => {
    content.current?.scrollTo(0, 0)
  }, [view, selected])
  async function perform(action: () => Promise<unknown>) {
    try {
      await action()
    } catch (error) {
      setNotice(message(error))
    }
  }
  if (fatal)
    return (
      <main className="fatal">
        <Link2 size={32} />
        <h1>无法启动工作台</h1>
        <p>{fatal}</p>
      </main>
    )
  if (!boot)
    return (
      <main className="loading-screen">
        <div className="brand-icon">
          <Link2 />
        </div>
        <p>正在打开 macLinker…</p>
      </main>
    )
  const device = boot.devices.find((item) => item.id === selected)
  const capabilities =
    boot.desktopCapabilities?.deviceId === selected ? boot.desktopCapabilities : undefined
  const connected = boot.connection.state === 'connected' && boot.connection.deviceId === selected
  const connectingSelected =
    boot.connection.state === 'connecting' && boot.connection.deviceId === selected
  const select = (id: string) => {
    setSelected(id)
    setView('overview')
  }
  const saveDevices = (devices: Device[], id?: string) => {
    setBoot((previous) => previous && { ...previous, devices })
    setSelected(id || devices[0]?.id || '')
    setEditing(undefined)
    setView('overview')
  }
  async function diagnose() {
    setDiagnosing(true)
    try {
      await api.inspectDesktop()
    } catch (error) {
      setNotice(message(error))
    } finally {
      setDiagnosing(false)
    }
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Link2 size={23} strokeWidth={2.4} />
          </div>
          <span>
            mac<span>Linker</span>
          </span>
          <small>DESKTOP</small>
        </div>
        <div className="workspace-label">
          <span className="workspace-avatar">M</span>
          <div>
            个人工作空间<small>所有连接，尽在此处</small>
          </div>
        </div>
        <nav aria-label="工作空间导航">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={'nav-item ' + (view === item.id ? 'active' : '')}
              onClick={() => setView(item.id)}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.id === 'agent' && <span className="nav-new">NEW</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-section">
          <span>我的设备</span>
          <button className="icon-button" aria-label="添加设备" onClick={() => setEditing('new')}>
            <Plus size={16} />
          </button>
        </div>
        <div className="device-list">
          {boot.devices.length ? (
            boot.devices.map((item) => (
              <button
                key={item.id}
                className={'device-item ' + (selected === item.id ? 'selected' : '')}
                onClick={() => select(item.id)}
              >
                <span className={`device-icon ${item.color}`}>
                  <Monitor size={17} />
                </span>
                <span className="device-item-label">
                  {item.name}
                  <small>{item.host}</small>
                </span>
                <span
                  className={
                    'status-dot ' +
                    (boot.connection.deviceId === item.id && boot.connection.state === 'connected'
                      ? 'online'
                      : boot.connection.deviceId === item.id &&
                          boot.connection.state === 'connecting'
                        ? 'pending'
                        : '')
                  }
                />
              </button>
            ))
          ) : (
            <p className="no-devices">
              添加你的第一台 Mac，
              <br />
              开始远程工作。
            </p>
          )}
        </div>
        <button className="sidebar-add" onClick={() => setEditing('new')}>
          <Plus size={15} />
          添加设备
        </button>
        <div className="sidebar-bottom">
          <div className="local-note">
            <ShieldCheck size={19} />
            <div>
              从你的电脑，直接连接<small>不经过 macLinker 中转服务器</small>
            </div>
          </div>
          <button
            className={'nav-item ' + (view === 'settings' ? 'active' : '')}
            onClick={() => setView('settings')}
          >
            <Settings2 size={18} />
            <span>设置</span>
            <small>v{boot.version}</small>
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>工作空间</span>
            <span>/</span>
            <strong>{view === 'settings' ? '设置' : device?.name || '欢迎使用'}</strong>
          </div>
          <div className="topbar-right">
            <span className={'connection-indicator ' + (connected ? 'online' : '')}>
              <span
                className={
                  'status-dot ' + (connected ? 'online' : connectingSelected ? 'pending' : '')
                }
              />
              {connected ? 'SSH 已连接' : connectingSelected ? '正在连接' : '尚未连接'}
            </span>
            <span className="topbar-divider" />
            <button
              className="icon-button"
              aria-label="查看使用提示"
              onClick={() =>
                setNotice(
                  '至少开启 Mac 的“远程登录”。连接后会自动检查 Sunshine 和屏幕共享 / VNC；桌面未开启时仍可使用文件、命令和 AI。',
                )
              }
            >
              <CircleHelp size={18} />
            </button>
          </div>
        </header>
        <main className="main-content" ref={content}>
          {view === 'settings' ? (
            <SettingsView
              key="settings"
              settings={boot.settings}
              hasApiKey={boot.hasApiKey}
              secretStorage={boot.secretStorage}
              onSaved={(settings, hasApiKey, secretStorage) =>
                setBoot(
                  (previous) => previous && { ...previous, settings, hasApiKey, secretStorage },
                )
              }
            />
          ) : view === 'overview' ? (
            <Overview
              device={device}
              connected={connected}
              connecting={connectingSelected}
              streamRunning={boot.streamRunning}
              checks={capabilities?.checks || []}
              capabilities={capabilities}
              diagnosing={diagnosing || capabilities?.state === 'checking'}
              onAdd={() => setEditing('new')}
              onEdit={() => setEditing(device)}
              onConnect={() => device && setConnecting(device)}
              onDisconnect={() => void perform(() => api.disconnect())}
              onView={setView}
              onDiagnose={() => void diagnose()}
              onPair={() => device && void perform(() => api.pair(device.id))}
              onSunshine={() => device && void perform(() => api.openSunshine(device.id))}
              onStream={(options) =>
                perform(async () => {
                  if (device && (await api.stream(device.id, options)) === 'vnc') {
                    setTransfersOpen(false)
                    setView('vnc')
                  }
                })
              }
              onStopStream={() => void perform(() => api.stopStream())}
            />
          ) : !connected ? (
            <div className="disconnected-view">
              <div className="empty-device-icon">
                <Monitor size={35} />
              </div>
              <p className="eyebrow">YOUR WORKSPACE IS ONE CONNECTION AWAY</p>
              <h1>{device ? `连接 ${device.name}` : '先添加一台 Mac'}</h1>
              <p>
                {device
                  ? '建立 SSH 连接后，就能浏览文件、执行命令和使用 AI 助手。'
                  : '从添加设备开始，把远程 Mac 带到你的工作台。'}
              </p>
              <button
                className="button primary"
                onClick={() => (device ? setConnecting(device) : setEditing('new'))}
              >
                {device ? '连接设备' : '添加设备'}
                <ArrowUpRight size={16} />
              </button>
            </div>
          ) : view === 'vnc' && device ? (
            <VncView key={selected} device={device} onBack={() => setView('overview')} />
          ) : view === 'files' ? (
            <FilesView key={selected} transfers={boot.transfers} notify={setNotice} />
          ) : view === 'commands' ? (
            <CommandsView key={selected} notify={setNotice} />
          ) : (
            <AgentView
              events={boot.agentEvents.filter((event) => event.deviceId === selected)}
              running={boot.agentRunning}
              configured={Boolean(boot.settings.baseUrl && boot.settings.model)}
              deviceName={device?.name || ''}
              onSettings={() => setView('settings')}
              onClear={() => setBoot((previous) => previous && { ...previous, agentEvents: [] })}
              notify={setNotice}
            />
          )}
        </main>
        <footer className="app-statusbar">
          <span>
            <span className={'status-dot ' + (connected ? 'online' : '')} />
            {connected ? `${device?.username}@${device?.host}` : '你的设备，由你掌控'}
          </span>
          <span>
            SSH · Moonlight · VNC
            {boot.transfers.length > 0 && (
              <button onClick={() => setTransfersOpen((value) => !value)}>
                <ArrowDownToLine size={12} />
                传输记录 ({boot.transfers.length})
              </button>
            )}
          </span>
        </footer>
      </div>
      {editing && (
        <DeviceModal
          device={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(undefined)}
          onSave={saveDevices}
          onDelete={(devices) => saveDevices(devices)}
        />
      )}
      {connecting && (
        <ConnectModal
          device={connecting}
          secretStorage={boot.secretStorage}
          onClose={() => {
            setConnecting(undefined)
            if (boot.connection.state === 'connecting') void perform(() => api.disconnect())
          }}
          onConnect={async (credentials) => {
            await api.connect(connecting.id, credentials)
          }}
        />
      )}
      {notice && (
        <div className="toast" role="alert">
          <CircleAlert size={18} />
          <span>{notice}</span>
          <button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {transfersOpen && boot.transfers.length > 0 && (
        <TransferPanel
          transfers={boot.transfers}
          onClose={() => setTransfersOpen(false)}
          onCancel={(id) => void perform(() => api.cancelTransfer(id))}
        />
      )}
    </div>
  )
}

function Overview({
  device,
  connected,
  connecting,
  streamRunning,
  capabilities,
  checks,
  diagnosing,
  onAdd,
  onEdit,
  onConnect,
  onDisconnect,
  onView,
  onDiagnose,
  onPair,
  onSunshine,
  onStream,
  onStopStream,
}: {
  device?: Device
  connected: boolean
  connecting: boolean
  streamRunning: boolean
  capabilities?: DesktopCapabilities
  checks: DiagnosticCheck[]
  diagnosing: boolean
  onAdd(): void
  onEdit(): void
  onConnect(): void
  onDisconnect(): void
  onView(view: View): void
  onDiagnose(): void
  onPair(): void
  onSunshine(): void
  onStream(options: StreamOptions): Promise<void>
  onStopStream(): void
}) {
  return (
    <div className="overview-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR MAC. CLOSER THAN EVER.</p>
          <h1>{device ? '远程，也像在身边。' : '让距离，留在工作之外。'}</h1>
          <p>
            {device
              ? '桌面、文件与智能助手，一个安静而专注的工作台。'
              : '连接你的 Mac，让熟悉的工作环境随时就绪。'}
          </p>
        </div>
        {device && (
          <button className="button secondary" onClick={onEdit}>
            <Settings2 size={15} />
            设备设置
          </button>
        )}
      </div>
      <div className="overview-grid">
        <section className={`hero-panel ${device?.color || 'mint'}`}>
          <div className="hero-top">
            <span className="hero-label">
              <Monitor size={15} />
              {device ? 'REMOTE MAC' : 'WELCOME TO MACLINKER'}
            </span>
            <span className="hero-badge">
              {connected ? '已连接' : connecting ? '连接中' : device ? '未连接' : '待添加'}
            </span>
          </div>
          <div className="hero-body">
            <div className="hero-copy">
              <h2>{device?.name || '你的 Mac，\n触手可及。'}</h2>
              <p>
                {device
                  ? `${device.username} @ ${device.host}`
                  : '从一台 Mac 开始，\n打开你的远程工作空间。'}
              </p>
              <button
                className="button hero-button"
                onClick={device ? (connected || connecting ? onDisconnect : onConnect) : onAdd}
              >
                {connecting ? (
                  <>
                    <LoaderCircle size={16} className="spinning" />
                    取消连接
                  </>
                ) : connected ? (
                  <>
                    断开 SSH
                    <Check size={16} />
                  </>
                ) : (
                  <>
                    {device ? '连接设备' : '添加第一台设备'}
                    <ArrowUpRight size={17} />
                  </>
                )}
              </button>
            </div>
            <div className="mac-illustration" aria-hidden="true">
              <div className="illustration-halo" />
              <div className="mac-screen">
                <div className="screen-wallpaper">
                  <div className="wallpaper-shape one" />
                  <div className="wallpaper-shape two" />
                  <div className="screen-toolbar">
                    <i />
                    <span />
                    <i />
                  </div>
                  <div className="floating-link">
                    <Link2 size={30} strokeWidth={1.7} />
                  </div>
                  <div className="screen-dock">
                    {Array.from({ length: 6 }, (_, i) => (
                      <i key={i} />
                    ))}
                  </div>
                </div>
                <div className="mac-chin" />
              </div>
              <div className="mac-stand" />
              <div className="mac-base" />
            </div>
          </div>
          <div className="hero-bottom">
            <span>
              <ShieldCheck size={14} />
              端到端 SSH 连接
            </span>
            <span>
              <Zap size={14} />
              为远程工作而生
            </span>
          </div>
        </section>
        <DesktopCard
          key={device?.id || 'none'}
          device={device}
          connected={connected}
          capabilities={capabilities}
          streamRunning={streamRunning}
          onStream={onStream}
          onVnc={() => onView('vnc')}
          onConnect={onConnect}
          onStop={onStopStream}
          onRetry={onDiagnose}
          onPair={onPair}
          onSunshine={onSunshine}
        />
      </div>
      <div className="section-caption">
        <h2>一个连接，更多可能</h2>
        <span>把常用工具，放在手边</span>
      </div>
      <div className="feature-grid">
        {[
          {
            view: 'files' as View,
            icon: Folder,
            name: '文件，来去自如',
            text: '浏览目录、预览文本，安全传输工作文件。',
            tag: 'SFTP 文件管理',
            color: 'blue',
          },
          {
            view: 'commands' as View,
            icon: Terminal,
            name: '命令，直达远端',
            text: '查看系统状态，运行脚本，处理日常任务。',
            tag: 'SSH 命令执行',
            color: 'peach',
          },
          {
            view: 'agent' as View,
            icon: Sparkles,
            name: '想法，变成行动',
            text: '连接你的模型，用自然语言与 Mac 协作。',
            tag: 'AI 工具调用',
            color: 'violet',
          },
        ].map((item) => (
          <button className="feature-card panel" key={item.view} onClick={() => onView(item.view)}>
            <div>
              <span className={`icon-tile ${item.color}`}>
                <item.icon size={21} />
              </span>
              <ArrowUpRight size={17} />
            </div>
            <h3>{item.name}</h3>
            <p>{item.text}</p>
            <span className="feature-tag">
              {item.tag}
              <ArrowRight size={13} />
            </span>
          </button>
        ))}
      </div>
      <section className="panel diagnosis-panel">
        <header>
          <div>
            <Wifi size={18} />
            <h2>连接检查</h2>
            <span>
              {checks.length
                ? `${checks.filter((check) => check.ok).length} / ${checks.length} 项通过`
                : '了解设备是否准备就绪'}
            </span>
          </div>
          <button
            className="button subtle-button"
            disabled={!connected || diagnosing}
            onClick={onDiagnose}
          >
            <RefreshCw size={14} className={diagnosing ? 'spinning' : ''} />
            {diagnosing ? '检查中…' : '运行检查'}
          </button>
        </header>
        {checks.length ? (
          <div className="check-list">
            {checks.map((check) => (
              <div key={check.name} className="check-row">
                {check.ok ? (
                  <CheckCircle2 size={17} className="success-text" />
                ) : (
                  <CircleAlert size={17} className="warning-text" />
                )}
                <strong>{check.name}</strong>
                <span>{check.detail}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="diagnosis-empty">
            <span className="status-dot" />
            {connected
              ? '正在自动检查 Sunshine、Moonlight 与 VNC 服务。'
              : '连接 SSH 后会自动检查 Sunshine 与 VNC。'}
            <small>端口可达不代表音视频已验证</small>
          </div>
        )}
      </section>
    </div>
  )
}

function TransferPanel({
  transfers,
  onClose,
  onCancel,
}: {
  transfers: Transfer[]
  onClose(): void
  onCancel(id: string): void
}) {
  return (
    <section className="transfer-panel">
      <header>
        <strong>文件传输</strong>
        <span>{transfers.filter((item) => item.state === 'running').length} 个进行中</span>
        <button className="icon-button" aria-label="收起传输记录" onClick={onClose}>
          <ChevronDown size={17} />
        </button>
      </header>
      <div>
        {transfers
          .slice(-5)
          .reverse()
          .map((item) => (
            <div className="transfer-item" key={item.id}>
              <span className="icon-tile">
                {item.direction === 'upload' ? (
                  <ArrowUpFromLine size={17} />
                ) : (
                  <ArrowDownToLine size={17} />
                )}
              </span>
              <div>
                <strong title={item.name}>{item.name}</strong>
                <small>
                  {item.state === 'running'
                    ? `${bytes(item.done)} / ${bytes(item.total)}`
                    : item.state === 'completed'
                      ? '传输完成'
                      : item.state === 'cancelled'
                        ? '已取消'
                        : '传输失败'}
                </small>
                {item.state === 'running' && <progress max={item.total || 1} value={item.done} />}
                {item.error && <p title={item.error}>{item.error}</p>}
              </div>
              {item.state === 'running' ? (
                <button
                  className="icon-button"
                  aria-label={`取消传输 ${item.name}`}
                  onClick={() => onCancel(item.id)}
                >
                  <X size={14} />
                </button>
              ) : item.state === 'completed' ? (
                <Check size={17} className="success-text" />
              ) : (
                <CircleAlert size={17} className="warning-text" />
              )}
            </div>
          ))}
      </div>
    </section>
  )
}
