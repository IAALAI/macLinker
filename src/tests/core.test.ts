import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Store, type SecretCodec } from '../core/store'
import { deviceSchema, settingsSchema, shellQuote } from '../core/validation'
import { streamArgs } from '../core/moonlight'
import type { Device } from '../shared/types'
import { execFileSync } from 'node:child_process'

export const device: Device = {
  id: 'test',
  name: 'Test Mac',
  host: '192.0.2.10',
  port: 22,
  username: 'alice',
  identity: '',
  streamHost: '',
  streamApp: 'Desktop',
  color: 'mint',
}
const noEncryption: SecretCodec = {
  available: async () => false,
  encrypt: async () => {
    throw Error('unavailable')
  },
  decrypt: async () => {
    throw Error('unavailable')
  },
}
describe('device and settings boundaries', () => {
  it('rejects executable host/username injection and out-of-range ports', () => {
    for (const host of ['-flag', 'host; id', 'host\nfoo', 'user@host', '$(id)'])
      expect(() => deviceSchema.parse({ ...device, host })).toThrow()
    expect(() => deviceSchema.parse({ ...device, port: 0 })).toThrow()
    expect(() => deviceSchema.parse({ ...device, username: '-user' })).toThrow()
    expect(deviceSchema.parse({ ...device, host: '::1' }).host).toBe('::1')
  })
  it('limits unencrypted model credentials to localhost', () => {
    for (const baseUrl of [
      'http://example.com/v1',
      'https://key@example.com/v1',
      'https://example.com/v1?key=secret',
      'file:///tmp/config',
    ]) {
      expect(() => settingsSchema.parse({ baseUrl, model: 'test', moonlightPath: '' })).toThrow()
    }
    expect(
      settingsSchema.parse({
        baseUrl: 'http://127.0.0.1:11434/v1',
        model: 'test',
        moonlightPath: '',
      }).baseUrl,
    ).toContain('127.0.0.1')
  })
  it('passes Moonlight app names as positional arguments', () => {
    const args = streamArgs(
      { ...device, streamApp: '--special name' },
      { resolution: '1920x1080', fps: 60, bitrate: 20000 },
    )
    expect(args.slice(-3)).toEqual(['--', device.host, '--special name'])
  })
  it.skipIf(process.platform === 'win32')(
    'quotes remote shell strings as a single literal argument',
    () => {
      const input = 'a \' $(printf bad); "example"\nnext'
      expect(
        execFileSync('/bin/sh', ['-c', `printf %s ${shellQuote(input)}`], { encoding: 'utf8' }),
      ).toBe(input)
    },
  )
})
describe('local storage', () => {
  it('never persists a secret without OS encryption', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maclinker-store-'))
    try {
      const file = path.join(dir, 'workspace.json'),
        store = new Store(file, noEncryption)
      store.saveDevice(device)
      expect(await store.setSecret(device.id, 'test-private-password', true)).toBe(false)
      expect(await store.secret(device.id)).toBe('test-private-password')
      expect(fs.readFileSync(file, 'utf8')).not.toContain('test-private-password')
      const reopened = new Store(file, noEncryption)
      expect(await reopened.secret(device.id)).toBeUndefined()
      expect(reopened.devices()).toHaveLength(1)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
  it('binds trust to an endpoint and clears credentials when the endpoint changes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maclinker-store-'))
    try {
      const store = new Store(path.join(dir, 'workspace.json'), noEncryption)
      store.saveDevice(device)
      store.trustHost(device, 'SHA256:example')
      await store.setSecret(device.id, 'temporary-password', false)
      store.saveDevice({ ...device, host: 'other.local' })
      expect(store.hostKey({ ...device, host: 'other.local' })).toBeUndefined()
      expect(await store.secret(device.id)).toBeUndefined()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
  it('does not overwrite corrupt configuration', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maclinker-store-'))
    try {
      const file = path.join(dir, 'workspace.json')
      fs.writeFileSync(file, '{invalid')
      expect(() => new Store(file, noEncryption)).toThrow()
      expect(fs.readFileSync(file, 'utf8')).toBe('{invalid')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
