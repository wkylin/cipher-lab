# Cipher Lab · HTTP 应用层加密实验室

一个可运行、可阅读的 Vue 3 + Vite + Axios + Koa 工程。页面可以切换明文和加密、选择请求方法与数据类型，并观察同一条请求在业务数据、网络密文、服务端处理和页面渲染之间的变化。源码为 TypeScript，协议结构用 Zod 做运行时校验，JWE 交给 `jose` 实现。

**应用层加密补充 HTTPS，不能替代 HTTPS。** 默认开发入口使用 HTTPS；HTTP 方法、路径、认证头和密文长度仍可见。请求 body 与 query 放入密文，Bearer token 保留在 `Authorization` 头，并将该头完整值的 SHA-256 摘要封入请求用于上下文绑定。

## 运行

要求 Node.js 22.12+、npm 和 OpenSSL。项目目录独立于原业务仓库。

```sh
npm install
npm run dev
```

也支持 pnpm 11+。使用 pnpm 安装依赖时，建议后续继续使用 pnpm 管理此目录：

```sh
pnpm install
pnpm dev
```

项目的 `pnpm-workspace.yaml` 已允许 `esbuild` 和 Code Inspector 所需的 `node-pty` 安装脚本。如果已有安装曾跳过它们，可执行 `pnpm rebuild esbuild node-pty` 后重新安装。无需关闭 `verifyDepsBeforeRun`。SVG 插件 2.0.1 漏声明的 `fast-glob` 依赖也通过 `packageExtensions` 补齐，并显式列入开发依赖以支持 npm。

Web 从 5178 开始监听，被占用时自动尝试 5179、5180 等端口，以终端打印的地址为准。端口自增仅适用于 Vite；Koa 仍监听 `API_PORT`（默认 8787），已有 API 实例时使用 `pnpm dev:web` 单独启动前端，避免重复启动 Koa。

打开 **https://localhost:5178**。Vite 将 `/api` 代理到仅监听回环地址的 Koa `127.0.0.1:8787`。首次运行会生成本地自签证书，浏览器会提示该证书不受信任；脚本不会修改系统信任库。

如果已有 `mkcert`，可自行建立受信任的本地证书：

```sh
mkcert -install
mkdir -p .certs
mkcert -key-file .certs/localhost-key.pem -cert-file .certs/localhost.pem localhost 127.0.0.1 ::1
npm run dev
```

配置可从 `.env.example` 复制到 `.env`：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `VITE_API_ENCRYPTED` | `true` | 浏览器首次打开时的默认模式，页面和每次请求可覆盖 |
| `VITE_DEMO_TOKEN` | `demo-token` | 公开演示 token，仅供演示认证流程 |
| `ALLOW_PLAINTEXT` | `true` | 服务端是否接受明文业务请求；`false` 时拒绝明文，不自动降级 |
| `API_PORT` | `8787` | Koa 端口 |
| `PROXY_LOG` | `true` | Vite dev / preview 的代理请求、响应摘要日志；设为 `false` 关闭，代理错误仍输出 |

`VITE_*` 会被打进浏览器代码，不能保存秘密。

```sh
npm run typecheck
npm test
npm run build
npm start
```

`npm start` 启动 Koa，并提供已构建的 `dist`。部署时必须在它前面放置 HTTPS 反向代理，例如 [Caddy 示例](docs/Caddyfile)。回环 HTTP 是本地代理到应用的内部连接。生产环境应按部署拓扑决定该段是否也需要 TLS。

## 预览构建产物

先运行 `pnpm build`（或 `npm run build`）生成 `dist`。

保持 Koa API 运行：已有 API 实例可以直接复用，否则在一个终端执行：

```sh
pnpm dev:api
```

另一个终端启动 Vite 预览：

```sh
pnpm preview
# npm 用户使用 npm run preview
```

预览入口从 **https://localhost:4178** 开始，端口被占用时自动递增。`prepreview` 会准备本地 HTTPS 证书，`preview.proxy` 将 `/api` 原路径代理到 `http://127.0.0.1:${API_PORT}`，默认 8787，与开发模式共用配置。`preview` 只提供构建产物与代理，需要单独运行 Koa。自定义 `API_PORT` 时请放在两端共用的 `.env` 或启动环境中；仅写入 `.env.production` 不会被当前 Koa 启动脚本读取。

