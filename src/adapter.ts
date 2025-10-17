import { spawn } from 'child_process'
import * as net from 'net'

// Default host and port where your DAP server listens
const HOST = '127.0.0.1'
const PORT = 9000

// Read launch configuration from stdin (the first message VS Code sends)
async function readLaunchRequest (): Promise<string> {
  return new Promise(resolve => {
    let buffer = ''
    process.stdin.on('data', chunk => {
      buffer += chunk.toString()
      // VS Code sends headers like "Content-Length: N\r\n\r\n<json>"
      const match = buffer.match(/Content-Length: (\d+)\r\n\r\n([\s\S]*)/)
      if (match) {
        resolve(buffer)
      }
    })
  })
}

// Try to connect to the TCP DAP server until it's ready
async function waitForServer (): Promise<net.Socket> {
  for (let i = 0; i < 25; i++) {
    try {
      return await new Promise<net.Socket>((resolve, reject) => {
        const socket = new net.Socket()
        socket.connect(PORT, HOST, () => resolve(socket))
        socket.on('error', reject)
      })
    } catch {
      await new Promise(r => setTimeout(r, 200))
    }
  }
  throw new Error(`Failed to connect to debug server on ${HOST}:${PORT}`)
}

;(async () => {
  let initializeRequest = await readLaunchRequest()

  // Start your language’s DAP server for that program
  spawn(
    process.env.BUZZ_DEBUGGER_PATH ?? 'buzz_debugger',
    ['--output', process.env.BUZZ_DEBUGGER_LOG_FILE ?? 'log.txt'],
    {
      stdio: 'pipe'
    }
  )

  // Connect to the TCP DAP server
  try {
    const socket = await waitForServer()
    process.stdin.pipe(socket)
    socket.pipe(process.stdout)

    socket.on('close', () => process.exit(0))
    socket.on('error', err => {
      process.exit(1)
    })

    // Repeat the initialize request to buzz_debugger
    socket.write(initializeRequest)
  } catch (err) {
    process.exit(1)
  }
})()
