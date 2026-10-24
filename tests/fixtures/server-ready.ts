import type { ChildProcess } from 'node:child_process'

/** Read readiness from this child, never from a potentially unrelated HTTP listener. */
export function serverOrigin(server: ChildProcess, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '',
      pending = ''
    const finish = (error?: Error, origin?: string) => {
      clearTimeout(timer)
      server.stdout?.off('data', stdout)
      server.stderr?.off('data', stderr)
      server.off('exit', exited)
      server.off('error', failed)
      if (error) reject(error)
      else resolve(origin!)
    }
    const stdout = (chunk: Buffer) => {
      output += String(chunk)
      pending += String(chunk)
      const lines = pending.split('\n')
      pending = lines.pop()!
      for (const line of lines) {
        if (!line.startsWith('DERP_SERVER_READY=')) continue
        try {
          const { port, pid } = JSON.parse(line.slice('DERP_SERVER_READY='.length)) as {
            port: number
            pid: number
          }
          if (pid !== server.pid || !Number.isInteger(port) || port < 1 || port > 65535)
            throw new Error('Invalid server readiness identity or port')
          finish(undefined, `http://127.0.0.1:${port}`)
          return
        } catch (error) {
          finish(new Error(`Invalid server readiness: ${String(error)}\n${output}`))
          return
        }
      }
    }
    const stderr = (chunk: Buffer) => {
      output += String(chunk)
    }
    const exited = (code: number | null, signal: NodeJS.Signals | null) =>
      finish(new Error(`Server exited before readiness (${code ?? signal}):\n${output}`))
    const failed = (error: Error) => finish(error)
    const timer = setTimeout(
      () => finish(new Error(`Server readiness timed out:\n${output}`)),
      timeoutMs,
    )
    server.stdout?.on('data', stdout)
    server.stderr?.on('data', stderr)
    server.once('exit', exited)
    server.once('error', failed)
    if (!server.stdout) finish(new Error('Server readiness requires piped stdout'))
    else if (server.exitCode !== null || server.signalCode !== null)
      exited(server.exitCode, server.signalCode)
  })
}
