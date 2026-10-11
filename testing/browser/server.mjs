import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'

const dist = resolve(import.meta.dirname, '../../.artifacts/tungsten-browser-consumer/dist')
const sessions = new Map()
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
}
function session(id) {
  if (!sessions.has(id))
    sessions.set(id, {
      requests: [],
      uploads: [],
      submissions: [],
      failures: 0,
      held: false,
      waiters: [],
    })
  return sessions.get(id)
}
async function body(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1_000_000) throw new Error('Fixture body limit exceeded')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
function json(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:4187')
    const match = /^\/(api|control)\/([\w-]+)(?:\/(\w+))?$/.exec(url.pathname)
    if (match) {
      const [, kind, id, endpoint] = match
      const state = session(id)
      if (kind === 'control') {
        if (req.method === 'DELETE') {
          state.waiters.splice(0).forEach((release) => release())
          sessions.delete(id)
        } else if (req.method === 'POST') {
          const input = JSON.parse((await body(req)).toString())
          if (input.failures !== undefined) state.failures = input.failures
          if (input.held !== undefined) state.held = input.held
          if (input.longOptions !== undefined) state.longOptions = input.longOptions
          if (input.optionCount !== undefined) {
            if (
              !Number.isSafeInteger(input.optionCount) ||
              input.optionCount < 1 ||
              input.optionCount > 10000
            )
              return json(res, { error: 'Invalid option count' }, 400)
            state.optionCount = input.optionCount
          }
          if (!state.held) state.waiters.splice(0).forEach((release) => release())
        }
        return json(res, { ...state, waiters: state.waiters.length })
      }
      state.requests.push({ endpoint, country: url.searchParams.get('country') })
      if (endpoint === 'options')
        return json(res, {
          data: Array.from({ length: state.optionCount ?? 10000 }, (_, index) => ({
            value: `option-${index}`,
            label:
              `Option ${index}` +
              (state.longOptions && index % 7 === 0
                ? ' — A deliberately long option label that wraps over several lines on a narrow screen while preserving all of its text and keeping the next option below it.'
                : ''),
          })),
        })
      if (endpoint === 'regions') {
        if (state.failures > 0) {
          state.failures--
          return json(res, { message: 'Fixture outage' }, 503)
        }
        if (state.held)
          await new Promise((release) => {
            const done = () => {
              state.waiters = state.waiters.filter((item) => item !== done)
              release()
            }
            state.waiters.push(done)
            req.on('close', done)
          })
        if (res.destroyed) return
        return json(res, {
          data:
            url.searchParams.get('country') === 'CZ'
              ? [
                  { value: 'PR', label: 'Prague' },
                  { value: 'BR', label: 'Brno' },
                ]
              : [
                  { value: 'BA', label: 'Bratislava' },
                  { value: 'KE', label: 'Košice' },
                ],
        })
      }
      if (endpoint === 'files' && req.method === 'POST') {
        const bytes = await body(req)
        const key = req.headers['idempotency-key']
        state.uploads.push({
          bytes: bytes.length,
          multipart: req.headers['content-type'],
          key,
          body: bytes.toString(),
        })
        return json(res, { id: `stored-${state.uploads.length}` }, 201)
      }
      if (endpoint === 'submit' && req.method === 'POST') {
        state.submissions.push(JSON.parse((await body(req)).toString()))
        return json(res, null, 202)
      }
      return json(res, { error: 'Unknown fixture endpoint' }, 404)
    }
    const path = resolve(
      dist,
      `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`,
    )
    if (!path.startsWith(`${dist}${sep}`)) return json(res, {}, 403)
    if (!(await stat(path)).isFile()) return json(res, {}, 404)
    res.writeHead(200, {
      'content-type': types[extname(path)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    res.end(await readFile(path))
  } catch (error) {
    if (error.code === 'ENOENT') return json(res, {}, 404)
    console.error(error)
    if (!res.headersSent) json(res, { error: 'Fixture server failure' }, 500)
    else res.destroy()
  }
})
server.listen(4187, '127.0.0.1', () =>
  console.log('Tungsten production fixture: http://127.0.0.1:4187'),
)
function stop() {
  for (const state of sessions.values()) state.waiters.splice(0).forEach((release) => release())
  server.closeAllConnections()
  server.close(() => process.exit(0))
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
