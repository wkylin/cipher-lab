# Vercel 部署文档

本文记录 Cipher Lab 从本地项目部署到 Vercel 的完整流程。项目由 Vue 3 + Vite 前端和 Koa API 组成。Vercel 负责托管 `dist` 静态产物，并把 `/api/*` 请求交给 Node.js Function；`server/index.ts` 的常驻 `app.listen()` 入口只用于本地或传统 Node 主机部署。

## 1. 部署拓扑

部署完成后，请求关系如下：

```text
浏览器
  ├─ /、/assets/*       -> Vercel 静态文件（dist）
  └─ /api/*             -> Vercel Node.js Function -> Koa app.callback()
```

前端默认使用当前页面 origin 访问 `/api`，所以前端和 API 保持同源，不需要额外的 CORS 配置。Vercel 的 rewrite 将原始 API 路径放入内部参数，`api/index.ts` 再还原给 Koa，确保 `/api/crypto/jwks` 这种多层路径也能工作。

## 2. 前置条件

- Node.js `22.12+`、npm 或 pnpm
- 一个可用的 Vercel 账号
- 当前仓库的依赖已经安装
- 项目可以在本地完成 `npm run typecheck` 和 `npm run build`

检查 Node、依赖和工作目录：

```sh
node --version
npm --version
git status --short
```

安装依赖：

```sh
npm install
```

也可以使用 pnpm，但安装后应继续使用 pnpm 管理这个项目：

```sh
pnpm install
```

## 3. Vercel 适配文件

### 3.1 Function 入口

文件：`api/index.ts`

```ts
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
```

这里不能调用 `app.listen()`。Vercel 会调用导出的 Function，并提供 Node 的 request/response 对象；Koa 的 `app.callback()` 正好可以作为这个处理器。

`callbackPromise` 在一个 Function 实例的冷启动阶段初始化 Koa，实例保持温暖时复用同一个应用对象。

### 3.2 Vercel 配置

