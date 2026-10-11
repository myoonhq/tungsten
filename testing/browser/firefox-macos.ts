import { firefox } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// macOS 27 protects the personal Firefox application-data directory, which
// Playwright's temporary -profile does not replace. Keep this workaround until
// https://github.com/microsoft/playwright/issues/42768 is fixed and verified.
export function firefoxMacOSLaunchOptions(): { executablePath?: string } {
  if (process.platform !== 'darwin') return {}
  const version = execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' })
  if (Number(version.split('.')[0]) < 27) return {}

  const executable = firefox.executablePath()
  // Leave missing-browser reporting to Playwright so unrelated projects and
  // benchmarks do not require Firefox to be installed.
  if (!existsSync(executable)) return {}
  const bundle = resolve(dirname(executable), '../..')
  const originalIni = readFileSync(resolve(bundle, 'Contents/Resources/application.ini'), 'utf8')
  // An upstream build with its own identity no longer needs the local copy.
  if (!/^Name=Firefox$/m.test(originalIni)) return {}
  const fingerprint = createHash('sha256')
    .update(`${executable}\n${statSync(executable).mtimeMs}\n${originalIni}\nidentity-v1`)
    .digest('hex')
    .slice(0, 16)
  const artifacts = fileURLToPath(
    new URL('../../.artifacts/tungsten-firefox-macos/', import.meta.url),
  )
  const destination = resolve(artifacts, fingerprint)
  const wrapper = resolve(destination, 'firefox')
  if (existsSync(wrapper)) return { executablePath: wrapper }

  mkdirSync(artifacts, { recursive: true })
  const staging = mkdtempSync(resolve(artifacts, '.prepare-'))
  try {
    // Keep the whole bundle together: copying only browser/ starts Juggler but
    // crashes content processes. Clone files where supported, otherwise copy.
    cpSync(bundle, resolve(staging, 'Nightly.app'), {
      recursive: true,
      verbatimSymlinks: true,
      mode: constants.COPYFILE_FICLONE,
    })
    const relativeIni = 'Nightly.app/Contents/Resources/browser/application.ini'
    const isolatedIni = originalIni
      .replace(/^Vendor=.*$/m, 'Vendor=TungstenBrowserTests')
      .replace(/^Name=.*$/m, 'Name=PlaywrightFirefox')
      .replace(/^RemotingName=.*$/m, 'RemotingName=tungsten-playwright-firefox')
    writeFileSync(resolve(staging, relativeIni), isolatedIni)
    // -app must precede Playwright's own arguments. Quote paths for the shell;
    // forward all original arguments, including the fresh temporary profile.
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
    writeFileSync(
      resolve(staging, 'firefox'),
      `#!/bin/sh\nexec ${quote(resolve(destination, 'Nightly.app/Contents/MacOS/firefox'))} -app ${quote(resolve(destination, relativeIni))} "$@"\n`,
      { mode: 0o755 },
    )
    try {
      renameSync(staging, destination)
    } catch (error) {
      // Concurrent Playwright configuration loads may have published the same copy.
      if (!existsSync(wrapper)) throw error
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  return { executablePath: wrapper }
}
