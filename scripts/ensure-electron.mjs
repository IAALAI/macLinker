import fs from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
const require = createRequire(import.meta.url)
const directory = path.dirname(require.resolve('electron/package.json'))
if (!fs.existsSync(path.join(directory, 'path.txt'))) {
  const result = spawnSync(process.execPath, [path.join(directory, 'install.js')], {
    stdio: 'inherit',
  })
  if (result.status !== 0) throw new Error('Electron runtime download failed')
}
