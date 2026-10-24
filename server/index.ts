import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import serve from 'koa-static'
import { createApp } from './app.js'

const app = await createApp()
const dist = fileURLToPath(new URL('../dist', import.meta.url))
if (existsSync(dist)) app.use(serve(dist))

const port = Number(process.env.API_PORT ?? 8787)
const host = process.env.API_HOST ?? '127.0.0.1'
const server = app.listen(port, host, () => {
  console.log(`Koa API: http://${host}:${port} | plaintext: ${process.env.ALLOW_PLAINTEXT !== 'false'}`)
  console.log('开发时从 Vite 页面访问同源 /api。生产部署请在 TLS 反向代理后运行。')
})
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close(() => process.exit(0)))
