import { describe, it, expect } from 'vitest'
import { PassThrough } from 'node:stream'
import type { ClientChannel } from 'ssh2'
import { inspectDesktop, preferredDesktop, probeVnc } from '../core/desktop-probe'
import { VncTunnel } from '../core/vnc'
import type { Device, VncEvent } from '../shared/types'

const device: Device = {
  id: 'probe',
  name: 'Mac',
  host: '192.0.2.1',
  username: 'alice',
  port: 22,
  identity: '',
  streamHost: '',
  streamApp: 'Desktop',
  color: 'mint',
  vncPort: 5901,
}
const channel = () => new PassThrough() as unknown as ClientChannel
const banner = () => {
  const stream = channel()
  stream.pause()
  stream.write('RFB 003.008\n')
  return Promise.resolve(stream)
}

describe('first SSH connection inspection', () => {
  it('prefers Moonlight only when both ends are ready, then VNC, then SSH', () => {
    const ready = {
      sunshineInstalled: true,
      sunshineRunning: true,
      streamReachable: true,
      moonlightInstalled: true,
      vncAvailable: true,
    }
    expect(preferredDesktop(ready)).toBe('moonlight')
    for (const key of [
      'sunshineInstalled',
      'sunshineRunning',
      'streamReachable',
      'moonlightInstalled',
    ]) {
      expect(preferredDesktop({ ...ready, [key]: false })).toBe('vnc')
      expect(preferredDesktop({ ...ready, [key]: false, vncAvailable: false })).toBe('ssh')
    }
  })
  it('checks the RFB banner rather than treating any open TCP port as VNC', async () => {
    expect((await probeVnc(banner)).ok).toBe(true)
    const fragmented = channel()
    const pending = probeVnc(async () => fragmented)
    fragmented.write('RFB 003.')
    fragmented.write('008\n')
    expect((await pending).ok).toBe(true)
    const http = channel()
    http.write('HTTP/1.1 200')
    expect((await probeVnc(async () => http)).ok).toBe(false)
    expect(
      (
        await probeVnc(async () => {
          throw new Error('refused')
        })
      ).ok,
    ).toBe(false)
    const silent = channel()
    expect((await probeVnc(async () => silent, 10)).ok).toBe(false)
    expect(silent.destroyed).toBe(true)
  })
  it('detects installed-but-stopped Sunshine and a custom VNC port through SSH', async () => {
    const ports: number[] = []
    const report = await inspectDesktop(
      {
        execute: async () => ({
          stdout: 'MACLINKER_SUNSHINE_INSTALLED=1\nMACLINKER_SUNSHINE_RUNNING=0\n',
          stderr: '',
          code: 0,
          truncated: false,
        }),
        forwardLoopback: async (port) => {
          ports.push(port)
          return banner()
        },
      },
      device,
      undefined,
      async () => false,
    )
    expect(report).toMatchObject({
      state: 'ready',
      sunshineInstalled: true,
      sunshineRunning: false,
      vncAvailable: true,
      recommendation: 'vnc',
    })
    expect(ports).toEqual([5901])
  })
  it('preserves SSH availability when host inspection and desktop services fail', async () => {
    const report = await inspectDesktop(
      {
        execute: async () => {
          throw new Error('probe unavailable')
        },
        forwardLoopback: async () => {
          throw new Error('forward denied')
        },
      },
      device,
      undefined,
      async () => false,
    )
    expect(report).toMatchObject({
      state: 'error',
      sunshineInstalled: null,
      vncAvailable: false,
      recommendation: 'ssh',
    })
    expect(report.checks[0].ok).toBe(true)
  })
})

describe('VNC tunnel lifecycle and flow control', () => {
  it('waits for the renderer, pauses between chunks, and isolates stale sessions', async () => {
    const events: VncEvent[] = [],
      tunnel = new VncTunnel((event) => events.push(event))
    const first = channel(),
      second = channel()
    const a = await tunnel.open(async () => first)
    first.write('first-frame')
    expect(events).toHaveLength(0)
    tunnel.ack(a.sessionId)
    await new Promise((resolve) => setImmediate(resolve))
    expect(events).toHaveLength(1)
    first.write('second-frame')
    await new Promise((resolve) => setImmediate(resolve))
    expect(events).toHaveLength(1)
    tunnel.ack(a.sessionId)
    await new Promise((resolve) => setImmediate(resolve))
    expect(events).toHaveLength(2)
    const b = await tunnel.open(async () => second)
    expect(first.destroyed).toBe(true)
    tunnel.stop(a.sessionId)
    expect(second.destroyed).toBe(false)
    await expect(tunnel.send(a.sessionId, new Uint8Array([1]))).rejects.toThrow('已结束')
    expect(() => tunnel.ack(a.sessionId)).toThrow('已结束')
    await expect(tunnel.send(b.sessionId, new Uint8Array(262145))).rejects.toThrow('无效')
    tunnel.stop()
    expect(second.destroyed).toBe(true)
  })
  it('destroys a late-opened channel after cancellation without replacing a newer session', async () => {
    const tunnel = new VncTunnel(() => {}),
      late = channel(),
      current = channel()
    let finish!: (stream: ClientChannel) => void
    const pending = tunnel.open(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await tunnel.open(async () => current)
    finish(late)
    await expect(pending).rejects.toThrow('取消')
    expect(late.destroyed).toBe(true)
    expect(current.destroyed).toBe(false)
    tunnel.stop()
  })
})
