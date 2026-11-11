import { contextBridge, ipcRenderer } from 'electron'
import type { API, AppEvent, VncEvent } from '../shared/types'

const invoke = (method: string, ...args: unknown[]) =>
  ipcRenderer.invoke('maclinker:' + method, ...args)
const api: API = {
  boot: () => invoke('boot'),
  saveDevice: (device) => invoke('saveDevice', device),
  removeDevice: (id) => invoke('removeDevice', id),
  chooseIdentity: () => invoke('chooseIdentity'),
  forgetHost: (id) => invoke('forgetHost', id),
  connect: (id, credentials) => invoke('connect', id, credentials),
  disconnect: () => invoke('disconnect'),
  diagnose: () => invoke('diagnose'),
  list: (path) => invoke('list', path),
  read: (path) => invoke('read', path),
  mkdir: (path) => invoke('mkdir', path),
  upload: (path) => invoke('upload', path),
  download: (path) => invoke('download', path),
  cancelTransfer: (id) => invoke('cancelTransfer', id),
  execute: (command) => invoke('execute', command),
  cancelCommand: () => invoke('cancelCommand'),
  stream: (id, options) => invoke('stream', id, options),
  inspectDesktop: () => invoke('inspectDesktop'),
  openVnc: (id) => invoke('openVnc', id),
  vncSend: (id, data) => invoke('vncSend', id, data),
  vncAck: (id) => invoke('vncAck', id),
  closeVnc: (id) => invoke('closeVnc', id),
  onVnc: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: VncEvent) => listener(payload)
    ipcRenderer.on('maclinker:vnc', wrapped)
    return () => ipcRenderer.removeListener('maclinker:vnc', wrapped)
  },
  pair: (id) => invoke('pair', id),
  stopStream: () => invoke('stopStream'),
  openSunshine: (id) => invoke('openSunshine', id),
  openSetupResource: (resource) => invoke('openSetupResource', resource),
  saveSettings: (settings, apiKey) => invoke('saveSettings', settings, apiKey),
  clearApiKey: () => invoke('clearApiKey'),
  askAgent: (prompt) => invoke('askAgent', prompt),
  cancelAgent: () => invoke('cancelAgent'),
  clearAgent: () => invoke('clearAgent'),
  onEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: AppEvent) => listener(payload)
    ipcRenderer.on('maclinker:event', wrapped)
    return () => ipcRenderer.removeListener('maclinker:event', wrapped)
  },
}
contextBridge.exposeInMainWorld('maclinker', api)