## Vite 代理钩子与开发插件

配置入口为 `vite.config.ts`。`server.proxy` 和 `preview.proxy` 共用 `/api` 代理与以下钩子：

- `proxy.on('proxyReq', ...)`：记录请求发出时间，打印 HTTP 方法、去掉 query 的路径及上游地址。
- `proxy.on('proxyRes', ...)`：打印 HTTP 状态和等待上游响应头的耗时。这个事件发生在响应头到达时，耗时不包含整个响应体的下载。
- `proxy.on('error', ...)`：打印连接错误代码，例如 `ECONNREFUSED`；响应仍交给 Vite 自己处理。

```text
[proxy:req] GET /api/profile -> http://127.0.0.1:8787
[proxy:res] GET /api/profile status=200 headers=12.3ms
```

上述自定义日志不包含 query、Authorization、加密上下文头或 body；钩子不消费请求/响应流，也不改变协议绑定的 method、path 和认证头。可在 `.env` 中设置 `PROXY_LOG=false` 关闭请求/响应摘要。

| 插件 | 生效阶段 | 用法 |
| --- | --- | --- |
| [@vitejs/devtools](https://devtools.vite.dev/guide/) | 开发 | 在当前 Vite 地址后加 `/__devtools/`，或打开页面内的 DevTools 面板 |
| [vite-plugin-inspect](https://github.com/antfu-collective/vite-plugin-inspect) | 开发 | 在 Vite DevTools 中打开 Inspect，查看模块转换和插件执行结果 |
| [code-inspector-plugin](https://github.com/zh-lx/code-inspector) | 开发 | Mac 按住 `Option + Shift`（Windows：`Alt + Shift`）后点击页面元素，定位源文件 |
| [vite-plugin-svg-icons](https://github.com/vbenjs/vite-plugin-svg-icons) | 开发、构建 | 将 `src/assets/icons/**/*.svg` 合并成 SVG sprite，通过 `<use>` 引用 |
| [vite-plugin-compression](https://github.com/vbenjs/vite-plugin-compression) | 构建 | 为超过 10 KiB 的 JS、CSS、HTML、JSON、SVG 生成 `.gz` 与 `.br`，保留原文件 |
| [rollup-plugin-visualizer](https://github.com/btd/rollup-plugin-visualizer) | 构建 | 生成 `artifacts/bundle-report.html`，查看模块原始、gzip 和 Brotli 体积 |

当前使用 Vite 8.3、Inspect 12 和 `@vitejs/devtools` 0.8，Vue 插件保持兼容 Vite 8 的 v6 系列。配置中的 `devtools` 只在开发服务器启用；Inspect 与 Code Inspector 也仅用于开发。重启前端后，通过当前实际端口的 `/__devtools/` 打开工具（例如 `https://localhost:5178/__devtools/`），不再使用旧版 `/__inspect/` 入口。Code Inspector 默认自动识别编辑器，需要指定时可在 `.env.local` 添加 `CODE_EDITOR=code` 或 `CODE_EDITOR=cursor`，然后重启开发服务。

运行 `pnpm build`（或 `npm run build`）会同时产出 `dist`、压缩文件和体积报告。报告不自动打开、不随 `dist` 发布。压缩插件负责生成文件；是否返回预压缩文件及正确的 `Content-Encoding`，由实际托管服务器根据 `Accept-Encoding` 协商决定。它不处理接口加密载荷。

Vite 8 使用 Rolldown 构建，`closeBundle` 钩子按顺序执行。`vite-plugin-compression` 0.5.1 的两个实例会共享文件时间缓存，因此配置为 Brotli 加载带固定 URL query 的独立 ESM 模块实例，隔离缓存，保证 `.gz` 和 `.br` 都能生成。这一兼容处理在构建阶段启用，npm 和 pnpm 使用同一份配置。

### 使用 SVG 图标

入口 `src/main.ts` 已导入 `virtual:svg-icons-register`，类型声明位于 `src/vite-env.d.ts`。符号名称规则为 `icon-[dir]-[name]`：`lock.svg` 对应 `icon-lock`，`arrows/right.svg` 对应 `icon-arrows-right`。

项目包含一个 `src/assets/icons/lock.svg` 示例，可直接在 Vue 模板中使用：

```vue
<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
  <use href="#icon-lock" />
</svg>
```

图标使用 `currentColor` 继承文字颜色。添加图标时保留 `viewBox`，并避免不同目录与文件名组合生成相同的符号名称。

## 移动端优先布局

页面、协议说明和通用控件都从窄屏单列布局开始，使用 `min-width` 断点逐步扩展到平板和桌面。`viewport-fit=cover` 与安全区内边距覆盖刘海、圆角和底部手势区；允许浏览器缩放。

- **实验工作区**：小于 1024px 时使用「配置请求 / 查看结果」分区。两区使用 `v-show` 保持挂载，切换后输入、文件和检查器状态仍保留。主动发送请求或选择历史记录会进入结果区；首次演示请求保持配置区。运行中两个分区都能取消请求。
- **结果优先**：手机先呈现业务结果/错误，再查看密文、执行记录；1024px 起恢复请求与检查器并排布局。最近请求在手机上同样可用。
- **流程概览**：手机默认收起五步详情，保留请求状态、进度和 HTTPS 提示。可展开完整步骤；桌面自动展示。
- **触控与输入**：移动端按钮/选项提供至少 44px 的操作高度；可编辑输入与多行文本默认为 16px。输入框仍只有自身边框，没有外层 focus 光圈。下拉菜单跟随可视视口调整位置，文件列表支持长名称换行。
- **时序图**：手机默认原始比例，图形与源码分别在内部滚动。可用「适应宽度」查看全局、「原始大小」恢复阅读；「扩大画布」增加可视高度，仍保留滚动区域。`svh` / `dvh` 配合普通 `vh` 回退适应移动浏览器地址栏变化。
- **实现位置**：基础布局在 `src/style.css`，工作区切换在 `src/App.vue`，通用断点状态在 `src/composables/useMediaQuery.ts`；组件内部维护自己的移动端样式。

## 步骤组件

`src/components/LabSteps.vue` 将流程展示封装成有序步骤：图标节点、连接轨道与方向箭头随状态变化。`FlowPipeline.vue` 负责将当前请求记录转换为五个步骤，组件本身不依赖 HTTP 或加密协议。

```vue
<script setup lang="ts">
import { ref } from 'vue'
import LabSteps from './components/LabSteps.vue'
import type { LabStepItem } from './components/lab-steps'

const steps = ref<LabStepItem[]>([
  { id: 'prepare', title: '准备数据', caption: 'PREPARE', icon: 'code', status: 'complete' },
  { id: 'send', title: '发送请求', caption: 'SEND', icon: 'wire', status: 'active' },
  { id: 'render', title: '展示结果', caption: 'RENDER', icon: 'window', description: '响应数据 → 页面', status: 'waiting' },
])
</script>

<template>
  <LabSteps :items="steps" label="请求处理进度" direction="auto" tone="cyan" />
</template>
```

| 属性 | 说明 |
| --- | --- |
| `items` | 必填，`LabStepItem[]`；每项有稳定 `id`、`title`，可选 `caption`、`description`、`icon`、`status` |
| `status`（每项） | `waiting`（默认）、`active`、`complete`、`error`；由调用方根据真实执行结果更新 |
| `direction` | `auto`（默认纵向，容器宽度 ≥ 760px 时转为横向）、`horizontal`、`vertical`；强制横向时可横向滚动 |
| `tone` | `cyan`（默认）或 `amber`；本页面分别用于加密和明文模式，错误统一使用红色 |
| `label` | 步骤列表的可访问名称，默认「流程步骤」 |

可用 `#icon`、`#title`、`#description` 插槽自定义内容，各插槽接收 `{ item, index, status }`。没有图标时，节点显示序号。组件是进度展示，不包含点击跳步逻辑；当前步骤使用 `aria-current="step"`，状态有文字提示，装饰箭头对辅助技术隐藏，并尊重减少动画设置。

页面根据 `RequestTrace` 的业务数据、封装记录、网络响应、解密/解析记录与完成状态点亮步骤。成功解密后遇到业务错误时，保留解密完成状态，并在最终步骤提示请求停止。进度来自 SDK 已发出的记录，不表示服务端内部的逐帧追踪。


## 文件选择组件

`src/components/LabFilePicker.vue` 提供与页面一致的文件选择区域、拖放、文件列表、移除和清空操作。组件只管理选中的文件；请求仍在点击「发送请求」后交给 Axios SDK。页面中的 FormData 场景已接入单选/多选与文件格式切换。

单选和多选都使用 `File[]` 作为 `v-model`，初始值为 `[]`：

```vue
<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
import LabFilePicker from './components/LabFilePicker.vue'

const files = ref<File[]>([])
const picker = useTemplateRef<{ validate: () => boolean }>('picker')

function createUploadBody() {
  if (!picker.value?.validate()) return
  const form = new FormData()
  for (const file of files.value) form.append('file', file)
  return form // 将 form 传给项目中的 http.post('/api/upload', form)
}
</script>

<template>
  <LabFilePicker
    ref="picker" v-model="files" label="选择附件"
    description="支持拖放文件，选完后再提交。"
    multiple accept=".pdf,.txt,application/pdf,text/plain"
    :max-files="5" :max-size="512 * 1024" :max-total-size="1023 * 1024"
  />
</template>
```

### Props 与接口

| 属性 | 类型 | 作用 |
| --- | --- | --- |
| `v-model` | `File[]` | 必填；单选时也使用数组 |
| `multiple` | `boolean` | 是否允许多选，默认 `false` |
| `accept` | `string` | 逗号分隔的扩展名、MIME 或 MIME 通配符，例如 `.pdf,image/*`；空值不限制格式 |
| `maxFiles` | `number` | 多选时允许的最大文件数；单选仍最多一个 |
| `maxSize` | `number` | 每个文件的最大字节数 |
| `maxTotalSize` | `number` | 所选文件的合计最大字节数 |
| `disabled` | `boolean` | 禁用选择、拖放和修改操作 |
| `id` / `label` / `description` | `string` | 控件标识、选择文案和补充说明 |

| 事件 | 参数 | 用途 |
| --- | --- | --- |
| `change` | `File[]` | 接收更新后的文件列表 |
| `reject` | `FileRejection[]` | 接收被拒绝的文件及原因 |
| `validity-change` | `boolean` | 显示当前选择是否有效；提交前仍调用 `validate()` |

通过组件 ref 可以调用 `open()` 打开文件对话框、`clear()` 清空选择、`validate(): boolean` 重新校验、`focus()` 聚焦选择按钮。

### 校验与上传约定

- 修改 `accept`、`multiple` 或数量/大小上限时，会重新校验已有文件并显示错误，不会静默删除文件。无效时可以移除文件或调整规则。
- 一次选择部分文件被拒绝时，有效文件可保留；拒绝提示会阻止直接通过校验。切换规则不会清除上一次拒绝记录，可重新选择、移除/清空，或在查看原因后点击「忽略未添加项」，确认继续使用已接受的文件。
- `accept` 根据文件名扩展名和浏览器提供的 MIME 筛选，不读取文件内容证明其真实格式。它是选择组件的规则，不替代服务端内容校验。
- 组件的数量/大小规则与 SDK、服务端的业务限额相互独立。页面示例最多选择 5 个文件，每个最多 512 KiB、合计最多 1023 KiB，以适配项目的 1 MiB 请求业务数据限额；SDK 和服务端仍各自校验请求。
- 页面未限制文件格式且没有选择文件时，保留原有 `hello-cipher.txt` 演示。启用格式限制后必须选择文件；最近选择失败时不会自动改发演示文件。
- 多文件以同名 `file` 字段逐项 `FormData.append()`；现有 SDK 与 Koa 遍历全部字段，明文 multipart 和加密请求均保留各个文件。

## 页面内预览完整时序图

打开 **https://localhost:5178/#sequence**，或点击导航中的「流程时序图」。

- 使用 Mermaid `sequenceDiagram` 展示 Vue → Axios SDK → JWKS / Koa → 业务路由 → 响应解密 → Vue 渲染。
- 与页面加密开关联动，可切换七种 HTTP 方法，观察 body、query、GET / HEAD / OPTIONS 的载体差异。
- 勾选「展开异常分支」，查看协议校验、上下文绑定、重放、业务失败及响应篡改的处理方式。
- 支持图形／源码视图、缩放、适应宽度、展开画布、复制源码与导出独立 SVG。
- 顶部和底部均显示参与者名称（`sequence.mirrorActors: true`），生命线按完整图高延伸到底部。此配置也避开 Mermaid 11.17.2 关闭底部参与者时生命线停在 `y2=2000` 的问题；预览与 SVG 导出共用同一渲染结果。

图展示的是代码中的协议流程，不是服务端实测追踪，也不会发送业务请求。Mermaid 按需从本地依赖加载，不使用 CDN 或远程渲染。定义位于 `src/lib/sequence-source.ts`，渲染封装位于 `src/lib/sequence-renderer.ts`，页面组件为 `src/components/SequenceDiagram.vue`。渲染使用 strict 安全模式，源码只由固定模板和白名单方法生成，不嵌入 token、密钥或用户输入。

## 从一个最简单的接口读懂全流程

页面请求 `GET /api/profile?section=basic`，默认携带 `Authorization: Bearer demo-token`。

1. Axios 封装确定此次请求是否加密，规范化 method、path 和 query，将业务数据打包。
2. 加密模式下，客户端从同源 `/api/crypto/jwks` 获取 RSA 公钥。每次请求都生成新的 request ID 和独立的 32 字节响应密钥 `replyKey`。
3. 客户端将 body、query、时间范围、method、path、认证头摘要和 `replyKey` 放进请求 envelope。`jose` 使用 `RSA-OAEP-256` + `A256GCM` 生成 Compact JWE。
4. GET 没有 HTTP body，因此密文放进 `X-Crypto-Context`，URL 上清除 query；POST 等有 body 的方法把密文放在 body，类型为 `application/jose`。
5. Koa 用 RSA 私钥解密，检查请求 ID、时效、路径、方法、认证头摘要和重放，再恢复业务 query/body。业务处理仍面对普通结构化数据。
6. Koa 用本次请求的 `replyKey`，以 `dir` + `A256GCM` 加密响应。响应 envelope 绑定 request ID、method、path、HTTP status，并封装业务 body 和必要的响应头。
7. Axios 封装中的 `request()` 固定顺序验证并解密，恢复 JSON/文本/二进制，处理 HTTP 和业务错误，将 `{ code: 0, message, data }` 解包为 `data`。拦截器保留通用扩展入口，核心加解密顺序由封装显式控制。
8. Vue 将结果写入响应式状态并渲染。页面组件无需手动调用密码学函数。

明文模式复用同一个客户端、接口和组件，直接发送正常 HTTP 数据。加密请求遇到明文响应、错误绑定或解密失败会拒绝；它不会悄悄重试为明文。

```ts
import { http } from './lib/http'

http.setToken('demo-token')
http.setEncrypted(true)

const result = await http.get<{ name: string }>('/api/profile', {
  params: { section: 'basic' },
})
console.log(result.data) // 业务 data，已完成解密、JSON 解析和统一 envelope 解包

await http.patch('/api/profile', { name: 'Cipher Explorer' }, { encrypted: false })

const upload = new FormData()
upload.append('note', 'hello')
upload.append('file', new File(['Hello Cipher Lab'], 'hello.txt', { type: 'text/plain' }))
await http.post('/api/upload', upload)

const download = await http.get<ArrayBuffer>('/api/download', { responseType: 'arraybuffer' })
// UI 可以将 download.data 包装为 Blob，创建 Object URL 后触发下载并释放 URL。
```

页面的数据消费可以保持简单。以下是可直接迁移到业务组件的最小模式，完整交互见 `src/App.vue`：

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { http, HttpError } from './lib/http'

const name = ref('')
const error = ref('')
const loading = ref(false)
async function loadProfile() {
  loading.value = true
  error.value = ''
  try {
    const result = await http.get<{ name: string }>('/api/profile')
    name.value = result.data.name // 此处已经是普通业务数据
  } catch (cause) {
    error.value = cause instanceof HttpError ? cause.message : '加载失败'
  } finally {
    loading.value = false
  }
}
</script>
<template>
  <button :disabled="loading" @click="loadProfile">加载资料</button>
  <p v-if="error" role="alert">{{ error }}</p>
  <p v-else>{{ name }}</p>
</template>
```

服务端接口可以分别验证正常、文件和错误链路：

| 接口 | 用途 |
| --- | --- |
| `/api/echo` | 七种方法回显恢复后的 query/body；HEAD 只返回元数据 |
| `/api/profile` | GET 读取、POST/PUT 完整写入、PATCH 部分修改、DELETE 重置；需要演示 token |
| `/api/upload` | POST 表单文件或原始二进制，返回文件大小、摘要与预览，不写文件到磁盘 |
| `/api/download` | GET 返回实际 CSV 字节 |
| `/api/error` | GET 返回 HTTP 422 与业务错误码 42201，验证错误响应也解密 |
| `/api/delay?ms=1500` | GET 模拟延迟，用于超时和取消 |
| `/api/crypto/jwks` | GET 获取加密公钥；不走业务加密避免循环依赖 |

完整写入 profile 时需要字符串字段 `name`、`role`、`note`；每个字段最多 500 字符。数据只保存在演示进程内，重启后恢复初始值。

## 支持范围

| 能力 | 实现 |
| --- | --- |
| HTTP 方法 | GET、POST、PUT、PATCH、DELETE、HEAD、OPTIONS；示例客户端通过 `/api/*` 路由清单限制同源接口 |
| 请求数据 | JSON、文本、URLSearchParams、FormData（含文件和重复字段）、Blob、ArrayBuffer、TypedArray |
| 响应数据 | 业务 JSON、文本、Blob、ArrayBuffer |
| 控制 | 全局默认模式、单次请求覆盖、token、超时、AbortSignal 取消、统一错误 |
| 观测 | 解密后的业务数据、真实网络请求/响应、阶段 trace；trace 不包含私钥或 `replyKey` |
| 文件限制 | 内存缓冲，业务内容最多 1 MiB，超限报错 |
| 浏览器限制 | CONNECT、TRACE 不属于可调用的浏览器 Fetch/Axios 方法；未实现流式上传、SSE 或 WebSocket 加密 |

GET / HEAD / OPTIONS 统一将加密上下文放在请求头，不能带业务 body；上下文头有 8 KiB 上限，大查询应改为有 body 的方法。HEAD 按 HTTP 语义不返回 body，加密响应上下文放在 `X-Crypto-Response`。HEAD 的业务数据也不会返回给调用方。

## 源码阅读顺序

| 文件 | 阅读重点 |
| --- | --- |
| `shared/protocol.ts` | 双端共享的协议、限制、运行时 schema |
| `src/lib/body.ts` | HTTP 数据与可加密 envelope 之间的转换 |
| `src/lib/http.ts` | Axios 封装、JWE、认证绑定、响应验证、错误与取消 |
| `server/app.ts` | Koa 解密中间件、路由、加密响应、重放防护 |
| `src/App.vue` | 交互、响应式数据和渲染 |
| `tests/integration.test.ts` | 端到端方法矩阵、数据类型和异常边界 |
| [协议说明](docs/PROTOCOL.md) | 密钥职责、JWE 结构、GET/HEAD 语义、安全边界 |

## 演示边界

这是可运行的教学工程。RSA 私钥在进程启动时生成，重启会变化；重放记录保存在单进程内存，生产集群需要共享且原子化的短期存储。公钥缓存刷新、持久化密钥与轮换、正式登录、权限控制、限流、审计和分布式重放防护，都需要按实际部署补齐。演示 token 不提供真实身份体系。

浏览器本身能解密，因此持有页面执行权限的用户、DevTools、恶意扩展或 XSS 仍可能看到业务明文。这个协议保护应用传输载荷，不能把浏览器变成秘密存储。授权仍由服务端检查；公钥可公开，能生成合法 JWE 不等于有权访问接口。

页面 trace 为教学而展示业务数据，真实系统应关闭或脱敏。不要在截图、日志或监控中记录 token、私钥、响应密钥或敏感明文。

参考：[JWE 标准](https://www.rfc-editor.org/rfc/rfc7516)、[jose](https://github.com/panva/jose)、[Web Crypto](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)、[Axios 拦截器](https://axios-http.com/docs/interceptors)、[Koa](https://koajs.com/)。
