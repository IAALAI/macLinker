import net from 'node:net'
import { createCipheriv, createHash, generateKeyPairSync } from 'node:crypto'
import ssh2, { type Connection } from 'ssh2'

const { Server, utils } = ssh2

// Minimal RFB 3.8 + SSH server for exercising the real Electron/noVNC transport.
// It requires a VNC password distinct from SSH, paints a frame, and records input.
export async function createVncFixture() {
  const vncPassword = 'vnc-test',
    sshPassword = 'ssh-test-only'
  const challenge = Buffer.from('00112233445566778899aabbccddeeff', 'hex')
  const key = Buffer.alloc(8)
  for (let i = 0; i < 8; i++) {
    const byte = vncPassword.charCodeAt(i) || 0
    for (let bit = 0; bit < 8; bit++) key[i] |= ((byte >> bit) & 1) << (7 - bit)
  }
  const cipher = createCipheriv('des-ede3', Buffer.concat([key, key, key]), null)
  cipher.setAutoPadding(false)
  const response = Buffer.concat([cipher.update(challenge), cipher.final()])
  const sockets = new Set<net.Socket>(),
    clients = new Set<Connection>()
  const inputs: {
    type: 'key' | 'pointer'
    key?: number
    down?: number
    x?: number
    y?: number
    mask?: number
  }[] = []
  const forwards: { destIP: string; destPort: number }[] = []
  let sunshineInstalled = false,
    sunshineRunning = false
  let authentications = 0,
    probes = 0,
    vncEnabled = true
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.write('RFB 003.008\n')
    probes++
    let buffer = Buffer.alloc(0),
      state: 'version' | 'security' | 'auth' | 'init' | 'messages' = 'version',
      painted = false
    function take(length: number) {
      const value = buffer.subarray(0, length)
      buffer = buffer.subarray(length)
      return value
    }
    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data])
      while (buffer.length) {
        if (state === 'version') {
          if (buffer.length < 12) return
          take(12)
          state = 'security'
          socket.write(Buffer.from([1, 2]))
        } else if (state === 'security') {
          if (take(1)[0] !== 2) {
            socket.destroy()
            return
          }
          state = 'auth'
          socket.write(challenge)
        } else if (state === 'auth') {
          if (buffer.length < 16) return
          if (!take(16).equals(response)) {
            const reason = Buffer.from('Wrong VNC password'),
              failure = Buffer.alloc(8)
            failure.writeUInt32BE(1, 0)
            failure.writeUInt32BE(reason.length, 4)
            socket.end(Buffer.concat([failure, reason]))
            return
          }
          authentications++
          state = 'init'
          socket.write(Buffer.alloc(4))
        } else if (state === 'init') {
          take(1)
          state = 'messages'
          const name = Buffer.from('macLinker test desktop'),
            init = Buffer.alloc(24)
          init.writeUInt16BE(640, 0)
          init.writeUInt16BE(400, 2)
          // 32-bit little-endian RGBX, matching noVNC's requested pixel format.
          init.set([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 0, 8, 16, 0, 0, 0], 4)
          init.writeUInt32BE(name.length, 20)
          socket.write(Buffer.concat([init, name]))
        } else {
          const type = buffer[0]
          let length: number
          if (type === 0) length = 20
          else if (type === 2) {
            if (buffer.length < 4) return
            length = 4 + 4 * buffer.readUInt16BE(2)
          } else if (type === 3) length = 10
          else if (type === 4) length = 8
          else if (type === 5) length = 6
          else if (type === 6) {
            if (buffer.length < 8) return
            length = 8 + buffer.readUInt32BE(4)
          } else {
            socket.destroy()
            return
          }
          if (buffer.length < length) return
          const message = take(length)
          if (type === 4)
            inputs.push({ type: 'key', down: message[1], key: message.readUInt32BE(4) })
          if (type === 5)
            inputs.push({
              type: 'pointer',
              mask: message[1],
              x: message.readUInt16BE(2),
              y: message.readUInt16BE(4),
            })
          if (type === 3 && !painted) {
            painted = true
            const header = Buffer.alloc(16)
            header.writeUInt16BE(1, 2)
            header.writeUInt16BE(640, 8)
            header.writeUInt16BE(400, 10)
            const pixels = Buffer.alloc(640 * 400 * 4)
            for (let i = 0; i < pixels.length; i += 4) pixels.set([46, 113, 86, 255], i)
            socket.write(Buffer.concat([header, pixels]))
          }
        }
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const vncPort = (server.address() as net.AddressInfo).port
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs1', format: 'pem' })
    .toString()
  const parsed = utils.parseKey(privateKey)
  if (parsed instanceof Error || Array.isArray(parsed))
    throw new Error('Could not create fixture host key')
  const fingerprint =
    'SHA256:' +
    createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '')
  const ssh = new Server({ hostKeys: [privateKey] }, (client) => {
    clients.add(client)
    client.on('close', () => clients.delete(client))
    client.on('error', () => {})
    client.on('authentication', (context) => {
      if (
        context.method === 'password' &&
        context.username === 'alice' &&
        context.password === sshPassword
      )
        context.accept()
      else context.reject()
    })
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept()
        session.on('sftp', (accept) => {
          const sftp = accept()
          sftp.on('REALPATH', (id) =>
            sftp.name(id, [
              {
                filename: '/Users/alice',
                longname: '',
                attrs: { mode: 0o40755, size: 0, uid: 501, gid: 20, atime: 0, mtime: 0 },
              },
            ]),
          )
        })
        session.on('exec', (accept, _reject, info) => {
          const stream = accept()
          stream.write(
            info.command.includes('MACLINKER_SUNSHINE')
              ? `MACLINKER_SUNSHINE_INSTALLED=${Number(sunshineInstalled)}\nMACLINKER_SUNSHINE_RUNNING=${Number(sunshineRunning)}\n`
              : 'ssh-still-works',
          )
          stream.exit(0)
          stream.end()
        })
      })
      client.on('tcpip', (accept, reject, info) => {
        forwards.push({ destIP: info.destIP, destPort: info.destPort })
        if (!vncEnabled || info.destIP !== '127.0.0.1' || info.destPort !== vncPort) {
          reject()
          return
        }
        const channel = accept(),
          socket = net.createConnection({ host: '127.0.0.1', port: vncPort })
        socket.on('error', () => channel.destroy())
        channel.on('error', () => socket.destroy())
        channel.on('close', () => socket.destroy())
        socket.on('close', () => channel.destroy())
        socket.pipe(channel).pipe(socket)
      })
    })
  })
  await new Promise<void>((resolve) => ssh.listen(0, '127.0.0.1', resolve))
  const port = (ssh.address() as net.AddressInfo).port
  return {
    device: {
      id: 'vnc-fixture',
      name: 'VNC 测试 Mac',
      host: '127.0.0.1',
      port,
      username: 'alice',
      identity: '',
      streamHost: '',
      streamApp: 'Desktop',
      color: 'mint',
      vncPort,
    },
    fingerprint,
    setSunshineStatus(installed: boolean, running: boolean) {
      sunshineInstalled = installed
      sunshineRunning = running
    },
    sshPassword,
    vncPassword,
    inputs,
    forwards,
    get authentications() {
      return authentications
    },
    get probes() {
      return probes
    },
    get activeVncConnections() {
      return sockets.size
    },
    disableVnc() {
      vncEnabled = false
      for (const socket of sockets) socket.destroy()
    },
    async close() {
      for (const client of clients) client.end()
      for (const socket of sockets) socket.destroy()
      await Promise.all([
        new Promise<void>((resolve) => ssh.close(() => resolve())),
        new Promise<void>((resolve) => server.close(() => resolve())),
      ])
    },
  }
}
