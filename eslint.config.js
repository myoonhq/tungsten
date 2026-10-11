import { resolve } from 'node:path'
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    '**/dist/**',
    '**/api/src/wasm/**',
    '**/test-results/**',
    '**/playwright-report/**',
  ]),
  {
    basePath: resolve(import.meta.dirname, '.'),
    files: [
      '**/*.{js,mjs}',
      
      
    ],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 'latest', globals: globals.node },
  },
  {
    basePath: resolve(import.meta.dirname, '.'),
    files: ['**/*.{ts,tsx}', ],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, ...globals.node },
    },
  },
])
