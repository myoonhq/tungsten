import { createLogger } from 'vite'

export function strictBuildLogger() {
  const logger = createLogger()
  logger.warn = logger.warnOnce = (message) => {
    throw new Error(message)
  }
  return logger
}

// Splitting dependencies keeps consumer entry chunks small without changing the budget.
export const vendorChunks = [
  {
    name: 'vendor-react',
    test: /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:react|react-dom|scheduler)\//,
  },
  { name: 'vendor-material', test: /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?@mui\// },
  {
    name: 'vendor-emotion',
    test: /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:@emotion|stylis)\//,
  },
]

export function javascriptSizeBudget() {
  return {
    name: 'javascript-size-budget',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'chunk' && Buffer.byteLength(file.code) > 500_000)
          this.error(`${file.fileName} exceeds the 500 kB JavaScript budget. Split the chunk.`)
      }
    },
  }
}

// Build timing varies with the runner and does not indicate an invalid bundle.
// Keep all code/asset warnings flowing to the strict logger.
export function onBuildLog(level, log, defaultHandler) {
  if (log.code === 'PLUGIN_TIMINGS' || log.code === 'BUNDLER_TIMINGS') return
  defaultHandler(level, log)
}
