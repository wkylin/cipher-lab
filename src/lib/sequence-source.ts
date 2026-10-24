import type { Method } from '../../shared/protocol'

export interface SequenceOptions {
  encrypted: boolean
  method: Method
  includeErrors: boolean
}

const supportedMethods: readonly Method[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

/**
 * 静态代码流程说明，不是服务端遥测或某次请求的真实执行记录。
 * 图中不包含 token、密钥、查询内容或用户输入。仅允许枚举与布尔值选择固定文本，
 * 以便渲染层对 Mermaid SVG 做必要的安全处理后预览。
 */
export function buildSequenceSource(options: SequenceOptions): string {
  // 运行时仍检查枚举，避免 JavaScript 调用者将自由文本插入 Mermaid 源码。
  if (!supportedMethods.includes(options.method)) throw new Error('不支持的 HTTP 方法')
  const method = options.method
  const headerRequest = method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
  const head = method === 'HEAD'
  const sendEncrypted = head
    ? 'HTTP 状态 + X-Crypto-Response 密文<br/>HEAD 无响应 body'
    : 'HTTP 状态 + application/jose<br/>响应 body 为 JWE 密文'
  const finishError = `
    C->>C: finally 清理定时器<br/>覆盖本次 replyKey 字节
    C-->>V: 拒绝 Promise，返回 HttpError
    V->>V: 更新错误状态<br/>停止业务数据渲染`

  const opening = `sequenceDiagram
  autonumber
  box rgb(12, 35, 49) 浏览器
    participant V as Vue 页面
    participant C as Axios SDK
  end
  box rgb(26, 29, 48) Koa 进程
    participant K as JWKS 公钥端点
    participant S as Koa 中间件
    participant B as 业务路由
  end
  Note over V,B: 静态协议流程 · 不含真实 token 或密钥 · 非服务端执行追踪
  Note over C,S: HTTP 方法、路径、Authorization 位于外层<br/>浏览器到 TLS 终止点仍受 HTTPS 保护
  V->>C: ${method} /api/echo<br/>${headerRequest ? '传入 params，无业务 body' : '传入 params 与业务 body'}
  C->>C: 检查同源与 HTTPS，创建超时控制<br/>序列化 PackedBody，快照 Authorization`

  if (!options.encrypted) {
    return `${opening}
  Note over C,K: 明文对照不获取 JWKS，也不创建 replyKey<br/>这里的明文指应用层，连接仍为 HTTPS
  C->>C: 保留 URL 查询参数<br/>${headerRequest ? '保持 HTTP body 为空' : '恢复原生 JSON、文本、表单或文件'}
  C->>S: ${method} /api/echo + 查询参数<br/>Authorization 保留在请求头
  S->>S: 检查 allowPlaintext
  ${options.includeErrors ? `break 服务端已关闭明文模式
    S-->>C: HTTP 426 + 普通 JSON 错误
    C->>C: 解析错误，清理定时器
    C-->>V: 拒绝 Promise，返回 HttpError
    V->>V: 显示需启用应用层加密
  end` : ''}
  S->>S: 解析原生 body 与 URL query<br/>检查格式、大小和方法语义
  S->>B: 传入 method、body、query
  B->>B: 执行 /api/echo<br/>${head ? '生成响应元信息，业务 body 为空' : '生成回显数据，OPTIONS 附带允许的方法'}
  ${options.includeErrors ? `break 业务处理失败
    B-->>S: 错误状态与错误信息
    S-->>C: HTTP 错误状态 + 普通响应<br/>HEAD 仍无响应 body
    C->>C: 解析并转换为 HttpError<br/>清理定时器
    C-->>V: 拒绝 Promise，返回 HttpError
    V->>V: 显示错误状态
  end` : ''}
  B-->>S: ${head ? '200 + 空业务 body + 响应头' : '200 + code/message/data + 响应头'}
  S-->>C: ${head ? 'HTTP 200 + 响应头<br/>HEAD 无响应 body' : 'HTTP 200 + 普通 JSON 响应'}
  C->>C: 按 Content-Type 解析，检查业务错误<br/>${head ? '保留空结果与响应头' : '解包 data，恢复响应头'}
  C->>C: finally 清理超时与取消监听
  C-->>V: 返回 HttpResult
  V->>V: result.value 接收结果<br/>响应式更新页面
  Note over V,B: /api/echo 无需登录鉴权<br/>其他业务路由可独立校验 Authorization`.trim()
  }

  return `${opening}
  alt 公钥缓存有效
    Note over C: 复用本客户端内存中的公钥<br/>缓存最多 300 秒且不超过 expiresAt
  else 未命中或已过期
    C->>K: HTTPS GET /api/crypto/jwks
    K-->>C: RSA 公钥、activeKid、expiresAt
    C->>C: 验证 JWKS，导入并缓存公钥
  end
  C->>C: 生成随机 32 字节 replyKey<br/>计算 SHA-256 完整 Authorization
  C->>C: 封装 id、iat、exp、method、path<br/>query、authHash、replyKey、PackedBody
  C->>C: RSA-OAEP-256 + A256GCM<br/>生成请求 JWE
  Note over C: JOSE 生成请求内容密钥 CEK<br/>CEK 与独立的响应 replyKey 是不同密钥
  C->>C: 清空 URL 查询串<br/>${headerRequest ? 'JWE 写入 X-Crypto-Context' : 'JWE 写入 application/jose body'}
  C->>S: ${method} /api/echo + Authorization<br/>${headerRequest ? '请求密文在头中，无 HTTP body' : '请求 body 为密文，URL 无 query'}
  S->>S: 校验版本、载体、大小与 JWE 头<br/>检查 kid 与算法白名单
  S->>S: RSA 私钥解开 CEK，GCM 验证并解密<br/>校验 envelope 结构与 replyKey
  ${options.includeErrors ? `break 无法取得可信 envelope 或 replyKey
    S-->>C: 明文协议错误<br/>无法安全生成加密响应
    C->>C: 拒绝非协议响应，不降级<br/>清除公钥缓存，不自动重试${finishError}
  end` : ''}
  S->>S: 比对 ID、方法、路径、时效<br/>比对 Authorization 的 SHA-256 摘要
  S->>S: 清理过期 ID，检查并登记防重放缓存<br/>恢复 query 与 body，检查业务大小
  ${options.includeErrors ? `break 绑定、时效、重放或业务格式校验失败
    S->>S: 使用有效 replyKey<br/>加密错误状态和错误内容
    S-->>C: ${sendEncrypted}
    C->>C: 解密并校验响应绑定<br/>任一校验失败都拒绝结果${finishError}
  end` : ''}
  Note over S,B: authHash 只绑定请求上下文，不替代登录鉴权<br/>/api/echo 无需登录，其他路由可独立鉴权
  S->>B: 传入解密后的 method、body、query
  B->>B: 执行 /api/echo<br/>${head ? '生成响应元信息，业务 body 为空' : '生成回显数据，OPTIONS 附带允许的方法'}
  ${options.includeErrors ? `break 业务路由执行失败（其他接口也适用）
    B-->>S: 错误状态与错误信息
    S->>S: 使用 replyKey 加密错误响应<br/>保持原 HTTP 错误状态
    S-->>C: ${sendEncrypted}
    C->>C: 解密、校验响应后读取业务错误${finishError}
  end` : ''}
  B-->>S: ${head ? '200 + 空业务 body + 响应头' : '200 + code/message/data + 响应头'}
  S->>S: 封装 id、iat、method、path、status<br/>以及业务 body 与业务响应头
  S->>S: 独立 replyKey + dir / A256GCM<br/>生成响应 JWE
  S-->>C: ${sendEncrypted}
  C->>C: 检查外层协议标记，取出 JWE<br/>使用 replyKey 验证并解密
  C->>C: 校验 schema、ID、方法、路径<br/>HTTP 状态、时间与响应头
  ${options.includeErrors ? `break 明文替换、密文篡改或响应绑定不匹配
    C->>C: 拒绝结果，不降级、不自动重发<br/>清除公钥缓存，留待下次显式请求${finishError}
  end` : ''}
  C->>C: 恢复 PackedBody，检查业务错误<br/>${head ? '保留空结果与已验证响应头' : '解包 data，恢复已验证响应头'}
  C->>C: finally 清理超时与取消监听<br/>覆盖本次 replyKey 字节
  C-->>V: 返回 HttpResult
  V->>V: result.value 接收结果<br/>响应式更新页面
  Note over C,S: query 与业务 body 位于请求密文内<br/>replyKey 不进入日志、Vue 状态或本地持久化`.trim()
}
