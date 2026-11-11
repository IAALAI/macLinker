import { spawn } from 'node:child_process'
await import('./ensure-electron.mjs')
const { default: electron } = await import('electron')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env })
child.on('exit', (code) => process.exit(code ?? 0))
process.on('SIGINT', () => child.kill())
