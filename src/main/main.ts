import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, session, Menu } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Store } from '../core/store'
import { Remote } from '../core/remote'
import { Agent } from '../core/agent'
import { Moonlight, findMoonlight } from '../core/moonlight'
import { inspectDesktop } from '../core/desktop-probe'
import { VncTunnel } from '../core/vnc'
import {
  credentialsSchema,
  deviceSchema,
  errorMessage,
  pathSchema,
  settingsSchema,
  streamSchema,
} from '../core/validation'
import type { AppEvent, DesktopCapabilities } from '../shared/types'
import { setupResourceIds, setupResources } from '../shared/streaming-setup'

if (process.env.MACLINKER_DATA_DIR)
  app.setPath('userData', path.resolve(process.env.MACLINKER_DATA_DIR))
let window: BrowserWindow | undefined
let remote: Remote, agent: Agent, moonlight: Moonlight, vnc: VncTunnel
let commandAbort: AbortController | undefined
const devURL = !app.isPackaged ? process.env.MACLINKER_DEV_URL : undefined
const documentURL = pathToFileURL(path.join(__dirname, '../renderer/index.html')).toString()

async function ready() {
  let desktopCapabilities: DesktopCapabilities | null = null
  let probeEpoch = 0
  let probePending: Promise<DesktopCapabilities> | undefined
  const emit = (event: AppEvent) => {
    if (event.type === 'connection' && event.connection.state !== 'connected') {
      ++probeEpoch
      probePending = undefined
      desktopCapabilities = null
      vnc?.stop()
      if (window && !window.isDestroyed())
        window.webContents.send('maclinker:event', {
          type: 'desktop-capabilities',
          capabilities: null,
        })
    }
    if (window && !window.isDestroyed()) window.webContents.send('maclinker:event', event)
  }
  const encryptionAvailable = async () => {
    try {
      return await safeStorage.isAsyncEncryptionAvailable()
    } catch {
      return false
    }
  }
  const store = new Store(path.join(app.getPath('userData'), 'workspace.json'), {
    available: encryptionAvailable,
    encrypt: async (value) => (await safeStorage.encryptStringAsync(value)).toString('base64'),
    decrypt: async (value) =>
      (await safeStorage.decryptStringAsync(Buffer.from(value, 'base64'))).result,
  })
  remote = new Remote(emit)
  moonlight = new Moonlight(emit)
  vnc = new VncTunnel((event) => {
    if (window && !window.isDestroyed()) window.webContents.send('maclinker:vnc', event)
  })
  const refreshDesktop = (): Promise<DesktopCapabilities> => {
    if (!remote.connected()) return Promise.reject(new Error('请先连接 SSH'))
    if (probePending) return probePending
    const device = store.device(remote.connection.deviceId!)
    const connection = remote.connection,
      epoch = ++probeEpoch
    desktopCapabilities = {
      deviceId: device.id,
      state: 'checking',
      sunshineInstalled: null,
      sunshineRunning: null,
      moonlightInstalled: false,
      streamReachable: false,
      vncAvailable: false,
      recommendation: 'ssh',
      checks: [],
      checkedAt: 0,
    }
    emit({ type: 'desktop-capabilities', capabilities: desktopCapabilities })
    probePending = inspectDesktop(remote, device, findMoonlight(store.settings().moonlightPath))
      .then((result) => {
        if (epoch !== probeEpoch || remote.connection !== connection)
          throw new Error('设备连接已改变，已丢弃旧的检查结果')
        desktopCapabilities = result
        emit({ type: 'desktop-capabilities', capabilities: result })
        return result
      })
      .finally(() => {
        if (epoch === probeEpoch) probePending = undefined
      })
    return probePending
  }
  agent = new Agent({
    remote,
    settings: () => store.settings(),
    apiKey: () => store.secret('ai-api-key'),
    emit,
    approve: async (command, signal) => {
      if (signal.aborted || !window) return false
      const result = await dialog.showMessageBox(window, {
        type: 'question',
        title: '允许 AI 执行此命令？',
        message: 'AI 请求在当前 Mac 上执行命令',
        detail: command,
        buttons: ['取消', '执行此命令'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      return !signal.aborted && result.response === 1
    },
  })
  const handle = (name: string, handler: (...args: any[]) => unknown) => {
    ipcMain.handle('maclinker:' + name, async (event, ...args) => {
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        (devURL
          ? !event.senderFrame.url.startsWith(devURL + '/')
          : event.senderFrame.url.split('#')[0] !== documentURL)
      )
        throw new Error('非法页面来源')
      try {
        return await handler(...args)
      } catch (error) {
        if (error instanceof z.ZodError)
          throw new Error(
            error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
          )
        throw new Error(errorMessage(error))
      }
    })
  }
  const idSchema = z.string().min(1).max(80)
  handle('boot', async () => ({
    devices: store.devices(),
    settings: store.settings(),
    connection: remote.connection,
    secretStorage: await encryptionAvailable(),
    hasApiKey: store.hasSecret('ai-api-key'),
    transfers: remote.transferList(),
    agentEvents: agent.events,
    agentRunning: agent.running,
    streamRunning: moonlight.running,
    desktopCapabilities,
    version: app.getVersion(),
  }))
  handle('saveDevice', (input) => {
    const device = deviceSchema.parse(input)
    if (remote.connection.deviceId === device.id) {
      agent.cancel()
      remote.disconnect()
    }
    return store.saveDevice(device)
  })
  handle('removeDevice', (input) => {
    const id = idSchema.parse(input)
    if (remote.connection.deviceId === id) {
      agent.cancel()
      remote.disconnect()
    }
    return store.removeDevice(id)
  })
  handle('chooseIdentity', async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: '选择 SSH 私钥',
      properties: ['openFile', 'showHiddenFiles'],
    })
    return result.canceled ? null : result.filePaths[0]
  })
  handle('forgetHost', async (input) => {
    const device = store.device(idSchema.parse(input))
    const result = await dialog.showMessageBox(window!, {
      type: 'warning',
      message: `重置 ${device.name} 的主机信任？`,
      detail: '下次连接需要重新核对 SSH 指纹。',
      buttons: ['取消', '重置'],
      defaultId: 0,
      cancelId: 0,
    })
    if (result.response === 1) {
      if (remote.connection.deviceId === device.id) {
        agent.cancel()
        remote.disconnect()
      }
      store.forgetHost(device)
    }
  })
  handle('connect', async (input, auth) => {
    const device = store.device(idSchema.parse(input)),
      credentials = credentialsSchema.parse(auth)
    agent.cancel()
    const password = credentials.password || (await store.secret(device.id))
    const connection = await remote.connect(
      device,
      { ...credentials, password },
      async (fingerprint) => {
        const existing = store.hostKey(device)
        if (existing === fingerprint) return true
        if (existing)
          throw new Error('SSH 主机密钥已改变。请确认设备身份后，在设备编辑窗口重置信任。')
        const result = await dialog.showMessageBox(window!, {
          type: 'question',
          title: '首次连接此设备',
          message: `信任 ${device.host}:${device.port}？`,
          detail: `请与 Mac 上的 SSH 主机指纹核对：\n\n${fingerprint}`,
          buttons: ['取消', '信任并连接'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        })
        if (result.response !== 1) return false
        store.trustHost(device, fingerprint)
        return true
      },
    )
    void refreshDesktop().catch(() => {})
    if (credentials.password)
      await store.setSecret(device.id, credentials.password, Boolean(credentials.remember))
    return connection
  })
  handle('disconnect', () => {
    agent.cancel()
    remote.disconnect()
  })
  handle('list', (input) => remote.list(pathSchema.parse(input)))
  handle('read', (input) => remote.read(pathSchema.parse(input)))
  handle('mkdir', (input) => remote.mkdir(pathSchema.parse(input)))
  handle('execute', async (input) => {
    if (commandAbort) throw new Error('已有命令正在运行')
    commandAbort = new AbortController()
    try {
      return await remote.execute(z.string().min(1).max(32768).parse(input), commandAbort.signal)
    } finally {
      commandAbort = undefined
    }
  })
  handle('cancelCommand', () => commandAbort?.abort())
  handle('upload', async (input) => {
    const target = remote.resolvePath(pathSchema.parse(input)),
      deviceId = remote.connection.deviceId
    const result = await dialog.showOpenDialog(window!, {
      title: '上传文件',
      properties: ['openFile', 'multiSelections'],
    })
    if (result.canceled) return
    if (!remote.connected(deviceId)) throw new Error('连接发生变化，请重新选择文件')
    for (const local of result.filePaths)
      void remote
        .transfer('upload', local, path.posix.join(target, path.basename(local)))
        .catch((error) => {
          emit({
            type: 'transfer',
            transfer: {
              id: randomUUID(),
              name: path.basename(local),
              direction: 'upload',
              done: 0,
              total: 0,
              state: 'failed',
              error: errorMessage(error),
            },
          })
        })
  })
  handle('download', async (input) => {
    const target = remote.resolvePath(pathSchema.parse(input)),
      deviceId = remote.connection.deviceId
    const result = await dialog.showSaveDialog(window!, {
      title: '下载文件',
      defaultPath: path.join(app.getPath('downloads'), path.posix.basename(target)),
    })
    if (result.canceled || !result.filePath) return
    if (!remote.connected(deviceId)) throw new Error('连接发生变化，请重新选择文件')
    void remote.transfer('download', result.filePath, target).catch((error) => {
      emit({
        type: 'transfer',
        transfer: {
          id: randomUUID(),
          name: path.posix.basename(target),
          direction: 'download',
          done: 0,
          total: 0,
          state: 'failed',
          error: errorMessage(error),
        },
      })
    })
  })
  handle('cancelTransfer', (input) => remote.cancelTransfer(idSchema.parse(input)))
  handle('diagnose', async () => (await refreshDesktop()).checks)
  handle('inspectDesktop', refreshDesktop)
  handle('stream', async (input, inputOptions) => {
    const id = idSchema.parse(input),
      options = streamSchema.parse(inputOptions)
    if (!remote.connected(id)) throw new Error('请先连接此设备的 SSH')
    const report = await refreshDesktop()
    if (report.recommendation === 'moonlight') {
      try {
        await moonlight.launch(store.device(id), store.settings().moonlightPath, options)
        return 'moonlight'
      } catch (error) {
        if (!report.vncAvailable) throw error
      }
    }
    if (report.vncAvailable) return 'vnc'
    throw new Error(
      'SSH 已连接，文件和命令可用。远端桌面尚未就绪：请启动 Sunshine，或在 Mac 的“系统设置 → 通用 → 共享”中开启“屏幕共享”（或配置已有的远程管理）。',
    )
  })
  handle('openVnc', async (input) => {
    const id = idSchema.parse(input)
    if (!remote.connected(id)) throw new Error('请先连接此设备的 SSH')
    const device = store.device(id)
    return vnc.open(() => remote.forwardLoopback(device.vncPort ?? 5900))
  })
  handle('vncSend', (id, data) => vnc.send(idSchema.parse(id), data))
  handle('vncAck', (id) => vnc.ack(idSchema.parse(id)))
  handle('closeVnc', (id) => vnc.stop(idSchema.parse(id)))
  handle('pair', (input) => {
    const id = idSchema.parse(input)
    if (!remote.connected(id)) throw new Error('请先连接此设备的 SSH')
    return moonlight.launch(store.device(id), store.settings().moonlightPath)
  })
  handle('stopStream', () => moonlight.stop())
  handle('openSunshine', async (id) => {
    const device = store.device(idSchema.parse(id)),
      host = device.streamHost || device.host
    await shell.openExternal(`https://${host.includes(':') ? '[' + host + ']' : host}:47990`)
  })
  handle('openSetupResource', async (input) => {
    const resource = z.enum(setupResourceIds).parse(input)
    await shell.openExternal(setupResources[resource])
  })
  handle('saveSettings', async (input, key) => {
    if (agent.running) throw new Error('请先停止 AI 任务再修改设置')
    store.saveSettings(settingsSchema.parse(input))
    if (key !== undefined && key !== '')
      await store.setSecret('ai-api-key', z.string().max(4096).parse(key), true)
    return { secretStorage: await encryptionAvailable(), hasApiKey: store.hasSecret('ai-api-key') }
  })
  handle('clearApiKey', () => {
    if (agent.running) throw new Error('请先停止 AI 任务')
    store.clearSecret('ai-api-key')
  })
  handle('askAgent', (prompt) => agent.run(z.string().min(1).max(16000).parse(prompt)))
  handle('cancelAgent', () => agent.cancel())
  handle('clearAgent', () => agent.clear())

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  )
  session.defaultSession.setPermissionCheckHandler(() => false)
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      { role: 'editMenu' },
      { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'close' }] },
    ]),
  )
  createWindow()
}

function createWindow() {
  window = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 1050,
    minHeight: 720,
    title: 'macLinker',
    backgroundColor: '#f5f6f4',
    icon: path.join(__dirname, '../renderer/icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  window.webContents.on('did-start-loading', () => vnc?.stop())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.on('closed', () => {
    window = undefined
  })
  if (devURL) void window.loadURL(devURL)
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'))
}
app
  .whenReady()
  .then(ready)
  .catch((error) => {
    dialog.showErrorBox('macLinker 启动失败', errorMessage(error))
    app.quit()
  })
app.on('activate', () => {
  if (!BrowserWindow.getAllWindows().length) createWindow()
})
app.on('window-all-closed', () => {
  agent?.cancel()
  remote?.disconnect()
  moonlight?.stop()
  if (process.platform !== 'darwin') app.quit()
})
app.on('before-quit', () => {
  agent?.cancel()
  remote?.disconnect()
  moonlight?.stop()
})
