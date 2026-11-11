import type { SetupResource } from './streaming-setup'

export interface Device {
  id: string
  name: string
  host: string
  port: number
  username: string
  identity: string
  streamHost: string
  streamApp: string
  color: string
  vncPort?: number
}
export interface Credentials {
  password?: string
  passphrase?: string
  remember?: boolean
}
export interface Settings {
  baseUrl: string
  model: string
  moonlightPath: string
}
export interface FileEntry {
  name: string
  path: string
  kind: 'directory' | 'file' | 'link'
  size: number
  modified: number
}
export interface Directory {
  path: string
  entries: FileEntry[]
}
export interface CommandResult {
  stdout: string
  stderr: string
  code: number
  truncated: boolean
}
export interface Check {
  name: string
  ok: boolean
  detail: string
}
export interface DesktopCapabilities {
  deviceId: string
  state: 'checking' | 'ready' | 'error'
  sunshineInstalled: boolean | null
  sunshineRunning: boolean | null
  moonlightInstalled: boolean
  streamReachable: boolean
  vncAvailable: boolean
  recommendation: 'moonlight' | 'vnc' | 'ssh'
  checks: Check[]
  checkedAt: number
  error?: string
}
export type VncEvent =
  | { sessionId: string; type: 'data'; data: Uint8Array }
  | { sessionId: string; type: 'closed'; error?: string }
export interface Connection {
  state: 'disconnected' | 'connecting' | 'connected'
  deviceId?: string
  home?: string
  error?: string
}
export interface Transfer {
  id: string
  name: string
  direction: 'upload' | 'download'
  done: number
  total: number
  state: 'running' | 'completed' | 'failed' | 'cancelled'
  error?: string
}
export interface StreamOptions {
  resolution: string
  fps: number
  bitrate: number
}
export interface AgentEvent {
  id: string
  runId: string
  deviceId: string
  kind: 'user' | 'assistant' | 'tool' | 'result' | 'error' | 'status'
  text: string
  time: number
}
export type AppEvent =
  | { type: 'connection'; connection: Connection }
  | { type: 'transfer'; transfer: Transfer }
  | { type: 'agent'; event: AgentEvent }
  | { type: 'agent-state'; running: boolean; runId?: string }
  | { type: 'stream'; running: boolean; error?: string }
  | { type: 'desktop-capabilities'; capabilities: DesktopCapabilities | null }
export interface Boot {
  devices: Device[]
  settings: Settings
  connection: Connection
  secretStorage: boolean
  hasApiKey: boolean
  transfers: Transfer[]
  agentEvents: AgentEvent[]
  agentRunning: boolean
  streamRunning: boolean
  desktopCapabilities: DesktopCapabilities | null
  version: string
}
export interface API {
  boot(): Promise<Boot>
  saveDevice(device: Device): Promise<Device[]>
  removeDevice(id: string): Promise<Device[]>
  chooseIdentity(): Promise<string | null>
  forgetHost(id: string): Promise<void>
  connect(id: string, credentials: Credentials): Promise<Connection>
  disconnect(): Promise<void>
  diagnose(): Promise<Check[]>
  list(path: string): Promise<Directory>
  read(path: string): Promise<string>
  mkdir(path: string): Promise<void>
  upload(path: string): Promise<void>
  download(path: string): Promise<void>
  cancelTransfer(id: string): Promise<void>
  execute(command: string): Promise<CommandResult>
  cancelCommand(): Promise<void>
  stream(deviceId: string, options: StreamOptions): Promise<'moonlight' | 'vnc'>
  inspectDesktop(): Promise<DesktopCapabilities>
  openVnc(deviceId: string): Promise<{ sessionId: string }>
  vncSend(sessionId: string, data: Uint8Array): Promise<void>
  vncAck(sessionId: string): Promise<void>
  closeVnc(sessionId: string): Promise<void>
  onVnc(listener: (event: VncEvent) => void): () => void
  pair(deviceId: string): Promise<void>
  stopStream(): Promise<void>
  openSunshine(deviceId: string): Promise<void>
  openSetupResource(resource: SetupResource): Promise<void>
  saveSettings(
    settings: Settings,
    apiKey?: string,
  ): Promise<{ secretStorage: boolean; hasApiKey: boolean }>
  clearApiKey(): Promise<void>
  askAgent(prompt: string): Promise<void>
  cancelAgent(): Promise<void>
  clearAgent(): Promise<void>
  onEvent(listener: (event: AppEvent) => void): () => void
}

declare global {
  interface Window {
    maclinker: API
  }
}
