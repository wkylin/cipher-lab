<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { http, HttpError, type HttpResult, type RequestOptions, type RequestTrace } from './lib/http'
import RequestBuilder from './components/RequestBuilder.vue'
import TraceInspector from './components/TraceInspector.vue'
import FlowPipeline from './components/FlowPipeline.vue'
import ProtocolGuide from './components/ProtocolGuide.vue'
import SequenceDiagram from './components/SequenceDiagram.vue'
import LabIcon from './components/LabIcon.vue'
import { readable } from './components/format'
import { useMediaQuery } from './composables/useMediaQuery'

const encrypted = ref(import.meta.env.VITE_API_ENCRYPTED !== 'false')
type Page = 'lab' | 'sequence' | 'guide'
const readPage = (): Page => window.location.hash === '#sequence' ? 'sequence' : window.location.hash === '#guide' ? 'guide' : 'lab'
const tab = ref<Page>(readPage())
function syncPage() { tab.value = readPage() }
watch(tab, (page) => window.history.replaceState(null, '', `#${page}`))
const busy = ref(false)
const trace = shallowRef<RequestTrace>()
const result = shallowRef<HttpResult<unknown>>()
const error = ref('')
const errorCode = ref('')
const history = shallowRef<Array<{ trace: RequestTrace; result?: HttpResult<unknown>; error: string; errorCode: string }>>([])
const requestBuilder = ref<InstanceType<typeof RequestBuilder>>()
const desktop = useMediaQuery('(min-width: 1024px)')
const workspaceView = ref<'request' | 'response'>('request')
const workspace = useTemplateRef<HTMLElement>('workspace')
const responseButton = useTemplateRef<HTMLButtonElement>('responseButton')
let controller: AbortController | undefined
let initialRequest = false

async function showWorkspace(view: 'request' | 'response', focusResponse = false) {
  if (desktop.value) return
  workspaceView.value = view
  await nextTick()
  if (desktop.value || tab.value !== 'lab') return
  if (focusResponse) responseButton.value?.focus({ preventScroll: true })
  workspace.value?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}
function revealResponse() { return showWorkspace('response', true) }

const profile = computed(() => {
  const data = result.value?.data
  return data && typeof data === 'object' && 'name' in data ? data as Record<string, unknown> : undefined
})
const resultIsBlob = computed(() => result.value?.data instanceof Blob)
const responseSize = computed(() => {
  const data = result.value?.data
  if (data instanceof Blob) return `${data.size.toLocaleString()} bytes`
  if (data === undefined) return '—'
  return `${new TextEncoder().encode(readable(data)).length.toLocaleString()} bytes`
})
const initial = computed(() => String(profile.value?.name || 'CL').split(' ').map((word) => word[0]).slice(0, 2).join(''))

function toggleEncryption() {
  encrypted.value = !encrypted.value
  http.setEncrypted(encrypted.value)
}

async function send(config: RequestOptions, token: string) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  errorCode.value = ''
  result.value = undefined
  trace.value = undefined
  if (!initialRequest) void revealResponse()
  controller = new AbortController()
  http.setToken(token)
  try {
    result.value = await http.request({
      ...config,
      signal: controller.signal,
      onTrace(value) { trace.value = { ...value, steps: [...value.steps] } },
    })
    trace.value = { ...result.value.trace, steps: [...result.value.trace.steps] }
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '请求失败，请检查服务端是否已启动。'
    if (reason instanceof HttpError) {
      errorCode.value = reason.code
      if (reason.trace) trace.value = { ...reason.trace, steps: [...reason.trace.steps] }
    }
  } finally {
    busy.value = false
    if (trace.value) history.value = [{ trace: trace.value, result: result.value, error: error.value, errorCode: errorCode.value }, ...history.value].slice(0, 8)
  }
}

function showHistory(item: (typeof history.value)[number]) {
  if (busy.value) return
  trace.value = item.trace
  result.value = item.result
  error.value = item.error
  errorCode.value = item.errorCode
  void revealResponse()
}

function download() {
  const data = result.value?.data
  if (!(data instanceof Blob)) return
  const objectUrl = URL.createObjectURL(data)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  const disposition = result.value?.headers['content-disposition'] || ''
  const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1]
  anchor.download = filename || 'cipher-lab.csv'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

onMounted(() => {
  window.addEventListener('hashchange', syncPage)
  initialRequest = true
  requestBuilder.value?.submit()
  initialRequest = false
})
onUnmounted(() => {
  window.removeEventListener('hashchange', syncPage)
  controller?.abort()
})
</script>

