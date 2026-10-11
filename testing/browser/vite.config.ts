import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { strictBuildLogger, javascriptSizeBudget, vendorChunks } from '../build-policy.mjs'

export default defineConfig({
  customLogger: strictBuildLogger(),
  root: resolve(import.meta.dirname, '../../.artifacts/tungsten-browser-consumer'),
  plugins: [react(), javascriptSizeBudget()],
  build: {
    emptyOutDir: true,
    rolldownOptions: { output: { codeSplitting: { groups: vendorChunks } } },
  },
})
