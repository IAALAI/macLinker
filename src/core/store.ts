import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Device, Settings } from '../shared/types'
import { deviceSchema, settingsSchema } from './validation'

const schema = z.object({
  version: z.literal(1),
  devices: z.array(deviceSchema),
  settings: settingsSchema,
  hosts: z.record(z.string(), z.string()),
  secrets: z.record(z.string(), z.string()),
})
export interface SecretCodec {
  available(): Promise<boolean>
  encrypt(value: string): Promise<string>
  decrypt(value: string): Promise<string>
}

export class Store {
  private data: z.infer<typeof schema>
  private memorySecrets = new Map<string, string>()
  constructor(
    private filename: string,
    private codec: SecretCodec,
  ) {
    this.data = fs.existsSync(filename)
      ? schema.parse(JSON.parse(fs.readFileSync(filename, 'utf8')))
      : {
          version: 1,
          devices: [],
          settings: { baseUrl: '', model: '', moonlightPath: '' },
          hosts: {},
          secrets: {},
        }
  }
  private flush() {
    fs.mkdirSync(path.dirname(this.filename), { recursive: true, mode: 0o700 })
    const temporary = this.filename + '.' + randomUUID() + '.tmp'
    try {
      fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2), { mode: 0o600 })
      fs.renameSync(temporary, this.filename)
    } finally {
      fs.rmSync(temporary, { force: true })
    }
  }
  devices(): Device[] {
    return structuredClone(this.data.devices)
  }
  device(id: string): Device {
    const device = this.data.devices.find((device) => device.id === id)
    if (!device) throw new Error('设备不存在')
    return { ...device }
  }
  saveDevice(input: Device) {
    const device = deviceSchema.parse(input)
    const previous = this.data.devices.find((item) => item.id === device.id)
    if (
      previous &&
      (previous.host !== device.host ||
        previous.port !== device.port ||
        previous.username !== device.username)
    ) {
      this.memorySecrets.delete(device.id)
      delete this.data.secrets[device.id]
    }
    this.data.devices = [...this.data.devices.filter((item) => item.id !== device.id), device]
    this.flush()
    return this.devices()
  }
  removeDevice(id: string) {
    this.data.devices = this.data.devices.filter((device) => device.id !== id)
    delete this.data.secrets[id]
    this.memorySecrets.delete(id)
    this.flush()
    return this.devices()
  }
  settings(): Settings {
    return { ...this.data.settings }
  }
  saveSettings(settings: Settings) {
    this.data.settings = settingsSchema.parse(settings)
    this.flush()
  }
  private hostId(device: Device) {
    return `${device.host}:${device.port}`
  }
  hostKey(device: Device) {
    return this.data.hosts[this.hostId(device)]
  }
  trustHost(device: Device, fingerprint: string) {
    this.data.hosts[this.hostId(device)] = fingerprint
    this.flush()
  }
  forgetHost(device: Device) {
    delete this.data.hosts[this.hostId(device)]
    this.flush()
  }
  async setSecret(id: string, value: string, persist: boolean): Promise<boolean> {
    this.memorySecrets.set(id, value)
    delete this.data.secrets[id]
    const encrypted = persist && (await this.codec.available())
    if (encrypted) this.data.secrets[id] = await this.codec.encrypt(value)
    this.flush()
    return encrypted
  }
  async secret(id: string): Promise<string | undefined> {
    if (this.memorySecrets.has(id)) return this.memorySecrets.get(id)
    const encrypted = this.data.secrets[id]
    if (!encrypted) return undefined
    if (!(await this.codec.available())) throw new Error('系统钥匙串暂不可用，请重新输入凭据')
    return this.codec.decrypt(encrypted)
  }
  hasSecret(id: string) {
    return this.memorySecrets.has(id) || Boolean(this.data.secrets[id])
  }
  clearSecret(id: string) {
    this.memorySecrets.delete(id)
    delete this.data.secrets[id]
    this.flush()
  }
  secretStorage() {
    return this.codec.available()
  }
}
