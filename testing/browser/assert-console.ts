import { test as base, expect } from './base-test.js'
import type { ConsoleMessage } from '@playwright/test'

type ConsoleChecks = {
  expectError: (messageKey: string) => void
  allowHttpError: (status: number) => void
  allowNetworkError: (pattern: RegExp) => void
}

/** Negative scenarios declare their diagnostics; every other warning/error fails. */
export const test = base.extend<{ consoleChecks: ConsoleChecks }>({
  consoleChecks: [
    async ({ page }, provide) => {
      const expectedKeys: string[] = []
      const expectedStatuses = new Set<number>()
      const networkErrors: RegExp[] = []
      const errors: string[] = []
      const messages: Promise<{ type: string; key?: string; text: string }>[] = []
      const onError = (error: Error) => errors.push(error.message)
      const onConsole = (message: ConsoleMessage) => {
        if (!['warning', 'error'].includes(message.type())) return
        // Browsers also report failed HTTP responses as console errors. Only the
        // status deliberately configured by the retry scenario is permitted.
        const status = /^Failed to load resource: the server responded with a status of (\d+)/.exec(
          message.text(),
        )
        if (status && expectedStatuses.has(Number(status[1]))) return
        if (networkErrors.some((pattern) => pattern.test(message.text()))) return
        messages.push(
          (async () => {
            const args = await Promise.all(
              message.args().map((arg) => arg.jsonValue().catch(() => undefined)),
            )
            const first = args[0]
            const key =
              typeof first === 'string'
                ? first
                : first && typeof first === 'object' && 'messageKey' in first
                  ? String(first.messageKey)
                  : undefined
            return { type: message.type(), key, text: message.text(), url: message.location().url }
          })(),
        )
      }
      page.on('pageerror', onError)
      page.on('console', onConsole)
      try {
        await provide({
          expectError: (key) => expectedKeys.push(key),
          allowNetworkError: (pattern) => {
            networkErrors.push(pattern)
          },
          allowHttpError: (status) => {
            expectedStatuses.add(status)
          },
        })
      } finally {
        page.off('pageerror', onError)
        page.off('console', onConsole)
        const unexpected = (await Promise.all(messages)).filter((message) => {
          const index =
            message.type === 'error' && message.key ? expectedKeys.indexOf(message.key) : -1
          if (index < 0) return true
          expectedKeys.splice(index, 1)
          return false
        })
        expect(errors, 'Unexpected browser exceptions').toEqual([])
        expect(unexpected, 'Unexpected browser console warnings/errors').toEqual([])
        expect(expectedKeys, 'Expected diagnostics must be emitted exactly once').toEqual([])
      }
    },
    { auto: true },
  ],
})
