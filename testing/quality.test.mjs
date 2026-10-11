import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { build } from 'vite'
import { javascriptSizeBudget, strictBuildLogger } from './build-policy.mjs'
import { npmEnvironment } from './npm-environment.mjs'

const pkg = resolve(import.meta.dirname, '..')
const artifacts = resolve(pkg, '.artifacts')
mkdirSync(artifacts, { recursive: true })

test('npm retains real settings and credentials without pnpm-only options', () => {
  const env = npmEnvironment({
    PATH: 'runtime',
    NODE_AUTH_TOKEN: 'test-token',
    npm_config_registry: 'https://example.test',
    npm_config_cache: '/tmp/cache',
    npm_config_user_agent: 'pnpm',
    npm_config_recursive: 'true',
    npm_config_verify_deps_before_run: 'true',
    npm_config__myoonhq_registry: 'https://example.test',
    'npm_config_@myoonhq:registry': 'https://example.test',
  })
  assert.deepEqual(env, {
    PATH: 'runtime',
    NODE_AUTH_TOKEN: 'test-token',
    npm_config_registry: 'https://example.test',
    npm_config_cache: '/tmp/cache',
    npm_config_user_agent: 'pnpm',
  })
})

test('a build warning causes failure rather than a successful noisy build', async () => {
  const logger = strictBuildLogger()
  logger.info = logger.error = () => {}
  await assert.rejects(
    build({
      configFile: false,
      logLevel: 'silent',
      customLogger: logger,
      plugins: [
        {
          name: 'deliberate-warning',
          buildStart() {
            this.warn('qualification warning')
          },
        },
      ],
      build: {
        write: false,
        rolldownOptions: {
          input: resolve(pkg, 'framework/react/src/theme.tsx'),
          external: ['react', 'react/jsx-runtime'],
        },
      },
    }),
    /qualification warning/,
  )
})

test('oversized JavaScript fails the budget without increasing the warning threshold', async () => {
  const fixture = mkdtempSync(resolve(artifacts, 'size-policy-'))
  try {
    writeFileSync(
      resolve(fixture, 'main.js'),
      `document.body.textContent = ${JSON.stringify('x'.repeat(510_000))}`,
    )
    await assert.rejects(
      build({
        configFile: false,
        logLevel: 'silent',
        plugins: [javascriptSizeBudget()],
        build: {
          write: false,
          minify: false,
          rolldownOptions: { input: resolve(fixture, 'main.js') },
        },
      }),
      /500 kB JavaScript budget/,
    )
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('unexpected unit-test console warnings/errors fail, while asserted diagnostics pass', () => {
  const fixture = mkdtempSync(resolve(artifacts, 'console-policy-'))
  try {
    const vitest = resolve(pkg, 'node_modules/vitest')
    writeFileSync(
      resolve(fixture, 'vite.config.mjs'),
      `export default { test: { environment: 'node', setupFiles: [${JSON.stringify(resolve(pkg, 'testing/assert-console.ts'))}], include: [${JSON.stringify(resolve(fixture, 'console.test.ts'))}] } }`,
    )
    const run = (source) => {
      writeFileSync(
        resolve(fixture, 'console.test.ts'),
        `import { it, vi, expect } from ${JSON.stringify(resolve(vitest, 'dist/index.js'))}; ${source}`,
      )
      return spawnSync(
        process.execPath,
        [resolve(vitest, 'vitest.mjs'), 'run', '--config', resolve(fixture, 'vite.config.mjs')],
        { cwd: pkg, encoding: 'utf8', env: { ...process.env, CI: 'true' } },
      )
    }
    for (const method of ['warn', 'error']) {
      const result = run(
        `it('unexpected', () => { console.${method}('qualification diagnostic') })`,
      )
      assert.equal(result.status, 1, result.stdout + result.stderr)
      assert.match(result.stdout + result.stderr, /Unexpected console warnings\/errors/)
    }
    const expected = run(
      `it('expected', () => { const error = vi.spyOn(console, 'error').mockImplementation(() => {}); console.error('expected diagnostic'); expect(error).toHaveBeenCalledExactlyOnceWith('expected diagnostic'); error.mockRestore() })`,
    )
    assert.equal(expected.status, 0, expected.stdout + expected.stderr)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