文件：`vercel.json`

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [
    {
      "source": "/api/:route*",
      "destination": "/api/index?__cipher_path=:route*"
    }
  ]
}
```

这个 rewrite 将：

```text
/api/crypto/jwks
```

转交给：

```text
/api/index?__cipher_path=crypto/jwks
```

Function 入口会移除内部参数并恢复 `req.url`，所以 Koa 仍然看到原始的 `/api/crypto/jwks`。

不要在 `vercel.json` 的 `functions` 中加入：

```json
"runtime": "nodejs22.x"
```

本次使用的 Vercel CLI 会将这个配置解释为无效的旧式 Function runtime，并报错：

```text
Function Runtimes must have a valid version, for example `now-php@1.0.0`.
```

让 Vercel 根据项目的 Node 引擎和当前运行时自动选择即可。

### 3.3 TypeScript 和 Git 忽略规则

`tsconfig.json` 需要包含 API Function：

```json
"include": [
  "src/**/*.ts",
  "src/**/*.vue",
  "server/**/*.ts",
  "shared/**/*.ts",
  "api/**/*.ts",
  "tests/**/*.ts",
  "vite.config.ts"
]
```

`.gitignore` 应忽略 Vercel 本地链接和构建目录：

```gitignore
.vercel
```

`.vercel/project.json` 只保存项目 ID 和团队 ID，不应提交到 Git。

## 4. 本地构建验证

先运行类型检查：

```sh
npm run typecheck
```

再构建生产前端：

```sh
npm run build
```

构建成功后应存在：

```text
dist/index.html
dist/assets/*
```

可选地用 Vercel 本地 Builder 检查 Function 和 rewrite：

```sh
npx --yes vercel@latest build --yes
```

检查生成的路由配置：

```sh
sed -n '1,220p' .vercel/output/config.json
```

应该能看到类似的全路径规则：

```json
{
  "src": "^/api(?:/((?:[^/]+?)(?:/(?:[^/]+?))*))?$",
  "dest": "/api/index?__cipher_path=$1&route=$1",
  "check": true
}
```

集成测试在正常的本地 Node 环境中运行：

```sh
npm test
```

当前开发沙箱不能监听本地端口，可能出现 `listen EPERM`；这是执行环境限制，不代表断言失败。

## 5. 安装和登录 Vercel CLI

不需要把 CLI 安装到项目依赖中，可以直接用 `npx`：

```sh
npx --yes vercel@latest --version
```

登录：

```sh
npx --yes vercel@latest login
```

CLI 会打开浏览器或给出登录链接。登录后确认账号：

```sh
npx --yes vercel@latest whoami
```

如果 `whoami` 返回账号名称，说明可以继续部署。部署过程需要账号；本次部署使用的账号是 `wkylin`。

## 6. 关联或创建项目

进入仓库根目录：

```sh
cd /path/to/cipher-lab
```

首次部署可以直接执行：

```sh
npx --yes vercel@latest --prod --yes
```

`--yes` 会使用当前目录、当前登录账号和默认项目名创建或关联项目。首次运行通常会：

1. 创建 Vercel 项目
2. 写入本地 `.vercel/project.json`
3. 自动将 `.vercel` 加入 `.gitignore`
4. 执行项目的 `buildCommand`
5. 发布 `dist` 和 API Function

也可以用交互方式部署，以便手动选择 scope、项目名和是否关联已有项目：

```sh
npx --yes vercel@latest
```

之后的部署会复用 `.vercel/project.json`：

```sh
npx --yes vercel@latest --prod --yes
```

不要在 Vercel 中配置 `npm start` 作为启动命令。Vercel 负责静态文件和 Function，`npm start` 会启动不适用于 Serverless 的 `server/index.ts`。

## 7. 环境变量

项目当前支持的主要变量：

| 变量 | 建议值 | 说明 |
| --- | --- | --- |
| `VITE_API_ENCRYPTED` | `true` | 前端默认使用应用层加密；会打进浏览器代码 |
| `VITE_DEMO_TOKEN` | `demo-token` | 公开演示 token，不是秘密 |
| `ALLOW_PLAINTEXT` | `false`（生产） | 是否允许 Koa 接受明文业务请求 |
| `PROXY_LOG` | 不需要 | 只用于本地 Vite 代理，Vercel Function 不使用 |

查看当前环境变量：

```sh
npx --yes vercel@latest env ls
```

增加生产环境变量：

```sh
npx --yes vercel@latest env add ALLOW_PLAINTEXT production
```

命令提示输入值时输入：

```text
false
```

修改 `VITE_*` 后必须重新构建和部署，因为它们在 Vite 构建时写入前端 bundle：

```sh
npx --yes vercel@latest --prod --yes
```

不要把 RSA 私钥、真实 token 或数据库密码放进 `VITE_*`。任何 `VITE_*` 变量都可以被浏览器用户读取。

## 8. 生产部署

执行：

```sh
npx --yes vercel@latest --prod --yes
```

成功时 CLI 会输出：

```text
Inspect   https://vercel.com/<scope>/cipher-lab/<deployment-id>
Production https://<deployment>.vercel.app
Aliased   https://<project>.vercel.app
```

本次部署结果：

- 项目：`wkylins-projects/cipher-lab`
- 生产地址：<https://cipher-lab-azure.vercel.app>
- 最新部署检查页：<https://vercel.com/wkylins-projects/cipher-lab/EntykNtRaG9J1Jmshe58DiZhKbud>

部署地址可能在后续项目重命名、域名绑定或重新创建时变化，应以 CLI 最新输出为准。

## 9. 部署验证

### 9.1 静态首页

```sh
curl -fsSI https://cipher-lab-azure.vercel.app/
```

预期至少包含：

```text
HTTP/2 200
content-type: text/html
server: Vercel
```

浏览器打开：

```text
https://cipher-lab-azure.vercel.app
```

### 9.2 Koa 健康检查

```sh
curl -fsS https://cipher-lab-azure.vercel.app/api/health
```

本次默认配置的响应为：

```json
{"ok":true,"allowPlaintext":true}
```

如果已设置 `ALLOW_PLAINTEXT=false`，响应中的 `allowPlaintext` 应为 `false`。

### 9.3 JWKS 公钥接口

```sh
curl -fsS https://cipher-lab-azure.vercel.app/api/crypto/jwks
```

响应应包含：

- `profile: "cipher-lab/1"`
- `activeKid`
- `expiresAt`
- RSA 公钥字段 `kty`、`n`、`e`、`kid`、`use`、`alg`

响应不应出现私钥字段，例如 `d`、`p`、`q`、`dp`、`dq` 或 `qi`。

### 9.4 API 业务接口

明文 GET 检查：

```sh
curl -fsS 'https://cipher-lab-azure.vercel.app/api/echo?search=hello'
```

预期响应中的 `data.query.search` 为 `hello`。

使用应用页面验证加密链路：

1. 打开生产地址。
2. 保持加密模式开启。
3. 选择 `GET /api/echo` 并发送请求。
4. 流程中应出现“加密封装”和“响应解密”。
5. 业务结果应返回 HTTP 200。

本次部署还使用 Vercel CLI 生成了一次真实 JWE 请求：先读取 `/api/crypto/jwks`，再用 RSA-OAEP-256 + A256GCM 加密请求上下文，最后解密 Koa 返回的响应，结果为：

```json
{"status":200,"method":"GET","path":"/api/echo","bodyKind":"json"}
```

### 9.5 匿名访问与可选的部署保护

当前生产地址可匿名访问，不需要 Vercel 账号。用普通 HTTP 客户端验证首页和 API：

```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://cipher-lab-azure.vercel.app/
curl -sS -o /dev/null -w '%{http_code}\n' https://cipher-lab-azure.vercel.app/api/health
```

两项在本次检查中都返回 `200`。`/api/profile` 要求的 `Bearer demo-token` 是应用内的演示接口认证，不是 Vercel 网站登录。

如果将来对某个预览部署启用了 Vercel Deployment Protection，可将下面的占位地址替换为该预览部署地址，使用 CLI 的自动 bypass 验证：

```sh
npx --yes vercel@latest curl --yes 'https://<protected-deployment>.vercel.app/'
npx --yes vercel@latest curl --yes 'https://<protected-deployment>.vercel.app/api/health'
```

需要排查访问策略时，查看项目保护设置：

```sh
npx --yes vercel@latest project protection cipher-lab --json
```

生产别名、预览部署和自定义域名可能采用不同的访问策略；以目标地址的匿名访问结果为准。

### 9.6 部署日志和元数据

查看部署详情：

```sh
npx --yes vercel@latest inspect cipher-lab-azure.vercel.app
```

查看最近 Function 日志：

```sh
npx --yes vercel@latest logs cipher-lab-azure.vercel.app --limit 50
```

## 10. 常见问题

### 10.1 `Function Runtimes must have a valid version`

原因是把 `nodejs22.x` 放进了当前 CLI 不接受的 `functions.runtime` 配置。删除 `functions` 配置，让 Vercel 自动选择 Node runtime：

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [
    {
      "source": "/api/:route*",
      "destination": "/api/index?__cipher_path=:route*"
    }
  ]
}
```

### 10.2 `/api/health` 正常，但 `/api/crypto/jwks` 404

单独使用 `api/[...path].ts` 时，当前 Vercel Builder 会生成只匹配一层路径的规则：

```text
/api/health       -> 匹配
/api/crypto/jwks  -> 404
```

使用本项目的 `api/index.ts` + `vercel.json` rewrite，把所有 API 路径交给同一个 Function。

### 10.3 页面能打开，但请求报“无法取得服务端 JWKS 公钥”

依次检查：

```sh
curl -fsS https://<production-domain>/api/health
curl -fsS https://<production-domain>/api/crypto/jwks
npx --yes vercel@latest inspect <production-domain>
```

如果健康检查正常而 JWKS 失败，优先检查 rewrite 和 Function 路由；如果两者都失败，检查部署是否为最新版本以及 Deployment Protection。

### 10.4 修改代码后线上没有变化

确认部署目标是 production：

```sh
npx --yes vercel@latest --prod --yes
```

然后访问 CLI 输出的最新生产地址，并清理浏览器缓存或进行硬刷新。修改 `VITE_*` 环境变量后也必须重新部署。

### 10.5 `npm start` 在 Vercel 上不工作

这是预期行为。`npm start` 执行的是 `server/index.ts`，它会调用 `app.listen()` 启动常驻 HTTP 服务。Vercel 使用 `api/index.ts` 的导出 Function，不执行这个脚本。

## 11. Serverless 限制和生产注意事项

当前项目是教学演示，部署到 Vercel 后仍有这些限制：

1. `createApp()` 启动时在内存生成 RSA 密钥。不同 Serverless 实例可能生成不同密钥；如果 JWKS 请求和加密业务请求被路由到不同实例，可能出现解密失败。生产环境应从共享密钥存储或环境变量加载稳定的密钥，并设计正式的 `kid` 轮换。
2. profile 状态和防重放 `seen` Map 都在单个 Function 实例内存中。冷启动、扩容或重新部署会重置它们。生产环境应使用数据库或 KV/Redis 等共享存储。
3. `VITE_DEMO_TOKEN` 会进入浏览器 bundle，只能作为公开演示 token，不能当作真实认证凭证。
4. `ALLOW_PLAINTEXT` 默认值为 `true`。生产部署应根据业务要求设置为 `false`，并重新部署。
5. `/api/delay` 最长可等待 15 秒，但具体可用时长受 Vercel 计划的 Function duration 限制。
6. 目前 Vercel 入口只负责 API；静态资源由 Vercel 的 `dist` 输出负责，不需要在 Function 中使用 `koa-static`。

## 12. 发布检查清单

- [ ] `node --version` 满足 `22.12+`
- [ ] `npm install` 或 `pnpm install` 完成
- [ ] `npm run typecheck` 通过
- [ ] `npm run build` 通过
- [ ] `npx --yes vercel@latest whoami` 返回正确账号
- [ ] `api/index.ts` 和 `vercel.json` 已存在
- [ ] `npx --yes vercel@latest build --yes` 能生成 `.vercel/output`
- [ ] `npx --yes vercel@latest --prod --yes` 返回 `READY`
- [ ] 首页返回 HTTP 200
- [ ] `/api/health` 返回 JSON
- [ ] `/api/crypto/jwks` 返回有效公钥
- [ ] 页面实际发送一次加密请求并完成响应解密
- [ ] 已确认 `ALLOW_PLAINTEXT` 是否符合部署目标
- [ ] 已确认 Vercel Deployment Protection 和 custom domain 的访问策略
