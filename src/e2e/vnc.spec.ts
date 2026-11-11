import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createVncFixture } from './fixtures/vnc-server'

test('SSH-first discovery, VNC fallback, separate authentication, pixels, input and cleanup', async () => {
  const fixture = await createVncFixture(),
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'maclinker-vnc-'))
  let application: ElectronApplication | undefined
  try {
    await fs.writeFile(
      path.join(dir, 'workspace.json'),
      JSON.stringify({
        version: 1,
        devices: [fixture.device],
        settings: { baseUrl: '', model: '', moonlightPath: '' },
        hosts: { [`127.0.0.1:${fixture.device.port}`]: fixture.fingerprint },
        secrets: {},
      }),
    )
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
    const page = await application.firstWindow(),
      errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(
      page.getByRole('heading', { name: fixture.device.name, exact: true }),
    ).toBeVisible()
    // VNC and Moonlight cannot bypass the SSH prerequisite.
    expect(
      await page.evaluate(async (id) => {
        try {
          await window.maclinker.openVnc(id)
          return ''
        } catch (error) {
          return String(error)
        }
      }, fixture.device.id),
    ).toContain('SSH')
    await page.getByRole('button', { name: '先连接 SSH', exact: true }).click()
    await page.getByLabel('账户密码').fill(fixture.sshPassword)
    await page.getByRole('dialog').getByRole('button', { name: '连接设备', exact: true }).click()
    // No manual diagnosis: the first SSH connection must trigger inspection.
    await expect(page.getByText('屏幕共享 / VNC 已响应', { exact: true })).toBeVisible({
      timeout: 15000,
    })
    const report = (await page.evaluate(() => window.maclinker.boot())).desktopCapabilities
    expect(report).toMatchObject({
      state: 'ready',
      sunshineInstalled: false,
      recommendation: 'vnc',
      vncAvailable: true,
    })
    await expect.poll(() => fixture.activeVncConnections).toBe(0)
    // Usable VNC still recommends the high-performance server, without blocking fallback.
    await expect(page.getByText('建议安装 Sunshine，启用高性能串流', { exact: true })).toBeVisible()
    await application.evaluate(({ shell }) => {
      ;(globalThis as any).setupLinks = []
      shell.openExternal = async (url) => {
        ;(globalThis as any).setupLinks.push(url)
      }
    })
    await page.getByRole('button', { name: '设置高性能串流', exact: true }).click()
    const setup = page.getByRole('dialog', { name: '设置高性能串流', exact: true })
    await expect(setup.getByText('未检测到安装', { exact: true })).toBeVisible()
    await setup.getByRole('button', { name: 'Sunshine 官方下载', exact: true }).click()
    await setup.getByRole('button', { name: 'Moonlight 官方下载', exact: true }).click()
    expect(await application.evaluate(() => (globalThis as any).setupLinks)).toEqual([
      'https://github.com/LizardByte/Sunshine/releases/latest',
      'https://github.com/moonlight-stream/moonlight-qt/releases/latest',
    ])
    await expect(
      setup.getByRole('button', { name: '开始 Moonlight 配对', exact: true }),
    ).toBeDisabled()
    expect(
      await page.evaluate(async () => {
        try {
          await window.maclinker.openSetupResource('https://example.com' as any)
          return ''
        } catch {
          return 'rejected'
        }
      }),
    ).toBe('rejected')
    await fs.mkdir('.test', { recursive: true })
    await setup.evaluate((element) => element.scrollTo(0, 0))
    await page.screenshot({ path: '.test/desktop-streaming-setup.png' })
    await setup.getByRole('button', { name: '返回设备概览', exact: true }).click()
    await page.getByRole('button', { name: '使用 VNC 打开桌面', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'VNC 桌面认证', exact: true })).toBeVisible()
    await expect(page.getByLabel('VNC 密码', { exact: true })).toHaveValue('')
    // Deliberately incorrect password exercises failure and reconnect without losing SSH.
    await page.getByLabel('VNC 密码', { exact: true }).fill('incorrect')
    await page.getByRole('button', { name: '验证并连接', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Wrong VNC password')
    await page.getByRole('button', { name: '重连 VNC', exact: true }).click()
    await page.getByLabel('VNC 密码', { exact: true }).fill(fixture.vncPassword)
    await page.getByRole('button', { name: '验证并连接', exact: true }).click()
    await expect(page.getByText('VNC 已连接 · SSH 加密传输', { exact: true })).toBeVisible()
    const canvas = page.getByTestId('vnc-screen').locator('canvas')
    await expect
      .poll(() =>
        canvas.evaluate((element) =>
          Array.from(
            (element as HTMLCanvasElement).getContext('2d')!.getImageData(20, 20, 1, 1).data,
          ),
        ),
      )
      .toEqual([46, 113, 86, 255])
    await canvas.click()
    await page.keyboard.press('a')
    await expect
      .poll(() =>
        fixture.inputs.some(
          (input) => input.type === 'key' && input.key === 97 && input.down === 1,
        ),
      )
      .toBe(true)
    expect(fixture.inputs.some((input) => input.type === 'pointer' && input.mask === 1)).toBe(true)
    await page.getByLabel('仅查看', { exact: true }).check()
    const count = fixture.inputs.length
    await canvas.click()
    await page.keyboard.press('b')
    expect(fixture.inputs).toHaveLength(count)
    await fs.mkdir('.test', { recursive: true })
    await page.screenshot({ path: '.test/desktop-vnc-fixture.png' })
    expect(fixture.authentications).toBe(1)
    expect(
      fixture.forwards.every(
        (item) => item.destIP === '127.0.0.1' && item.destPort === fixture.device.vncPort,
      ),
    ).toBe(true)
    await page.getByRole('button', { name: '返回概览', exact: true }).click()
    await expect.poll(() => fixture.activeVncConnections).toBe(0)
    // SSH-only mode remains useful after VNC becomes unavailable.
    fixture.disableVnc()
    await page.getByRole('button', { name: '重新检查', exact: true }).click()
    await expect(page.getByText('SSH 已就绪，桌面服务待开启', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '请先开启桌面服务', exact: true })).toBeDisabled()
    fixture.setSunshineStatus(true, false)
    await page.getByRole('button', { name: '重新检查', exact: true }).click()
    await expect(page.getByText('启动 Sunshine，启用高性能串流', { exact: true })).toBeVisible()
    await expect(page.getByText('建议安装 Sunshine，启用高性能串流', { exact: true })).toHaveCount(
      0,
    )
    expect(
      (await page.evaluate(() => window.maclinker.execute('printf ssh-still-works'))).stdout,
    ).toBe('ssh-still-works')
    await page.evaluate(() => window.maclinker.disconnect())
    expect((await page.evaluate(() => window.maclinker.boot())).desktopCapabilities).toBeNull()
    const stored = await fs.readFile(path.join(dir, 'workspace.json'), 'utf8')
    expect(stored).not.toContain(fixture.vncPassword)
    expect(stored).not.toContain(fixture.sshPassword)
    expect(errors).toEqual([])
  } finally {
    await application?.close()
    await fixture.close()
    await fs.rm(dir, { recursive: true, force: true })
  }
})
