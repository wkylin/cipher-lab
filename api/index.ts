import type { IncomingMessage, ServerResponse } from 'node:http'
import { createApp } from '../server/app.js'

const callbackPromise = createApp().then(app => app.callback())

function restoreApiPath(req: IncomingMessage) {
  const rawUrl = req.url ?? '/'
  const parsed = new URL(rawUrl, 'http://vercel.internal')
  const path = parsed.searchParams.get('__cipher_path')
  if (path === null) return
  parsed.searchParams.delete('__cipher_path')
  parsed.searchParams.delete('route')
  const query = parsed.searchParams.toString()
  req.url = `/api/${path}${query ? `?${query}` : ''}`
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  restoreApiPath(req)
  const callback = await callbackPromise
  return callback(req, res)
}
