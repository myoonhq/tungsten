import { afterEach, beforeEach, expect } from 'vitest'

// Negative tests may spy on a console method and assert their expected diagnostic.
// All other warnings and errors fail the test instead of disappearing in CI logs.
const original = { warn: console.warn, error: console.error }
let unexpected: { method: string; args: unknown[] }[] = []
beforeEach(() => {
  unexpected = []
  for (const method of ['warn', 'error'] as const) {
    console[method] = (...args: unknown[]) => {
      unexpected.push({ method, args })
    }
  }
})
afterEach(() => {
  try {
    expect(unexpected, 'Unexpected console warnings/errors').toEqual([])
  } finally {
    console.warn = original.warn
    console.error = original.error
  }
})
