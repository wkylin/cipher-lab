# cipher-lab/1 协议说明

本工程是对业务系统应用层加密链路的独立简化实现，协议名为 `cipher-lab/1`，不承诺与原业务项目的协议互通。

## 密钥分别做什么

| 名称 | 创建者 / 生命周期 | 用途 |
| --- | --- | --- |
| RSA 公私钥 | Koa 启动时创建，此进程有效 | 公钥通过 JWKS 提供；私钥仅在服务端。保护请求 JWE 的内容密钥 |
| 请求内容密钥 CEK | `jose` 每次加密自动生成 | AES-256-GCM 加密本次请求；RSA-OAEP-256 包装该密钥 |
| `replyKey` | 浏览器每次请求随机生成，32 字节 | 随请求密文安全交给服务端，双方用它处理本次响应 |
| GCM IV / tag | `jose` 每次加密生成 | IV 确保同一密钥下的加密唯一性，tag 用于验证完整性 |

`replyKey` 与请求 CEK 不是同一把密钥。所有密钥都不应进入 UI trace。浏览器代码在请求完成后释放请求上下文引用；JavaScript 垃圾回收和密码库内部复制意味着不能声称对内存完成了可证明的安全擦除。

## 请求 envelope

以下对象是加密前的结构，线上实际发送的是 Compact JWE：

```json
{
  "v": 1,
  "id": "<随机 request ID>",
  "iat": 1800000000,
  "exp": 1800000120,
  "method": "POST",
  "path": "/api/profile",
  "query": "section=basic",
  "authHash": "<SHA-256(完整 Authorization 头)，base64url>",
  "replyKey": "<32 字节随机值，base64url>",
  "body": { "kind": "json", "value": { "name": "Cipher Explorer" } }
}
```

时间单位是 Unix 秒，请求 TTL 是 120 秒，允许有限的时钟误差。`id`、method、path 必须与传输上下文相符；同一请求 ID 只能被使用一次。修改 Authorization 会导致摘要不一致。摘要用于绑定上下文，不代替真正的 token 校验。

JWE protected header 包含 `alg: RSA-OAEP-256`、`enc: A256GCM`、`typ: cipher-lab-request+jwe`、`kid`。这些 header 本身不加密，但受完整性保护。Compact JWE 有五段，以点分隔：

```text
protected_header.encrypted_content_key.iv.ciphertext.authentication_tag
```

这是加密格式，不是签名 JWT。JWT、JWS、JWE 的用途不能混淆。服务端通过 JWE 成功解密确认内容未被改变，再用认证和权限逻辑决定是否允许请求。

## HTTP 上承载什么

| 项目 | 明文模式 | 加密模式 |
| --- | --- | --- |
| HTTP method/path | 正常发送 | 保留，且在密文内绑定 |
| Authorization | Bearer token | 保留；完整头值摘要写入密文 |
| query | URL search | 从 URL 移除，存入 envelope.query |
| POST/PUT/PATCH/DELETE body | 标准 HTTP body | Compact JWE，`Content-Type: application/jose` |
| GET/HEAD/OPTIONS 上下文 | query / 请求头 | `X-Crypto-Context: <Compact JWE>`，无 body |
| 协议标志 | 无 | `X-Crypto-Version: 1`、`X-Request-ID` |
| 响应 body | JSON/文本/二进制 | Compact JWE，HTTP status 保留 |
| HEAD 响应 | 无 body | 无 body，`X-Crypto-Response` 保存密文上下文 |

浏览器和网关仍能观察路径、方法、状态、时间、包大小以及未封入密文的 HTTP 头。加密不会隐藏这些元数据。请求头承载的密文必须遵守浏览器和反向代理头大小限制，不能任意扩大查询长度。

## 数据装箱

AES 加密处理的是字节。为了把多种 HTTP 数据恢复为原本可用的形式，本工程先转换成 `PackedBody`：

| kind | 内容 | 恢复方式 |
| --- | --- | --- |
| `empty` | 没有业务 body | `undefined` |
| `json` | JSON value | 直接使用并执行业务校验 |
| `text` | string + Content-Type | 普通文本或 URL encoded 表单 |
| `binary` | 无填充 Base64URL + Content-Type，可含文件名 | 解码字节后按 responseType 返回 ArrayBuffer/Blob |
| `form` | 有序 entries；字符串或文件信息 | 重复字段保留，文件恢复成字节并带文件名和 MIME |

Base64URL 只解决 JSON 无法直接承载任意字节的问题，本身不提供保密性。完整 PackedBody 之后还会进入 JWE。该方案对文件有缓冲和编码空间开销，所以设置 1 MiB 业务内容上限，避免暗示其适合大文件流式传输。URL encoded 表单在服务端统一恢复为字段列表，明文和加密模式保持同一业务语义。

## 响应与错误

响应 envelope 包含 `v`、`id`、`iat`、`method`、`path`、`status`、`body`、`headers`。服务端用 `dir` + `A256GCM` 和 `replyKey` 生成 Compact JWE；`dir` 表示直接使用双方已持有的对称密钥，因此 Compact JWE 第二段为空。

客户端先验证 JWE 和绑定，再解析业务 envelope，最后根据 HTTP status 和业务 code 决定成功或失败。成功 `{code:0,message,data}` 返回 `data`。解密成功的 401、409、422 等仍然是错误；解密成功不意味着业务成功。

如果服务端已经取得可信的响应密钥，业务错误也加密返回。如果请求无法解密，服务端还不知道 `replyKey`，只能返回有限的明文协议错误；客户端会拒绝该响应并保留失败状态，不自动关闭加密重试。

超时和 AbortSignal 取消只终止客户端等待，不能保证服务端没有执行操作。支付等有副作用的操作还需要业务幂等机制；协议防重放与业务幂等是两件不同的事。

## 为什么仍需要 HTTPS

JWKS 的真实性由同源 HTTPS 连接提供。若允许中间人替换公钥，攻击者可以诱导浏览器加密给攻击者。HTTPS 还保护 Bearer token 和普通请求头；本工程不会声称仅靠 body 加密就能安全地公开运行 HTTP 服务。

测试允许显式 `allowInsecureLocalhost: true`，仅限本机回环 HTTP。页面开发默认 HTTPS，同源代理避免跨域配置分散示例重点。跨域部署还需自行配置严格 CORS，并暴露用于加密协议的响应头。
