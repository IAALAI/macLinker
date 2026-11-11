import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowUp,
  ArrowDownToLine,
  ArrowUpFromLine,
  Folder,
  FileText,
  FolderPlus,
  RefreshCw,
  Search,
  ChevronRight,
  Eye,
  Terminal,
  Play,
  Square,
  Sparkles,
  Send,
  Settings2,
  Trash2,
  Check,
  CircleAlert,
  LoaderCircle,
  Link2,
} from 'lucide-react'
import type { AgentEvent, Directory, Transfer } from '../../shared/types'
import { api, bytes, Field, message, Modal } from './components'

export function FilesView({
  transfers,
  notify,
}: {
  transfers: Transfer[]
  notify(text: string): void
}) {
  const [directory, setDirectory] = useState<Directory>({ path: '~', entries: [] }),
    [input, setInput] = useState('~')
  const [search, setSearch] = useState(''),
    [hidden, setHidden] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [preview, setPreview] = useState<{ name: string; text: string }>(),
    [newFolder, setNewFolder] = useState(false),
    [folderName, setFolderName] = useState('')
  const sequence = useRef(0),
    currentPath = useRef('~')
  async function load(path: string) {
    const seq = ++sequence.current
    setBusy(true)
    setError('')
    try {
      const value = await api.list(path)
      if (seq === sequence.current) {
        setDirectory(value)
        setInput(value.path)
        currentPath.current = value.path
      }
    } catch (error) {
      if (seq === sequence.current) setError(message(error))
    } finally {
      if (seq === sequence.current) setBusy(false)
    }
  }
  useEffect(() => {
    void load('~')
    return () => {
      ++sequence.current
    }
  }, [])
  const completed = transfers.filter((transfer) => transfer.state === 'completed').length
  useEffect(() => {
    if (completed) void load(currentPath.current)
  }, [completed])
  const entries = directory.entries.filter(
    (file) =>
      (hidden || !file.name.startsWith('.')) &&
      file.name.toLowerCase().includes(search.toLowerCase()),
  )
  const parent = directory.path.split('/').slice(0, -1).join('/') || '/'
  async function createFolder(event: FormEvent) {
    event.preventDefault()
    if (!folderName.trim() || folderName.includes('/') || ['.', '..'].includes(folderName)) {
      notify('请输入有效的单层目录名称')
      return
    }
    try {
      await api.mkdir(directory.path.replace(/\/$/, '') + '/' + folderName)
      setNewFolder(false)
      setFolderName('')
      await load(directory.path)
    } catch (error) {
      notify(message(error))
    }
  }
  return (
    <div className="workspace-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">FILES, WITHOUT DISTANCE</p>
          <h1>文件</h1>
          <p>浏览 Mac 文件，在两台电脑间轻松传输。</p>
        </div>
        <div className="toolbar">
          <button className="button secondary" onClick={() => setNewFolder(true)}>
            <FolderPlus size={16} />
            新建文件夹
          </button>
          <button
            className="button primary"
            onClick={() => void api.upload(directory.path).catch((error) => notify(message(error)))}
          >
            <ArrowUpFromLine size={16} />
            上传文件
          </button>
        </div>
      </div>
      <section className="panel file-panel">
        <div className="file-navigation">
          <button
            className="icon-button"
            aria-label="上级目录"
            disabled={directory.path === '/'}
            onClick={() => void load(parent)}
          >
            <ArrowUp size={18} />
          </button>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void load(input)
            }}
            className="path-form"
          >
            <Folder size={17} />
            <input
              aria-label="远程路径"
              value={input}
              onChange={(event) => setInput(event.target.value)}
            />
            <button className="icon-button" aria-label="前往目录">
              <ChevronRight size={17} />
            </button>
          </form>
          <button
            className={'icon-button ' + (busy ? 'spinning' : '')}
            aria-label="刷新目录"
            disabled={busy}
            onClick={() => void load(directory.path)}
          >
            <RefreshCw size={17} />
          </button>
        </div>
        <div className="file-filters">
          <div className="search-input">
            <Search size={15} />
            <input
              aria-label="搜索当前目录"
              placeholder="搜索当前目录"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <label className="checkbox small">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(event) => setHidden(event.target.checked)}
            />
            显示隐藏文件
          </label>
        </div>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <div className="file-table-wrap">
          <table className="file-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>大小</th>
                <th>修改时间</th>
                <th>
                  <span className="sr-only">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((file) => (
                <tr key={file.name}>
                  <td>
                    <button
                      className="file-name"
                      onClick={() =>
                        file.kind === 'directory'
                          ? void load(file.path)
                          : void api
                              .read(file.path)
                              .then((text) => setPreview({ name: file.name, text }))
                              .catch((error) => notify(message(error)))
                      }
                    >
                      {file.kind === 'directory' ? (
                        <Folder size={19} className="folder-icon" fill="currentColor" />
                      ) : file.kind === 'link' ? (
                        <Link2 size={18} />
                      ) : (
                        <FileText size={18} />
                      )}
                      <span>{file.name}</span>
                    </button>
                  </td>
                  <td>{file.kind === 'directory' ? '—' : bytes(file.size)}</td>
                  <td>
                    {new Date(file.modified).toLocaleString('zh-CN', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td>
                    {file.kind !== 'directory' && (
                      <div className="row-actions">
                        <button
                          className="icon-button"
                          aria-label={`预览 ${file.name}`}
                          onClick={() =>
                            void api
                              .read(file.path)
                              .then((text) => setPreview({ name: file.name, text }))
                              .catch((error) => notify(message(error)))
                          }
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`下载 ${file.name}`}
                          onClick={() =>
                            void api.download(file.path).catch((error) => notify(message(error)))
                          }
                        >
                          <ArrowDownToLine size={16} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!entries.length && (
            <div className="table-empty">
              <Folder size={30} />
              <p>
                {busy
                  ? '正在读取目录…'
                  : search
                    ? '没有匹配的文件'
                    : error
                      ? '无法读取此目录'
                      : '此目录为空'}
              </p>
            </div>
          )}
        </div>
        <div className="file-footer">
          <span>{entries.length} 个项目</span>
          <span>
            <Check size={13} />
            通过加密的 SFTP 连接传输
          </span>
        </div>
      </section>
      {preview && (
        <Modal
          title={preview.name}
          subtitle="文本预览 · 最多 64 KiB"
          onClose={() => setPreview(undefined)}
        >
          <pre className="file-preview">{preview.text}</pre>
        </Modal>
      )}
      {newFolder && (
        <Modal title="新建文件夹" subtitle={directory.path} onClose={() => setNewFolder(false)}>
          <form className="modal-form" onSubmit={createFolder}>
            <Field label="文件夹名称">
              <input
                autoFocus
                required
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
              />
            </Field>
            <footer>
              <span />
              <button className="button primary">创建文件夹</button>
            </footer>
          </form>
        </Modal>
      )}
    </div>
  )
}

export function CommandsView({ notify }: { notify(text: string): void }) {
  const [command, setCommand] = useState(''),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<{ command: string; output: string; code: number }[]>([])
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history])
  async function execute(event: FormEvent) {
    event.preventDefault()
    if (!command.trim() || busy) return
    const input = command
    setBusy(true)
    setCommand('')
    try {
      const result = await api.execute(input)
      setHistory((previous) => [
        ...previous.slice(-29),
        {
          command: input,
          code: result.code,
          output: result.stdout + result.stderr + (result.truncated ? '\n[输出已截断]' : ''),
        },
      ])
    } catch (error) {
      setHistory((previous) => [
        ...previous.slice(-29),
        { command: input, code: -1, output: message(error) },
      ])
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="workspace-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">A DIRECT LINE TO YOUR MAC</p>
          <h1>远程命令</h1>
          <p>执行 shell 命令，查看系统状态和操作结果。</p>
        </div>
        <span className="pill neutral">
          <Terminal size={13} /> SSH
        </span>
      </div>
      <section className="command-panel">
        <header>
          <div className="terminal-dots">
            <i />
            <i />
            <i />
          </div>
          <span>远程 shell · 每次命令独立执行</span>
          <button
            className="icon-button"
            aria-label="清空命令记录"
            disabled={busy}
            onClick={() => setHistory([])}
          >
            <Trash2 size={15} />
          </button>
        </header>
        <div className="command-output">
          {!history.length && (
            <div className="terminal-welcome">
              <Terminal size={28} />
              <h3>已准备好接收命令</h3>
              <p>
                运行一条命令，结果会显示在这里。
                <br />
                当前支持独立命令，暂不支持需要持续输入的交互式程序。
              </p>
            </div>
          )}
          {history.map((item, index) => (
            <div className="command-entry" key={index}>
              <div className="command-line">
                <span>❯</span>
                {item.command}
                <small className={item.code ? 'failed' : ''}>exit {item.code}</small>
              </div>
              <pre>{item.output || '（无输出）'}</pre>
            </div>
          ))}
          {busy && (
            <p className="running-command">
              <LoaderCircle size={15} className="spinning" />
              命令执行中…
            </p>
          )}
          <div ref={bottom} />
        </div>
        <form className="command-form" onSubmit={execute}>
          <span>❯</span>
          <input
            aria-label="远程命令"
            placeholder="输入命令，例如 sw_vers"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
          />
          {busy ? (
            <button
              type="button"
              className="button terminal-button"
              onClick={() => void api.cancelCommand().catch((error) => notify(message(error)))}
            >
              <Square size={14} />
              停止
            </button>
          ) : (
            <button className="button terminal-button" disabled={!command.trim()}>
              <Play size={14} />
              执行
            </button>
          )}
        </form>
      </section>
      <div className="command-suggestions">
        <span>快速填入</span>
        {['sw_vers', 'df -h', 'uptime', 'pwd'].map((value) => (
          <button key={value} onClick={() => setCommand(value)}>
            {value}
          </button>
        ))}
      </div>
    </div>
  )
}

export function AgentView({
  events,
  running,
  configured,
  deviceName,
  onSettings,
  onClear,
  notify,
}: {
  events: AgentEvent[]
  running: boolean
  configured: boolean
  deviceName: string
  onSettings(): void
  onClear(): void
  notify(text: string): void
}) {
  const [prompt, setPrompt] = useState(''),
    bottom = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events.length])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!prompt.trim() || running) return
    const value = prompt
    setPrompt('')
    try {
      await api.askAgent(value)
    } catch (error) {
      notify(message(error))
      setPrompt(value)
    }
  }
  const visible = events.filter((event) => event.kind !== 'status')
  const status = events.at(-1)
  return (
    <div className="workspace-page agent-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">A LITTLE HELP, A LOT CLOSER</p>
          <h1>
            AI 助手 <span className="inline-beta">PREVIEW</span>
          </h1>
          <p>用自然语言查看文件、诊断问题，或安排远程操作。</p>
        </div>
        <div className="toolbar">
          <button className="icon-button" aria-label="模型设置" onClick={onSettings}>
            <Settings2 size={18} />
          </button>
          <button
            className="button secondary"
            disabled={running || !visible.length}
            onClick={() =>
              void api
                .clearAgent()
                .then(onClear)
                .catch((error) => notify(message(error)))
            }
          >
            <PlusIcon />
            新对话
          </button>
        </div>
      </div>
      <section className="panel agent-panel">
        <header>
          <span className="agent-badge">
            <Sparkles size={15} />
            macLinker Assistant
          </span>
          <span className="subtle">
            <span className="status-dot online" />
            {deviceName}
          </span>
        </header>
        <div className="chat-history">
          {!visible.length && (
            <div className="agent-welcome">
              <div className="sparkle-orbit">
                <Sparkles size={31} />
              </div>
              <h2>把想做的事，交给一句话。</h2>
              <p>
                {configured
                  ? '我可以查看这台 Mac 的文件和状态。执行远程命令前，会请你确认。'
                  : '先连接你选择的模型服务，开始与这台 Mac 协作。'}
              </p>
              {configured ? (
                <div className="prompt-suggestions">
                  {[
                    '看看主目录下有哪些文件',
                    '检查这台 Mac 的磁盘空间',
                    '了解这台 Mac 的系统版本',
                  ].map((value) => (
                    <button key={value} onClick={() => setPrompt(value)}>
                      {value}
                      <ChevronRight size={14} />
                    </button>
                  ))}
                </div>
              ) : (
                <button className="button primary" onClick={onSettings}>
                  配置模型服务
                  <Settings2 size={15} />
                </button>
              )}
            </div>
          )}
          {visible.map((event) => (
            <div key={event.id} className={`chat-event ${event.kind}`}>
              {event.kind === 'user' || event.kind === 'assistant' ? (
                <>
                  <div className="chat-author">
                    {event.kind === 'user' ? (
                      '你'
                    ) : (
                      <>
                        <Sparkles size={13} />
                        macLinker
                      </>
                    )}
                  </div>
                  <div className="chat-text">{event.text}</div>
                </>
              ) : (
                <details open={event.kind === 'error'}>
                  <summary>
                    {event.kind === 'tool' ? (
                      <Terminal size={14} />
                    ) : event.kind === 'error' ? (
                      <CircleAlert size={14} />
                    ) : (
                      <Check size={14} />
                    )}
                    {event.kind === 'tool'
                      ? event.text.split('\n')[0]
                      : event.kind === 'error'
                        ? '任务提示'
                        : '工具结果'}
                  </summary>
                  <pre>{event.text}</pre>
                </details>
              )}
            </div>
          ))}
          {running && (
            <div className="agent-thinking">
              <LoaderCircle className="spinning" size={15} />
              {status?.kind === 'status' ? status.text : '正在处理任务…'}
            </div>
          )}
          <div ref={bottom} />
        </div>
        <form className="chat-composer" onSubmit={submit}>
          <textarea
            aria-label="AI 任务"
            rows={2}
            placeholder={configured ? '描述你的任务…' : '先在设置中配置模型服务'}
            disabled={!configured}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void submit(event)
              }
            }}
          />
          <div>
            <span>文件内容会发送至你配置的模型服务 · 命令需确认</span>
            {running ? (
              <button
                type="button"
                className="send-button"
                aria-label="停止 AI 任务"
                onClick={() => void api.cancelAgent().catch((error) => notify(message(error)))}
              >
                <Square size={16} />
              </button>
            ) : (
              <button
                className="send-button"
                aria-label="发送任务"
                disabled={!configured || !prompt.trim()}
              >
                <Send size={17} />
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  )
}
function PlusIcon() {
  return <span style={{ fontSize: 19, lineHeight: 1 }}>+</span>
}
