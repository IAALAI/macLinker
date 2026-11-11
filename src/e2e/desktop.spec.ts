import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

let application: ElectronApplication
let directory: string
test.beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'maclinker-e2e-'))
  const env = Object.fromEntries(
    Object.entries({ ...process.env, MACLINKER_DATA_DIR: directory }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
  delete env.ELECTRON_RUN_AS_NODE
  application = await electron.launch({
    executablePath: process.env.MACLINKER_E2E_EXECUTABLE,
    args: [...(process.env.MACLINKER_E2E_EXECUTABLE ? [] : ['.']), '--no-sandbox'],
    env,
    timeout: 30000,
  })
})
test.afterEach(async () => {
  await application?.close()
  await fs.rm(directory, { recursive: true, force: true })
})

test('desktop onboarding, device persistence, settings and isolated renderer', async () => {
  const page = await application.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.getByRole('heading', { name: '让距离，留在工作之外。' })).toBeVisible()
  expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined')
  expect(await page.evaluate(() => typeof (window as any).process)).toBe('undefined')
  await fs.mkdir('.test', { recursive: true })
  await page.screenshot({ path: '.test/desktop-welcome.png' })
  await page.getByRole('button', { name: '添加第一台设备' }).click()
  const modal = page.getByRole('dialog', { name: '添加一台 Mac' })
  await modal.getByLabel('设备名称', { exact: true }).fill('工作室 Mac mini')
  await modal.getByLabel('主机地址', { exact: true }).fill('192.0.2.10')
  await modal.getByLabel('用户名', { exact: true }).fill('alice')
  await modal.getByRole('button', { name: '添加设备', exact: true }).click()
  await expect(page.getByRole('heading', { name: '工作室 Mac mini', exact: true })).toBeVisible()
  await page.screenshot({ path: '.test/desktop-device.png' })
  await page.getByRole('button', { name: '连接设备', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '连接 工作室 Mac mini' })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('navigation').getByRole('button', { name: '文件', exact: true }).click()
  await expect(page.getByRole('heading', { name: '连接 工作室 Mac mini' })).toBeVisible()
  await page.locator('.sidebar-bottom').getByRole('button', { name: /设置/ }).click()
  await page.getByLabel('API 基础地址').fill('http://127.0.0.1:11434/v1')
  await page.getByLabel('模型名称', { exact: true }).fill('local-test-model')
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await expect(page.getByText('设置已保存', { exact: true })).toBeVisible()
  await page.screenshot({ path: '.test/desktop-settings.png' })
  await page.reload()
  await expect(page.getByRole('heading', { name: '工作室 Mac mini', exact: true })).toBeVisible()
  const boot = await page.evaluate(() => window.maclinker.boot())
  expect(boot.settings.model).toBe('local-test-model')
  expect(boot.devices).toHaveLength(1)
  expect(errors).toEqual([])
})
