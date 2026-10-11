import { messageOf } from '../i18n.js'
/// <reference lib="webworker" />

import init, { EngineRuntime } from '../wasm/tungsten_core.js'
import type { EngineCommand, EngineResponse } from './protocol.js'
import { dispatch } from './dispatch.js'

const worker = self as DedicatedWorkerGlobalScope

let runtime: EngineRuntime | null = null
let initialization: Promise<EngineRuntime> | null = null
let commandQueue: Promise<void> = Promise.resolve()

async function engine(): Promise<EngineRuntime> {
  if (runtime) {
    return runtime
  }

  if (!initialization) {
    initialization = init().then(() => {
      runtime = new EngineRuntime()
      return runtime
    })
  }

  return initialization
}

async function handle(command: EngineCommand): Promise<void> {
  worker.postMessage(dispatch(await engine(), command))
}

worker.onmessage = (event: MessageEvent<EngineCommand>) => {
  const command = event.data

  commandQueue = commandQueue
    .then(() => handle(command))
    .catch((error: unknown) => {
      worker.postMessage({
        kind: 'error',
        requestId: command.requestId,
        message: messageOf(error),
      } satisfies EngineResponse)
    })
}
