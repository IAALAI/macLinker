import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import http from 'node:http'

test('real Mac: SSH, structured files, transfer, command and AI tool round-trip', async () => {
  test.skip(!process.env.MACLINKER_LIVE_DEVICE_FILE, 'Explicitly opt in with a private device file')
  const rows = Object.fromEntries(
    (await fs.readFile(process.env.MACLINKER_LIVE_DEVICE_FILE!, 'utf8'))
      .split(/\r?\n/)
      .filter((line) => line.includes('：'))
      .map((line) => {
        const i = line.indexOf('：')
        return [line.slice(0, i).trim(), line.slice(i + 1).trim()]
      }),
  )
  const [username, host] = rows.SSH.split('@')
  const known = execFileSync(
    'ssh-keygen',
    ['-F', host, '-f', process.env.MACLINKER_LIVE_KNOWN_HOSTS || '.test/known_hosts'],
    { encoding: 'utf8' },
  )
    .split('\n')
    .find((line) => line && !line.startsWith('#'))
  if (!known) throw new Error('Trust this device using SSH before running this test')
  const fingerprint =
    'SHA256:' +
    createHash('sha256')
      .update(Buffer.from(known.split(/\s+/)[2], 'base64'))
      .digest('base64')
      .replace(/=+$/, '')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'maclinker-live-'))
  const device = {
    id: 'live-mac',
    name: '调试 Mac',
    host,
    username,
    port: 22,
    identity: '',
    streamHost: '',
    streamApp: 'Desktop',
    color: 'mint',
  }
  await fs.writeFile(
    path.join(dir, 'workspace.json'),
    JSON.stringify({
      version: 1,
      devices: [device],
      settings: { baseUrl: '', model: '', moonlightPath: '' },
      hosts: { [`${host}:22`]: fingerprint },
      secrets: {},
    }),
    { mode: 0o600 },
  )
  let application: ElectronApplication | undefined,
    remoteDir = '',
    providerCalls = 0
  const requests: any[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      requests.push(JSON.parse(body))
      providerCalls++
      const response =
        providerCalls === 1
          ? {
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      {
                        id: 'inspect-dir',
                        type: 'function',
                        function: {
                          name: 'list_directory',
                          arguments: JSON.stringify({ path: remoteDir }),
                        },
                      },
                    ],
                  },
                },
              ],
            }
          : { choices: [{ message: { content: '已通过 SSH 检查测试目录，文件传输正常。' } }] }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(response))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as import('node:net').AddressInfo).port
  try {
    const env = Object.fromEntries(
      Object.entries({ ...process.env, MACLINKER_DATA_DIR: dir }).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    )
    delete env.ELECTRON_RUN_AS_NODE
    application = await electron.launch({
      executablePath: process.env.MACLINKER_E2E_EXECUTABLE,
      args: [...(process.env.MACLINKER_E2E_EXECUTABLE ? [] : ['.']), '--no-sandbox'],
      env,
    })
    const page = await application.firstWindow()
    await expect(page.getByRole('heading', { name: '调试 Mac', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '连接设备', exact: true }).click()
    await page.getByLabel('账户密码').fill(rows['密码'])
    await page.getByRole('dialog').getByRole('button', { name: '连接设备', exact: true }).click()
    await expect(page.getByText('SSH 已连接', { exact: true })).toBeVisible({ timeout: 30000 })
    await expect
      .poll(
        async () => (await page.evaluate(() => window.maclinker.boot())).desktopCapabilities?.state,
        { timeout: 15000 },
      )
      .toBe('ready')
    const capabilities = (await page.evaluate(() => window.maclinker.boot())).desktopCapabilities!
    expect(capabilities.checks[0].ok).toBe(true)
    await fs.mkdir('.test', { recursive: true })
    await fs.writeFile(
      '.test/desktop-live-capabilities.json',
      JSON.stringify(capabilities, null, 2),
    )
    await page.screenshot({ path: '.test/desktop-live-overview.png' })
    const result = await page.evaluate(() =>
      window.maclinker.execute('/usr/bin/mktemp -d /tmp/maclinker-desktop.XXXXXXXX'),
    )
    remoteDir = result.stdout.trim()
    expect(remoteDir).toMatch(/^\/tmp\/maclinker-desktop\.[A-Za-z0-9]+$/)
    const filename = "桌面 upload 'quoted' [x] $test.txt"
    const source = path.join(dir, filename),
      destination = path.join(dir, 'download.txt')
    const payload = 'macLinker desktop integrity check\n'.repeat(16384)
    await fs.writeFile(source, payload)
    await application.evaluate(({ dialog }, source) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] })
    }, source)
    await page.evaluate((remoteDir) => window.maclinker.upload(remoteDir), remoteDir)
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.maclinker.boot())).transfers.find(
            (item) => item.direction === 'upload',
          )?.state,
      )
      .toBe('completed')
    await application.evaluate(({ dialog }, destination) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination })
    }, destination)
    await page.evaluate((remote) => window.maclinker.download(remote), remoteDir + '/' + filename)
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.maclinker.boot())).transfers.find(
            (item) => item.direction === 'download',
          )?.state,
      )
      .toBe('completed')
    expect(
      createHash('sha256')
        .update(await fs.readFile(destination))
        .digest('hex'),
    ).toBe(createHash('sha256').update(payload).digest('hex'))
    // An existing remote filename must not be silently overwritten.
    await page.evaluate((remoteDir) => window.maclinker.upload(remoteDir), remoteDir)
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.maclinker.boot())).transfers
            .filter((item) => item.direction === 'upload')
            .at(-1)?.state,
      )
      .toBe('failed')
    await page.getByRole('button', { name: '收起传输记录' }).click()
    await page.getByRole('navigation').getByRole('button', { name: '文件', exact: true }).click()
    await page.getByLabel('远程路径').fill(remoteDir)
    await page.getByLabel('远程路径').press('Enter')
    await expect(page.getByRole('button', { name: filename, exact: true })).toBeVisible()
    await page.screenshot({ path: '.test/desktop-live-files.png' })
    await page.getByRole('button', { name: `预览 ${filename}` }).click()
    await expect(page.getByRole('dialog')).toContainText('macLinker desktop integrity check')
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
    await page
      .getByRole('navigation')
      .getByRole('button', { name: '远程命令', exact: true })
      .click()
    await page.getByLabel('远程命令', { exact: true }).fill('sw_vers')
    await page.getByRole('button', { name: '执行', exact: true }).click()
    await expect(page.locator('.command-output')).toContainText('ProductVersion')
    await page.screenshot({ path: '.test/desktop-live-command.png' })
    await page.evaluate(
      async ({ port }) => {
        await window.maclinker.saveSettings({
          baseUrl: `http://127.0.0.1:${port}/v1`,
          model: 'local-fixture',
          moonlightPath: '',
        })
      },
      { port },
    )
    // Reload rehydrates settings while keeping the main-process connection alive.
    await page.reload()
    await page
      .getByRole('navigation')
      .getByRole('button', { name: /AI 助手/ })
      .click()
    await page.getByLabel('AI 任务').fill('查看测试目录')
    await page.getByRole('button', { name: '发送任务', exact: true }).click()
    await expect(
      page.getByText('已通过 SSH 检查测试目录，文件传输正常。', { exact: true }),
    ).toBeVisible({ timeout: 15000 })
    expect(requests[1].messages.at(-1).role).toBe('tool')
    expect(requests[1].messages.at(-1).content).toContain(filename)
    await page.screenshot({ path: '.test/desktop-live-agent.png' })
    const cancellation = await page.evaluate(async () => {
      const pending = window.maclinker.execute('sleep 5')
      setTimeout(() => void window.maclinker.cancelCommand(), 100)
      try {
        await pending
        return ''
      } catch (error) {
        return String(error)
      }
    })
    expect(cancellation).toContain('取消')
    expect(
      (await page.evaluate(() => window.maclinker.execute('printf still-connected'))).stdout,
    ).toBe('still-connected')
    const created = await page.evaluate(
      (remoteDir) =>
        window.maclinker.execute('/usr/sbin/mkfile -n 32m ' + remoteDir + '/large.bin'),
      remoteDir,
    )
    expect(created.code).toBe(0)
    await fs.writeFile(destination, 'original-content')
    await page.evaluate(
      (remote) =>
        new Promise<void>((resolve, reject) => {
          const unsubscribe = window.maclinker.onEvent((event) => {
            if (
              event.type === 'transfer' &&
              event.transfer.direction === 'download' &&
              event.transfer.state === 'running'
            ) {
              unsubscribe()
              void window.maclinker.cancelTransfer(event.transfer.id).then(resolve, reject)
            }
            if (
              event.type === 'transfer' &&
              event.transfer.direction === 'download' &&
              event.transfer.state === 'failed'
            ) {
              unsubscribe()
              reject(new Error(event.transfer.error))
            }
          })
          void window.maclinker.download(remote).catch(reject)
        }),
      remoteDir + '/large.bin',
    )
    await expect
      .poll(
        async () => (await page.evaluate(() => window.maclinker.boot())).transfers.at(-1)?.state,
      )
      .toBe('cancelled')
    expect(await fs.readFile(destination, 'utf8')).toBe('original-content')
    expect((await fs.readdir(dir)).filter((name) => name.endsWith('.part'))).toEqual([])
    await page.evaluate(
      (remoteDir) => window.maclinker.execute('/bin/rm -rf -- ' + remoteDir),
      remoteDir,
    )
    remoteDir = ''
  } finally {
    if (application) {
      if (/^\/tmp\/maclinker-desktop\.[A-Za-z0-9]+$/.test(remoteDir)) {
        const page = await application.firstWindow()
        await page
          .evaluate(
            (remoteDir) => window.maclinker.execute('/bin/rm -rf -- ' + remoteDir),
            remoteDir,
          )
          .catch(() => {})
      }
      await application.close()
    }
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await fs.rm(dir, { recursive: true, force: true })
  }
})
