import { useState, type FormEvent, type ReactNode } from 'react'
import { X, FolderKey, Monitor, Plus, ArrowUpRight, ShieldCheck, KeyRound } from 'lucide-react'
import type { Device, Credentials, Settings } from '../../shared/types'

export const api = window.maclinker
export function message(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    '',
  )
}
export function bytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1048576) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1048576).toFixed(1)} MB`
}
export function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string
  subtitle?: string
  onClose(): void
  children: ReactNode
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}
export function DeviceModal({
  device,
  onClose,
  onSave,
  onDelete,
}: {
  device?: Device
  onClose(): void
  onSave(devices: Device[], id: string): void
  onDelete(devices: Device[]): void
}) {
  const [value, set] = useState<Device>(
    device ?? {
      id: crypto.randomUUID(),
      name: '',
      host: '',
      port: 22,
      username: '',
      identity: '',
      streamHost: '',
      streamApp: 'Desktop',
      color: 'mint',
    },
  )
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false)
  const update = <K extends keyof Device>(key: K, next: Device[K]) =>
    set((previous) => ({ ...previous, [key]: next }))
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      onSave(await api.saveDevice(value), value.id)
    } catch (error) {
      setError(message(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={device ? '编辑设备' : '添加一台 Mac'}
      subtitle="开启 Mac 的远程登录，即可连接。"
      onClose={onClose}
    >
      <form onSubmit={submit} className="modal-form">
        <Field label="设备名称">
          <input
            required
            autoFocus
            placeholder="例如：工作室 Mac mini"
            value={value.name}
            onChange={(event) => update('name', event.target.value)}
          />
        </Field>
        <div className="form-row wide">
          <Field label="主机地址">
            <input
              required
              placeholder="192.168.1.20 或主机名"
              value={value.host}
              onChange={(event) => update('host', event.target.value)}
            />
          </Field>
          <Field label="SSH 端口">
            <input
              required
              type="number"
              min={1}
              max={65535}
              value={value.port}
              onChange={(event) => update('port', Number(event.target.value))}
            />
          </Field>
        </div>
        <Field label="用户名">
          <input
            required
            placeholder="Mac 的账户短名称"
            value={value.username}
            onChange={(event) => update('username', event.target.value)}
          />
        </Field>
        <Field label="SSH 私钥（可选）" hint="留空可使用密码，或系统中已配置的 SSH agent。">
          <div className="input-action">
            <input
              value={value.identity}
              onChange={(event) => update('identity', event.target.value)}
              placeholder="选择私钥文件"
            />
            <button
              type="button"
              className="icon-button"
              aria-label="选择私钥"
              onClick={() =>
                void api
                  .chooseIdentity()
                  .then((path) => {
                    if (path) update('identity', path)
                  })
                  .catch((error) => setError(message(error)))
              }
            >
              <FolderKey size={18} />
            </button>
          </div>
        </Field>
        <details>
          <summary>串流与外观</summary>
          <div className="details-body">
            <Field label="串流地址（可选）">
              <input
                placeholder="默认与 SSH 地址相同"
                value={value.streamHost}
                onChange={(event) => update('streamHost', event.target.value)}
              />
            </Field>
            <Field label="Sunshine 应用名称">
              <input
                required
                value={value.streamApp}
                onChange={(event) => update('streamApp', event.target.value)}
              />
            </Field>
            <Field label="VNC 端口" hint="通过 SSH 连接这台 Mac 的本机端口，默认 5900。">
              <input
                type="number"
                min={1}
                max={65535}
                required
                value={value.vncPort ?? 5900}
                onChange={(event) => update('vncPort', Number(event.target.value))}
              />
            </Field>
            <div className="color-picker">
              {['mint', 'blue', 'peach', 'violet'].map((color) => (
                <button
                  type="button"
                  key={color}
                  aria-label={color}
                  className={`color-dot ${color} ${value.color === color ? 'selected' : ''}`}
                  onClick={() => update('color', color)}
                />
              ))}
            </div>
          </div>
        </details>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        {confirmDelete && (
          <div className="delete-confirm">
            <span>移除此设备及保存的密码？远程文件不受影响。</span>
            <button
              type="button"
              className="danger-text"
              onClick={() =>
                void api
                  .removeDevice(value.id)
                  .then(onDelete)
                  .catch((error) => setError(message(error)))
              }
            >
              确认移除
            </button>
          </div>
        )}
        <footer>
          {device ? (
            <div className="left-actions">
              <button
                type="button"
                className="text-button muted"
                onClick={() => setConfirmDelete(true)}
              >
                移除设备
              </button>
              <button
                type="button"
                className="text-button muted"
                onClick={() =>
                  void api.forgetHost(value.id).catch((error) => setError(message(error)))
                }
              >
                重置信任
              </button>
            </div>
          ) : (
            <span className="subtle">
              <ShieldCheck size={14} /> 凭据在本机管理
            </span>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? '保存中…' : device ? '保存更改' : '添加设备'}
            <Plus size={16} />
          </button>
        </footer>
      </form>
    </Modal>
  )
}
export function ConnectModal({
  device,
  secretStorage,
  onClose,
  onConnect,
}: {
  device: Device
  secretStorage: boolean
  onClose(): void
  onConnect(credentials: Credentials): Promise<void>
}) {
  const [password, setPassword] = useState(''),
    [passphrase, setPassphrase] = useState(''),
    [remember, setRemember] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onConnect({ password, passphrase, remember })
      setPassword('')
      setPassphrase('')
      onClose()
    } catch (error) {
      setError(message(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={`连接 ${device.name}`}
      subtitle={`${device.username}@${device.host}:${device.port}`}
      onClose={onClose}
    >
      <form onSubmit={submit} className="modal-form">
        <div className={`connection-glyph ${device.color}`}>
          <Monitor size={34} />
          <span>
            <KeyRound size={18} />
          </span>
        </div>
        {device.identity ? (
          <Field label="私钥口令（如有）">
            <input
              type="password"
              autoFocus
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              autoComplete="off"
              placeholder="未加密的私钥可留空"
            />
          </Field>
        ) : (
          <>
            <Field label="账户密码" hint="使用已保存的密码或 SSH agent 时可留空。">
              <input
                type="password"
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="输入 Mac 登录密码"
              />
            </Field>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={remember}
                disabled={!secretStorage}
                onChange={(event) => setRemember(event.target.checked)}
              />
              {secretStorage
                ? '使用系统钥匙串保存密码'
                : '系统钥匙串不可用，密码仅在本次会话中使用'}
            </label>
          </>
        )}
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <footer>
          <span className="subtle">
            <ShieldCheck size={14} /> SSH 加密连接
          </span>
          <button className="button primary" disabled={busy}>
            {busy ? '正在连接…' : '连接设备'}
            <ArrowUpRight size={16} />
          </button>
        </footer>
      </form>
    </Modal>
  )
}
export function SettingsView({
  settings,
  hasApiKey,
  secretStorage,
  onSaved,
}: {
  settings: Settings
  hasApiKey: boolean
  secretStorage: boolean
  onSaved(settings: Settings, hasKey: boolean, storage: boolean): void
}) {
  const [value, set] = useState(settings),
    [key, setKey] = useState(''),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setSaved(false)
    setError('')
    try {
      const result = await api.saveSettings(value, key || undefined)
      onSaved(value, result.hasApiKey, result.secretStorage)
      setKey('')
      setSaved(true)
    } catch (error) {
      setError(message(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="settings-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">MAKE IT YOURS</p>
          <h1>连接你的工作方式</h1>
          <p>配置串流客户端，以及 AI 助手使用的模型服务。</p>
        </div>
      </div>
      <form onSubmit={submit}>
        <section className="panel settings-panel">
          <div className="section-heading">
            <div className="section-number">01</div>
            <div>
              <h2>AI 模型服务</h2>
              <p>支持 Chat Completions 工具调用的兼容服务。</p>
            </div>
            <span className="pill neutral">自带模型</span>
          </div>
          <div className="settings-fields">
            <Field
              label="API 基础地址"
              hint="填写基础路径，例如 https://your-provider.example/v1。本地服务可用 HTTP。"
            >
              <input
                type="url"
                value={value.baseUrl}
                placeholder="https://your-provider.example/v1"
                onChange={(event) =>
                  set((previous) => ({ ...previous, baseUrl: event.target.value }))
                }
              />
            </Field>
            <div className="form-row">
              <Field label="模型名称">
                <input
                  value={value.model}
                  placeholder="服务商提供的模型 ID"
                  onChange={(event) =>
                    set((previous) => ({ ...previous, model: event.target.value }))
                  }
                />
              </Field>
              <Field
                label="API Key"
                hint={hasApiKey ? '已设置。留空保留原密钥。' : '本地无需认证的服务可留空。'}
              >
                <input
                  type="password"
                  autoComplete="off"
                  value={key}
                  placeholder={hasApiKey ? '•••••••• 已设置' : '输入 API Key'}
                  onChange={(event) => setKey(event.target.value)}
                />
              </Field>
            </div>
            <div className="settings-note">
              <ShieldCheck size={17} />
              <span>
                {secretStorage
                  ? '密钥使用操作系统加密存储，模型请求从本机发出。'
                  : '系统钥匙串不可用：密钥仅保留到应用退出，不会明文写入磁盘。'}
              </span>
              {hasApiKey && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    void api
                      .clearApiKey()
                      .then(() => onSaved(settings, false, secretStorage))
                      .catch((error) => setError(message(error)))
                  }
                >
                  清除密钥
                </button>
              )}
            </div>
          </div>
        </section>
        <section className="panel settings-panel">
          <div className="section-heading">
            <div className="section-number">02</div>
            <div>
              <h2>Moonlight 客户端</h2>
              <p>使用成熟的串流引擎提供桌面画面、键鼠和声音。</p>
            </div>
          </div>
          <div className="settings-fields">
            <Field
              label="可执行文件路径（可选）"
              hint="留空自动查找。macOS 请指向 Moonlight.app/Contents/MacOS/Moonlight。"
            >
              <input
                value={value.moonlightPath}
                placeholder="自动查找已安装的 Moonlight"
                onChange={(event) =>
                  set((previous) => ({ ...previous, moonlightPath: event.target.value }))
                }
              />
            </Field>
          </div>
        </section>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <div className="settings-footer">
          <span className={saved ? 'success-text' : 'muted'}>
            {saved ? '设置已保存' : '设置只保存在这台电脑上'}
          </span>
          <button className="button primary" disabled={busy}>
            {busy ? '保存中…' : '保存设置'}
          </button>
        </div>
      </form>
    </div>
  )
}