<template>
  <div class="app-shell">
    <header class="site-header">
      <a href="#" class="brand" aria-label="Cipher Lab 首页" @click.prevent="tab = 'lab'"><span class="brand-symbol"><span /><span /><span /></span><span>Cipher<span class="brand-light">Lab</span><small>密文实验室</small></span></a>
      <nav class="main-nav" aria-label="主导航"><button :class="{ active: tab === 'lab' }" :aria-current="tab === 'lab' ? 'page' : undefined" @click="tab = 'lab'">交互实验</button><button :class="{ active: tab === 'sequence' }" :aria-current="tab === 'sequence' ? 'page' : undefined" @click="tab = 'sequence'">流程时序图</button><button :class="{ active: tab === 'guide' }" :aria-current="tab === 'guide' ? 'page' : undefined" @click="tab = 'guide'">协议说明 <span>↗</span></button></nav>
      <span class="local-badge"><i class="status-dot" :class="{ idle: !result, error: !!error }" />{{ result ? 'API CONNECTED' : busy ? 'CONNECTING' : 'LOCAL DEMO' }}</span>
    </header>

    <main>
      <section class="hero"><div><span class="eyebrow hero-eyebrow"><span class="tiny-line" /> AN APPLICATION-LAYER ENCRYPTION LAB</span><h1>让每一次请求，<br class="mobile-break" /><span>有迹可循。</span></h1><p>从一段 JSON 到一段密文，再回到真实页面。<br class="mobile-break" />亲手发送，逐层看懂。</p><div class="stack-tags"><span>Vue 3</span><i>+</i><span>Axios</span><i>+</i><span>Koa</span><span class="stack-jwe">JWE / JOSE</span></div></div><div class="mode-control"><span class="eyebrow">{{ tab === 'sequence' ? 'DIAGRAM MODE' : 'NEXT REQUEST' }}</span><div class="mode-setting"><LabIcon :name="encrypted ? 'lock' : 'unlock'" :size="22" /><div><strong>{{ encrypted ? '应用层加密已开启' : '普通明文模式' }}</strong><span>{{ encrypted ? 'RSA-OAEP-256 · A256GCM' : '对比加密前后的传输数据' }}</span></div><button type="button" role="switch" :aria-checked="encrypted" aria-label="启用应用层加密" class="mode-switch" :class="{ on: encrypted }" :disabled="busy" @click="toggleEncryption"><span /></button></div><p>{{ tab === 'sequence' ? '切换模式，即时对照下方时序图' : '切换模式后，发送请求观察差异' }} <span>↙</span></p></div></section>

      <template v-if="tab === 'lab'">
        <FlowPipeline :trace="trace" :busy="busy" :encrypted="trace?.encrypted ?? encrypted" />
        <button class="sequence-entry" @click="tab = 'sequence'"><LabIcon name="wire" :size="15" /><span>展开完整流程时序图</span><span class="sequence-entry-hint">Vue → Axios → Koa → Vue</span><LabIcon name="arrow" :size="16" /></button>
        <div ref="workspace" class="workspace">
          <div v-if="!desktop" class="workspace-navigation">
            <div class="workspace-switcher" role="group" aria-label="实验工作区">
              <button type="button" :aria-pressed="workspaceView === 'request'" aria-controls="request-area" @click="showWorkspace('request')"><LabIcon name="code" :size="17" />配置请求</button>
              <button ref="responseButton" type="button" :aria-pressed="workspaceView === 'response'" aria-controls="response-area" @click="showWorkspace('response')"><LabIcon name="window" :size="17" />查看结果<span v-if="busy || error || result" class="workspace-indicator" :class="{ error: !!error }" :aria-label="busy ? '处理中' : error ? '请求失败' : '结果已就绪'" /></button>
            </div>
            <div v-if="busy" class="workspace-pending"><span role="status">请求处理中，可查看实时数据</span><button type="button" @click="controller?.abort()">取消请求</button></div>
          </div>
          <div class="workspace-grid">
          <div v-show="desktop || workspaceView === 'request'" id="request-area" class="left-column"><RequestBuilder ref="requestBuilder" :encrypted="encrypted" :busy="busy" @send="send" @cancel="controller?.abort()" /><section v-if="history.length" class="history-panel" aria-label="最近请求"><h2><LabIcon name="clock" :size="15" />最近请求 <span>{{ history.length }}/8</span></h2><button v-for="(item, index) in history" :key="item.trace.id + index" :class="{ selected: trace?.id === item.trace.id }" :disabled="busy" @click="showHistory(item)"><span class="history-method">{{ item.trace.method }}</span><span class="history-path">{{ item.trace.path }}</span><LabIcon :name="item.trace.encrypted ? 'lock' : 'unlock'" :size="12" /><span class="history-status" :class="{ failed: item.error }">{{ item.error ? 'ERR' : item.result?.status }}</span></button></section></div>
          <div v-show="desktop || workspaceView === 'response'" id="response-area" class="right-column">
            <section class="panel render-panel" aria-labelledby="render-title" aria-live="polite">
              <div class="panel-heading"><div><span class="eyebrow">BACK TO THE APPLICATION</span><h2 id="render-title">数据回到页面</h2></div><span v-if="result" class="success-pill"><LabIcon name="check" :size="14" />{{ result.status }} {{ trace?.method === 'HEAD' ? 'HEAD' : 'SUCCESS' }}</span></div>
              <div v-if="error" class="result-error" role="alert"><LabIcon name="info" :size="23" /><div><strong>{{ errorCode || 'REQUEST FAILED' }}</strong><p>{{ error }}</p><span>{{ errorCode === 'TIMEOUT' ? '可以增加超时时间后重试，或观察已捕获的执行记录。' : errorCode === 'CANCELLED' ? '请求已主动停止，可以重新发送。' : '查看网络响应与执行记录，定位错误发生的阶段。' }}</span></div></div>
              <div v-else-if="profile" class="profile-preview"><div class="profile-avatar">{{ initial }}</div><div class="profile-information"><span class="field-label">解密后的用户资料</span><h3>{{ profile.name }}</h3><p>{{ profile.role || 'Cipher Lab Explorer' }}</p><small v-if="profile.note">{{ profile.note }}</small></div><span class="profile-verified"><LabIcon name="check" :size="15" />{{ trace?.encrypted ? '已验证并解密' : '明文已解析' }}</span></div>
              <div v-else-if="resultIsBlob" class="download-preview"><LabIcon name="download" :size="32" /><div><h3>文件已恢复</h3><p>{{ responseSize }} · {{ trace?.encrypted ? '内容已解密为 Blob' : '内容已解析为 Blob' }}</p></div><button class="secondary-button" @click="download">保存到本地 <LabIcon name="download" :size="15" /></button></div>
              <div v-else-if="result && (trace?.method === 'HEAD' || trace?.method === 'OPTIONS')" class="method-preview"><LabIcon name="check" :size="24" /><div><h3>{{ trace.method }} 请求已完成</h3><p>{{ trace.method === 'HEAD' ? '遵守 HTTP 语义：没有响应 body。完整响应信息可在检查器中查看。' : '服务端返回了此资源允许的方法与协议信息。' }}</p><pre>{{ readable(result.data) }}</pre></div></div>
              <pre v-else-if="result" class="business-preview">{{ readable(result.data) }}</pre>
              <div v-else class="render-placeholder"><LabIcon name="window" :size="28" /><p>{{ busy ? '等待响应，校验完成后将自动渲染。' : '发送一个请求，查看它如何变成页面数据。' }}</p></div>
              <div class="render-footer"><span><i class="status-dot" :class="{ idle: !result, error: !!error }" />{{ result ? 'Vue 响应式渲染' : '等待响应数据' }}</span><span class="mono">{{ trace?.durationMs !== undefined ? trace.durationMs.toFixed(0) + ' ms' : '— ms' }}<span class="footer-divider">/</span>{{ responseSize }}</span></div>
            </section>
            <TraceInspector :trace="trace" :busy="busy" />
          </div>
          </div>
        </div>
        <button class="learn-banner" @click="tab = 'guide'"><span class="learn-icon"><LabIcon name="book" :size="25" /></span><div><strong>为什么需要两把不同的 AES 密钥？</strong><p>理解公钥、内容密钥、reply key 与身份绑定之间的关系。</p></div><span class="learn-link">展开协议说明 <LabIcon name="arrow" :size="18" /></span></button>
      </template>
      <SequenceDiagram v-else-if="tab === 'sequence'" :encrypted="encrypted" />
      <ProtocolGuide v-else />
    </main>
    <footer class="site-footer"><span><span class="footer-mark">⌘</span> CIPHER LAB <span class="footer-divider">/</span> 看见数据，理解加密。</span><span>LOCAL-FIRST DEMO <span class="footer-divider">·</span> HTTPS REQUIRED IN PRODUCTION</span></footer>
  </div>
</template>
