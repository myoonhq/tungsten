import { npmEnvironment } from '../npm-environment.mjs'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const pkg = resolve(import.meta.dirname, '../..')
const root = pkg
const consumer = resolve(root, '.artifacts/tungsten-browser-consumer')
const require = createRequire(import.meta.url)
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: npmEnvironment() })
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`)
  return result.stdout
}
// The browser fixture must resolve only the packed artifact's public exports.
// React is linked from the installed runtime; no workspace library source is aliased.
rmSync(consumer, { recursive: true, force: true })
mkdirSync(consumer, { recursive: true })
const packed = JSON.parse(
  run(
    'npm',
    [
      'pack',
      '--cache',
      resolve(root, '.cache/npm'),
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      consumer,
    ],
    pkg,
  ),
)[0]
const installed = resolve(consumer, 'node_modules/@myoon/tungsten')
mkdirSync(installed, { recursive: true })
run(
  'tar',
  ['-xzf', resolve(consumer, packed.filename), '-C', installed, '--strip-components=1'],
  pkg,
)
for (const name of [
  'react',
  'react-dom',
  'bootstrap',
  '@mui/material',
  '@emotion/react',
  '@emotion/styled',
]) {
  mkdirSync(dirname(resolve(consumer, `node_modules/${name}`)), { recursive: true })
  symlinkSync(
    dirname(require.resolve(`${name}/package.json`)),
    resolve(consumer, `node_modules/${name}`),
    'dir',
  )
}
cpSync(resolve(import.meta.dirname, 'app'), consumer, { recursive: true })
writeFileSync(resolve(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
writeFileSync(
  resolve(consumer, 'artifact.json'),
  JSON.stringify(
    {
      version: JSON.parse(readFileSync(resolve(installed, 'package.json'), 'utf8')).version,
      integrity: packed.integrity,
    },
    null,
    2,
  ),
)
console.log(`Prepared isolated browser consumer from ${packed.filename} (${packed.integrity}).`)
