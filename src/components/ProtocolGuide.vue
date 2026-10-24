<script setup lang="ts">
import LabIcon from './LabIcon.vue'
const chapters = [
  { no: '01', title: '公钥从哪里来？', tag: 'JWKS', text: '浏览器先向 /api/crypto/jwks 获取 RSA 公钥。公钥可以公开，私钥只保存在 Koa 服务端内存中。key ID 用于选择对应的私钥；重启服务会更换这组演示密钥。' },
  { no: '02', title: '大数据交给 AES，小密钥交给 RSA', tag: 'RSA-OAEP-256 + A256GCM', text: 'jose 生成随机内容加密密钥（CEK），用 AES-256-GCM 加密整个请求封装。再用 RSA 公钥加密 CEK。GCM 同时校验完整性：密文被修改时，解密会失败。' },
  { no: '03', title: '响应有自己的一次性密钥', tag: 'REPLY KEY', text: '浏览器另生成 32 字节 reply key，放在请求密文内部。服务端解密后用它加密响应；浏览器用保留的同一把 reply key 解开。它与 jose 生成的请求 CEK 是不同密钥，每次请求重新生成。' },
  { no: '04', title: '把密文绑定到这次请求', tag: 'CONTEXT BINDING', text: '封装包含 request ID、时间戳、方法、路径和 Authorization 请求头的 SHA-256 摘要。服务端校验上下文、时间窗口与重复 ID；客户端也核对响应请求 ID、方法、路径和状态码。' },
  { no: '05', title: 'GET 与 HEAD 怎么处理？', tag: 'HTTP SEMANTICS', text: 'GET / HEAD 不发送请求 body，所以把请求封装放进 X-Crypto-Context 头。原始 query 放在封装内部，外部 URL 移除查询串。HEAD 仍没有响应 body，响应密文由 X-Crypto-Response 头承载。' },
  { no: '06', title: '解开以后，页面照常使用数据', tag: 'AXIOS → VUE', text: '统一请求封装先准备密文，再交给 Axios 传输；响应返回后验证并解密。封装恢复 JSON、文本或二进制，拆出业务 data。Vue 将结果写入响应式 ref，模板自动更新。组件只调用 http.request()。' },
]
</script>

<template>
  <section class="protocol-guide" aria-label="协议说明">
    <div class="guide-intro"><span class="eyebrow">UNDER THE HOOD</span><h2>密文不是黑盒。<br /><span>把每一步，展开来看。</span></h2><p>这是一套可运行的应用层加密教学协议。请求加密、身份绑定、服务端解密、业务处理、响应加密和页面渲染，都在这个工程里。</p></div>
    <div class="guide-chapters"><article v-for="chapter in chapters" :key="chapter.no"><span class="chapter-number">{{ chapter.no }}</span><div><span class="eyebrow">{{ chapter.tag }}</span><h3>{{ chapter.title }}</h3><p>{{ chapter.text }}</p></div></article></div>
    <div class="boundary-grid"><article class="boundary-card"><LabIcon name="lock" :size="24" /><h3>HTTPS 仍然需要</h3><p>加密 body 并不会隐藏 HTTP 方法、路径、流量大小或 Authorization 请求头。TLS 提供服务端身份验证和通道保护，生产部署必须使用 HTTPS。本地开发也启用 HTTPS，首次访问需要信任本地开发证书。</p></article><article class="boundary-card"><LabIcon name="info" :size="24" /><h3>理解这个演示的边界</h3><p>Bearer token 的摘要不能代替 token 认证。文件先进行有大小限制的缓冲再加密，不是流式加密。演示 token 和内存防重放记录适合学习；生产需要正式认证、共享防重放存储和持久密钥管理。</p></article></div>
    <div class="code-recipe"><div><span class="eyebrow">THE COMPONENT API</span><h3>页面只需要这几行</h3><p>全局默认加密，也支持单次请求覆盖。</p></div><pre><code>const result = await http.post('/api/echo', {
  message: 'Hello, encrypted world!'
}, { encrypted: true })

// 已经完成解密、校验和业务数据解包
profile.value = result.data</code></pre></div>
  </section>
</template>
