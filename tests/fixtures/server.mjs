import { spawn } from 'child_process'

const child = spawn('npx', ['next', 'dev', '-p', '5973'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env },
})

function cleanup() {
  if (child.pid) {
    try {
      process.kill(child.pid, 'SIGTERM')
    } catch {}
    // On Windows, also try to kill the process tree
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        shell: true,
      })
    } catch {}
  }
  process.exit(0)
}

process.on('SIGTERM', cleanup)
process.on('SIGINT', cleanup)
process.on('SIGHUP', cleanup)
process.on('exit', () => {
  try {
    if (child.pid) process.kill(child.pid)
  } catch {}
})

child.on('exit', (code) => {
  process.exit(code ?? 1)
})
