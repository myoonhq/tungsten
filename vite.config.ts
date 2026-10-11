import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { strictBuildLogger, javascriptSizeBudget } from './testing/build-policy.mjs'

export default defineConfig({
  customLogger: strictBuildLogger(),
  publicDir: false,
  // Installed consumers must resolve worker assets relative to this module.
  base: './',
  build: {
    lib: {
      entry: {
        index: resolve(import.meta.dirname, 'framework/react/src/index.ts'),
        'design/material/index': resolve(import.meta.dirname, 'design/material/src/index.tsx'),
        'design/bootstrap/index': resolve(import.meta.dirname, 'design/bootstrap/src/index.tsx'),
        'design/tungsten/index': resolve(import.meta.dirname, 'design/tungsten/src/index.ts'),
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: {
      external: (id) =>
        ['react', 'react-dom', 'react/jsx-runtime'].includes(id) ||
        id.startsWith('@mui/') ||
        id.startsWith('@emotion/'),
    },
  },
  plugins: [
    react(),
    javascriptSizeBudget(),
    {
      name: 'copy-design-css',
      closeBundle() {
        mkdirSync('dist/design/tungsten', { recursive: true })
        mkdirSync('dist/design/bootstrap', { recursive: true })
        mkdirSync('dist/design/material', { recursive: true })
        writeFileSync(
          'dist/design/material/material.css',
          readFileSync('design/tungsten/src/tungsten.css', 'utf8') +
            '\n' +
            readFileSync('design/material/src/material.css', 'utf8'),
        )
        copyFileSync('design/tungsten/src/tungsten.css', 'dist/design/tungsten/tungsten.css')
        writeFileSync(
          'dist/design/bootstrap/bootstrap.css',
          readFileSync('design/tungsten/src/tungsten.css', 'utf8') +
            '\n' +
            readFileSync('design/bootstrap/src/bootstrap.css', 'utf8'),
        )
      },
    },
  ],
})
