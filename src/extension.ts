import { promises, watch } from 'fs'
import path = require('path')
import { workspace, ExtensionContext, window } from 'vscode'

import * as vscode from 'vscode'
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions
} from 'vscode-languageclient/node'

let lspOutputChannel: vscode.OutputChannel
let dapOutputChannel: vscode.OutputChannel
let client: LanguageClient | null = null

export function activate (context: ExtensionContext) {
  lspOutputChannel = window.createOutputChannel('buzz Language Server')
  dapOutputChannel = window.createOutputChannel('buzz Debugger Adapter')
  followLogFile(
    workspace.getConfiguration('buzz').get('debugger_log_file', 'log.txt'),
    dapOutputChannel
  )

  vscode.commands.registerCommand('buzz.start_lsp', async () => {
    await startLSP(context)
  })

  vscode.commands.registerCommand('buzz.stop_lsp', async () => {
    await stopLSP()
  })

  vscode.commands.registerCommand('buzz.restart_lsp', async () => {
    await stopLSP()
    await startLSP(context)
  })

  const factory: vscode.DebugAdapterDescriptorFactory = {
    createDebugAdapterDescriptor: function (
      session: vscode.DebugSession,
      executable: vscode.DebugAdapterExecutable | undefined
    ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
      return new vscode.DebugAdapterExecutable(
        'node',
        [path.join(__dirname, 'adapter.js')],
        {
          env: {
            BUZZ_DEBUGGER_PATH: workspace
              .getConfiguration('buzz')
              .get('debugger_path', 'buzz_debugger'),
            BUZZ_DEBUGGER_LOG_FILE: workspace
              .getConfiguration('buzz')
              .get('debugger_log_file', 'log.txt')
          }
        }
      )
    }
  }

  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory('buzz', factory)
  )

  startLSP(context)
}

function startLSP (_: ExtensionContext): Promise<void> {
  const configuration = workspace.getConfiguration('buzz')
  const lspPath = configuration.get('lsp_path', 'buzz_lsp')

  let serverOptions: ServerOptions = {
    command: lspPath,
    args: []
  }

  // Options to control the language client
  let clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'buzz' }],
    outputChannel: lspOutputChannel
  }

  // Create the language client and start the client.
  client = new LanguageClient(
    'buzz',
    'buzz Language Server',
    serverOptions,
    clientOptions
  )

  lspOutputChannel.appendLine(`Attempting to use buzz with ${lspPath}`)

  return new Promise<void>(resolve => {
    if (client)
      client
        .start()
        .catch(err => {
          window.showErrorMessage(err)
          client = null
        })
        .then(() => {
          if (client) {
            window.showInformationMessage('buzz language client started!')
            resolve()
          }
        })
  })
}

async function stopLSP (): Promise<void> {
  if (client) await client.stop()
  window.showInformationMessage('buzz language client stopped!')
}

export function deactivate (): Thenable<void> {
  return stopLSP()
}

async function followLogFile (
  logPath: string,
  channel: vscode.OutputChannel
): Promise<vscode.Disposable> {
  channel.appendLine(`[buzz] watching ${logPath}`)

  // Touch the file once
  const handle = await promises.open(logPath, 'a')
  await handle.close()

  let position = 0
  let closed = false

  const readChunk = async () => {
    if (closed) return
    try {
      const handle = await promises.open(logPath, 'r')
      const stat = await handle.stat()
      if (stat.size > position) {
        const buffer = Buffer.alloc(stat.size - position)
        await handle.read(buffer, 0, buffer.length, position)
        position = stat.size
        channel.append(buffer.toString('utf8'))
      }
      await handle.close()
    } catch (err: any) {
      channel.appendLine(`[buzz] log read failed: ${err.message}`)
    }
  }

  // Catch the existing content once.
  readChunk()

  const watcher = watch(logPath, { persistent: false }, event => {
    if (event === 'change') readChunk()
    else if (event === 'rename') {
      // File rotated/truncated; reset position and retry after a tick.
      position = 0
      setTimeout(readChunk, 50)
    }
  })

  return new vscode.Disposable(() => watcher.close())
}
