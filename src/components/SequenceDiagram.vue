<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { METHODS, type Method } from '../../shared/protocol'
import { buildSequenceSource } from '../lib/sequence-source'
import { renderSequence } from '../lib/sequence-renderer'
import LabIcon from './LabIcon.vue'
import LabSelect from './LabSelect.vue'
import LabCheckbox from './LabCheckbox.vue'

const { encrypted } = defineProps<{ encrypted: boolean }>()
const method = ref<Method>('GET')
const methodDescriptions: Record<Method, string> = {
  GET: '读取资源', POST: '提交数据', PUT: '完整替换', PATCH: '局部更新',
  DELETE: '删除资源', HEAD: '仅取响应头', OPTIONS: '查询支持的方法',
}
const methodOptions = METHODS.map((value) => ({ value, label: value, description: methodDescriptions[value] }))
const includeErrors = ref(false)
const view = ref<'preview' | 'source'>('preview')
const expanded = ref(false)
const svg = ref('')
const loading = ref(true)
const error = ref('')
const feedback = ref('')
const naturalWidth = ref(1200)
const viewportWidth = ref(1100)
const manualScale = ref<number>()
const fitWidth = ref(false)
const viewport = useTemplateRef<HTMLDivElement>('viewport')
const isHeaderRequest = computed(() => ['GET', 'HEAD', 'OPTIONS'].includes(method.value))
const source = computed(() => buildSequenceSource({ encrypted, method: method.value, includeErrors: includeErrors.value }))
const fittedScale = computed(() => Math.min(1.8, Math.max(.05, (viewportWidth.value - 24) / naturalWidth.value)))
// Keep labels readable on phones; the diagram pans inside its own viewport.
// Explicit fit mode remains responsive when the phone rotates or the panel resizes.
const scale = computed(() => fitWidth.value
  ? fittedScale.value
  : manualScale.value ?? (viewportWidth.value < 720 ? 1 : Math.max(.75, Math.min(1, fittedScale.value))))
const percent = computed(() => Math.round(scale.value * 100))
const filename = computed(() => `cipher-lab-${encrypted ? 'encrypted' : 'plain'}-${method.value.toLowerCase()}${includeErrors.value ? '-with-errors' : ''}`)
let revision = 0
let disposed = false
let resizeObserver: ResizeObserver | undefined
let feedbackTimer: ReturnType<typeof setTimeout> | undefined

async function render() {
  const current = ++revision
  const definition = source.value
  loading.value = true
  error.value = ''
  svg.value = ''
  try {
    await nextTick()
    const result = await renderSequence(definition)
    // A fast mode/method change or tab close must not display an older render.
    if (disposed || current !== revision) return
    svg.value = result.svg
    naturalWidth.value = result.width
    viewport.value?.scrollTo({ top: 0, left: 0 })
  } catch (reason) {
    if (disposed || current !== revision) return
    error.value = reason instanceof Error ? reason.message : '时序图加载失败'
  } finally {
    if (!disposed && current === revision) loading.value = false
  }
}

function zoom(delta: number) {
  const nextScale = Math.max(.2, Math.min(1.8, Math.round((scale.value + delta) * 100) / 100))
  fitWidth.value = false
  manualScale.value = nextScale
}
function fit() {
  fitWidth.value = true
  viewport.value?.scrollTo({ left: 0 })
}
function actualSize() {
  fitWidth.value = false
  manualScale.value = 1
}
function announce(message: string) {
  clearTimeout(feedbackTimer)
  feedback.value = message
  feedbackTimer = setTimeout(() => { feedback.value = '' }, 3500)
}
async function copySource() {
  try {
    await navigator.clipboard.writeText(source.value)
    announce('Mermaid 源码已复制')
  } catch {
    view.value = 'source'
    announce('复制失败，请在源码视图中手动选择并复制。')
  }
}
function exportSvg() {
  if (!svg.value || loading.value) return
  const url = URL.createObjectURL(new Blob([svg.value], { type: 'image/svg+xml;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${filename.value}.svg`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // A delayed revoke allows the browser to start reading the download first.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  announce('SVG 导出已触发')
}

watch(source, render)
onMounted(() => {
  if (viewport.value) {
    viewportWidth.value = viewport.value.clientWidth
    resizeObserver = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) viewportWidth.value = entry.contentRect.width
    })
    resizeObserver.observe(viewport.value)
  }
  void render()
})
onUnmounted(() => {
  disposed = true
  revision++
  resizeObserver?.disconnect()
  clearTimeout(feedbackTimer)
})
</script>

<template>
  <section class="sequence-page" aria-labelledby="sequence-title">
    <div class="sequence-heading">
      <div><span class="eyebrow">END-TO-END / SEQUENCE DIAGRAM</span><h2 id="sequence-title">一次请求，如何走完全程。</h2><p>沿着时间向下读，沿着箭头看数据如何流转。切换页面上方的加密开关，对照两种模式。</p></div>
      <span class="sequence-mode" :class="{ plain: !encrypted }"><LabIcon :name="encrypted ? 'lock' : 'unlock'" :size="14" />{{ encrypted ? '加密链路' : '明文链路' }}<span>HTTPS</span></span>
    </div>

    <div class="sequence-controls">
      <div class="sequence-method">
        <label for="sequence-method">示例方法</label>
        <LabSelect id="sequence-method" v-model="method" class="method-select" :options="methodOptions" label="时序图 HTTP 方法" />
        <code>/api/echo</code>
      </div>
      <LabCheckbox v-model="includeErrors" label="展开异常分支" />
      <span class="sequence-static-note">协议流程图 · 不会发送请求</span>
    </div>

    <div class="sequence-facts">
      <div><span>请求载体</span><strong>{{ encrypted ? (isHeaderRequest ? 'X-Crypto-Context' : 'application/jose body') : (isHeaderRequest ? 'URL query · 无 body' : 'URL query + 原生 body') }}</strong></div>
      <div><span>响应载体</span><strong>{{ method === 'HEAD' ? (encrypted ? 'X-Crypto-Response · 无 body' : 'HTTP headers · 无 body') : (encrypted ? 'application/jose body' : 'JSON / 文本 / 文件') }}</strong></div>
      <div><span>{{ encrypted ? '上下文绑定' : '传输保护' }}</span><strong>{{ encrypted ? 'ID · 时效 · 方法 · 路径 · authHash' : 'HTTPS 加密连接仍然启用' }}</strong></div>
    </div>

    <div class="sequence-canvas panel">
      <div class="sequence-toolbar">
        <div class="sequence-view-buttons" role="group" aria-label="时序图视图"><button :aria-pressed="view === 'preview'" @click="view = 'preview'"><LabIcon name="wire" :size="15" />图形预览</button><button :aria-pressed="view === 'source'" @click="view = 'source'"><LabIcon name="code" :size="15" />Mermaid 源码</button></div>
        <div class="sequence-actions"><button title="复制 Mermaid 源码" @click="copySource"><LabIcon name="copy" :size="14" />复制源码</button><button :disabled="loading || !svg" @click="exportSvg"><LabIcon name="download" :size="14" />导出 SVG</button></div>
      </div>
      <div v-show="view === 'preview'" class="sequence-zoom-bar">
        <span><i class="status-dot" :class="{ idle: loading, error: !!error }" />{{ loading ? '正在绘制时序图…' : error ? '渲染未完成' : `${method} · ${encrypted ? 'RSA-OAEP-256 → A256GCM' : '原生 HTTP 数据'}` }}</span>
        <div class="sequence-canvas-tools">
          <div class="sequence-zoom-controls" role="group" aria-label="时序图缩放"><button aria-label="缩小时序图" :disabled="loading || !!error || scale <= .2" @click="zoom(-.1)">−</button><output aria-label="当前缩放比例">{{ percent }}%</output><button aria-label="放大时序图" :disabled="loading || !!error || scale >= 1.8" @click="zoom(.1)">+</button><button :disabled="loading || !!error" @click="actualSize">原始大小</button></div>
          <div class="sequence-layout-controls" role="group" aria-label="时序图画布"><button :aria-pressed="fitWidth" :disabled="loading || !!error" @click="fit">适应宽度</button><button :aria-pressed="expanded" @click="expanded = !expanded">{{ expanded ? '收起画布' : '扩大画布' }}</button></div>
        </div>
      </div>
      <p v-show="view === 'preview'" id="sequence-pan-hint" class="sequence-pan-hint"><LabIcon name="wire" :size="16" /><span>在画布内左右、上下滑动查看流程；点「适应宽度」看全局，「原始大小」恢复阅读。</span></p>
      <div v-show="view === 'preview'" ref="viewport" class="sequence-viewport" :class="{ expanded }" :aria-busy="loading" aria-label="时序图画布，可横向和纵向滚动" aria-describedby="sequence-pan-hint" tabindex="0">
        <div v-if="loading" class="sequence-placeholder" role="status"><span class="sequence-loading-mark">⇄</span><p>正在绘制完整请求链路</p><small>首次打开时加载本地 Mermaid 渲染器</small></div>
        <div v-else-if="error" class="sequence-placeholder" role="alert"><LabIcon name="info" :size="28" /><p>时序图暂时无法预览</p><small>{{ error }}</small><button class="secondary-button" @click="render">重新渲染</button></div>
        <!-- Only fixed, locally generated definitions are rendered, under Mermaid's strict policy. -->
        <div v-else class="sequence-svg" :style="{ width: `${naturalWidth * scale}px` }" v-html="svg" />
      </div>
      <pre v-if="view === 'source'" class="sequence-source" tabindex="0" aria-label="Mermaid sequenceDiagram 源码"><code>{{ source }}</code></pre>
      <div class="sequence-caption"><span>从上到下为执行顺序；实线为调用，虚线为返回。{{ includeErrors ? 'break 表示该次请求在此结束。' : '勾选「展开异常分支」查看失败路径。' }}</span><span v-if="view === 'preview'">可滚动浏览 · SVG 可独立保存</span></div>
    </div>
    <p class="sequence-feedback" role="status" aria-live="polite">{{ feedback }}</p>

    <div class="sequence-reading-notes">
      <article><span class="eyebrow">{{ encrypted ? 'KEY LIFECYCLE' : 'MODE COMPARISON' }}</span><h3>{{ encrypted ? '两把 AES 密钥，两个方向' : '业务调用保持一致' }}</h3><p>{{ encrypted ? 'jose 生成请求 CEK，用 RSA 公钥包装；客户端另生成 replyKey，经请求密文送达服务端，用于响应加密。二者不是同一把密钥。' : '仍然使用同一个 Axios 封装与 Koa 业务接口，只跳过应用层 JWE 加解密。查询串留在 URL，body 保留原生格式，HTTPS 继续保护传输。' }}</p></article>
      <article><span class="eyebrow">HTTP SEMANTICS</span><h3>{{ method === 'HEAD' ? 'HEAD 双向都没有 body' : isHeaderRequest ? `${method} 的请求密文放在头中` : `${method} 把请求密文放在 body 中` }}</h3><p>{{ method === 'HEAD' ? '加密时请求用 X-Crypto-Context，响应用 X-Crypto-Response；客户端验证响应上下文，业务 data 为空。' : isHeaderRequest ? '加密时使用 X-Crypto-Context，最大 8 KiB；响应仍放在 application/jose body。原始 query 在请求密文内。' : 'JSON、文本、表单或文件先打包，再与 query 一起加密。URL 查询串被清空，响应由 replyKey 加密后返回。' }}{{ !encrypted ? '以上为加密模式下的对照规则。' : '' }}</p></article>
      <article><span class="eyebrow">TRANSPORT BOUNDARY</span><h3>应用加密之外，仍有 HTTPS</h3><p>方法、路径与 Authorization 仍在 HTTP 外层，受 TLS 保护。摘要绑定不能代替身份认证。图中步骤来自协议代码，不是服务端实测时间线。</p></article>
    </div>
    <p class="sequence-source-links">源码阅读顺序：<code>src/lib/http.ts</code><span>→</span><code>server/app.ts</code><span>→</span><code>src/App.vue</code><a href="https://mermaid.js.org/syntax/sequenceDiagram.html" target="_blank" rel="noopener noreferrer">Mermaid 语法 ↗</a></p>
  </section>
</template>

<style scoped>
.sequence-page { min-width: 0; max-width: 100%; padding-bottom: 32px; }
.sequence-heading { display: grid; gap: 16px; border-top: 1px solid #294354; padding: 24px 0; }
.sequence-heading > div { min-width: 0; }
.sequence-heading .eyebrow { color: #6bb4c6; font-size: 11px; line-height: 1.7; overflow-wrap: anywhere; }
.sequence-heading h2 { font-weight: 500; font-size: clamp(22px, 6vw, 28px); line-height: 1.5; letter-spacing: -.5px; margin-top: 12px; }
.sequence-heading p { margin-top: 12px; font-size: 14px; line-height: 1.85; color: #8ea8bc; }
.sequence-mode { display: flex; align-items: center; gap: 8px; width: fit-content; max-width: 100%; font-size: 12px; color: var(--cyan); border: 1px solid #315c6c; background: #12303d; padding: 10px 12px; border-radius: 6px; }
.sequence-mode.plain { color: var(--amber); border-color: #5f513d; background: #2c2922; }
.sequence-mode > span { border-left: 1px solid currentColor; padding-left: 9px; margin-left: 3px; font: 11px var(--mono); }
.sequence-controls { display: grid; gap: 14px; padding: 16px 0; border-top: 1px solid var(--line); }
.sequence-method { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 8px 12px; min-width: 0; color: #9bb4c7; font-size: 13px; }
.sequence-method .method-select { min-width: 0; width: 100%; --select-height: 44px; --select-font-size: 14px; }
.sequence-method code { grid-column: 2; font: 12px/1.6 var(--mono); color: #b7cbd9; overflow-wrap: anywhere; }
.sequence-static-note { font-size: 12px; line-height: 1.6; color: #7f9cb2; }
.sequence-facts { display: grid; grid-template-columns: minmax(0, 1fr); margin: 0 0 18px; background: #0c1e2d; border: 1px solid #243b50; border-radius: 8px; }
.sequence-facts > div { display: grid; grid-template-columns: 4.5em minmax(0, 1fr); gap: 12px; align-items: start; padding: 14px; min-width: 0; border-bottom: 1px solid #243b50; font-size: 12px; }
.sequence-facts > div:last-child { border-bottom: 0; }
.sequence-facts span { color: #819eb4; line-height: 1.7; }
.sequence-facts strong { min-width: 0; font: 12px/1.7 var(--mono); color: #b1ccdd; overflow-wrap: anywhere; }
.sequence-canvas { min-width: 0; max-width: 100%; }
.sequence-toolbar { display: grid; padding: 0 12px; border-bottom: 1px solid #294053; }
.sequence-view-buttons, .sequence-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; min-width: 0; }
.sequence-toolbar button { display: flex; align-items: center; justify-content: center; gap: 6px; min-width: 0; min-height: 44px; border: 0; background: none; color: #98b3c7; font-size: 12px; line-height: 1.5; padding: 8px 4px; }
.sequence-view-buttons button { min-height: 52px; border-bottom: 2px solid transparent; }
.sequence-view-buttons button[aria-pressed=true] { color: var(--cyan); border-bottom-color: var(--cyan); }
.sequence-actions { padding: 4px 0; border-top: 1px solid #20374a; }
.sequence-toolbar button:hover:not(:disabled) { color: #d4e7f0; }
.sequence-toolbar button:focus-visible, .sequence-zoom-bar button:focus-visible { outline: 0; box-shadow: inset 0 0 0 2px var(--cyan); border-radius: 4px; }
.sequence-zoom-bar { display: grid; gap: 12px; padding: 12px; border-bottom: 1px solid #1c3346; background: #102131; }
.sequence-zoom-bar > span { display: flex; align-items: center; gap: 8px; min-width: 0; font: 12px/1.7 var(--mono); color: #91aec2; overflow-wrap: anywhere; }
.sequence-zoom-bar .status-dot { flex-shrink: 0; }
.sequence-canvas-tools { display: grid; gap: 8px; min-width: 0; }
.sequence-zoom-controls { display: grid; grid-template-columns: 44px minmax(42px, 1fr) 44px minmax(0, 1.7fr); align-items: center; gap: 4px; min-width: 0; }
.sequence-layout-controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.sequence-zoom-bar button { display: flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; font-size: 12px; line-height: 1.5; border: 1px solid #29475d; border-radius: 6px; background: #10293b; padding: 8px; color: #b1cbdc; }
.sequence-zoom-bar button:hover:not(:disabled) { background: #1b354a; border-color: #48738b; }
.sequence-zoom-bar button[aria-pressed=true] { color: var(--cyan); background: #163b4b; border-color: #3b7f91; }
.sequence-zoom-bar output { min-width: 0; text-align: center; font: 12px var(--mono); color: #adc4d4; }
.sequence-pan-hint { display: flex; align-items: flex-start; gap: 8px; padding: 12px; border-bottom: 1px solid #20374a; background: #0c1e2c; color: #94b3c7; font-size: 12px; line-height: 1.75; }
.sequence-pan-hint svg { margin-top: 2px; }
.sequence-viewport { width: 100%; max-width: 100%; min-width: 0; height: clamp(280px, 62vh, 730px); height: clamp(280px, 62svh, 730px); height: clamp(280px, 62dvh, 730px); overflow: auto; position: relative; overscroll-behavior-x: contain; overscroll-behavior-y: auto; background-color: #081522; background-image: radial-gradient(#24415380 .6px, transparent .6px); background-size: 20px 20px; scrollbar-color: #476d82 #102131; scrollbar-width: auto; }
.sequence-viewport:focus-visible, .sequence-source:focus-visible { outline: 0; box-shadow: inset 0 0 0 2px #58d9f4; }
.sequence-viewport::-webkit-scrollbar { width: 10px; height: 10px; }
.sequence-viewport::-webkit-scrollbar-thumb { background: #476d82; border: 2px solid #102131; }
.sequence-viewport.expanded { height: clamp(320px, 88vh, 1100px); height: clamp(320px, 88svh, 1100px); height: clamp(320px, 88dvh, 1100px); }
.sequence-svg { padding: 0; margin: 12px; flex-shrink: 0; }
.sequence-svg :deep(svg) { max-width: none; }
.sequence-placeholder { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 14px; padding: 24px 16px; color: #80b9ce; }
.sequence-placeholder p { font-size: 15px; line-height: 1.7; color: #b9d3e3; }
.sequence-placeholder small { font-size: 12px; color: #88a6ba; overflow-wrap: anywhere; max-width: 600px; line-height: 1.8; }
.sequence-loading-mark { font: 40px var(--mono); color: #58d9f4; }
.sequence-placeholder button { min-height: 44px; margin: 6px 0 0; }
.sequence-source { width: 100%; min-width: 0; max-width: 100%; height: clamp(280px, 62vh, 730px); height: clamp(280px, 62svh, 730px); height: clamp(280px, 62dvh, 730px); margin: 0; padding: 16px; overflow: auto; overscroll-behavior-x: contain; background: #081522; font: 13px/1.95 var(--mono); color: #a2c7d7; tab-size: 2; }
.sequence-source code { font: inherit; white-space: pre; }
.sequence-caption { display: grid; gap: 8px; padding: 14px; border-top: 1px solid #294053; color: #8eacbf; font-size: 12px; line-height: 1.85; overflow-wrap: anywhere; }
.sequence-feedback { min-height: 30px; padding: 6px 0 0; font-size: 13px; line-height: 1.7; color: var(--cyan); }
.sequence-reading-notes { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; margin-top: 8px; }
.sequence-reading-notes article { min-width: 0; border-top: 1px solid #294354; padding-top: 20px; }
.sequence-reading-notes .eyebrow { font-size: 11px; line-height: 1.7; }
.sequence-reading-notes h3 { font-size: 17px; line-height: 1.65; font-weight: 500; margin: 12px 0 9px; color: #bfd3e0; }
.sequence-reading-notes p { font-size: 14px; line-height: 1.9; color: #8ca8bc; overflow-wrap: anywhere; }
.sequence-source-links { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; color: #86a6bc; font-size: 12px; margin-top: 24px; line-height: 1.9; }
.sequence-source-links code { max-width: 100%; font: 12px/1.9 var(--mono); color: #94bccc; overflow-wrap: anywhere; }
.sequence-source-links a { display: inline-flex; align-items: center; min-height: 44px; width: 100%; margin-top: 4px; color: #a0c9d9; text-decoration-color: #365e74; text-underline-offset: 4px; }
@media (min-width: 480px) {
  .sequence-method { display: flex; flex-wrap: wrap; }
  .sequence-method .method-select { width: 130px; }
  .sequence-canvas-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .sequence-zoom-controls { grid-template-columns: 44px 48px 44px auto; flex: 1 1 250px; }
  .sequence-layout-controls { flex: 1 1 210px; }
}
@media (min-width: 720px) {
  .sequence-heading { display: flex; gap: 24px; align-items: flex-start; justify-content: space-between; padding: 30px 0 24px; }
  .sequence-heading h2 { font-size: 28px; }
  .sequence-mode { flex-shrink: 0; margin-top: 22px; }
  .sequence-controls { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
  .sequence-static-note { margin-left: auto; }
  .sequence-facts { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-bottom: 22px; }
  .sequence-facts > div { display: block; padding: 16px; border-bottom: 0; border-right: 1px solid #243b50; }
  .sequence-facts > div:last-child { border-right: 0; }
  .sequence-facts span { display: block; margin-bottom: 8px; }
  .sequence-facts strong { display: block; }
  .sequence-toolbar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px 20px; padding: 0 20px; }
  .sequence-view-buttons, .sequence-actions { display: flex; gap: 20px; }
  .sequence-view-buttons button { min-height: 58px; }
  .sequence-actions { padding: 0; border-top: 0; }
  .sequence-zoom-bar { padding: 12px 20px; }
  .sequence-canvas-tools { flex-wrap: nowrap; }
  .sequence-zoom-controls, .sequence-layout-controls { flex: 0 0 auto; }
  .sequence-pan-hint { padding: 10px 20px; }
  .sequence-viewport { height: clamp(360px, 72vh, 730px); height: clamp(360px, 72svh, 730px); height: clamp(360px, 72dvh, 730px); }
  .sequence-viewport.expanded { height: clamp(400px, 88vh, 1100px); height: clamp(400px, 88svh, 1100px); height: clamp(400px, 88dvh, 1100px); }
  .sequence-svg { margin: 20px auto; }
  .sequence-source { padding: 24px; }
  .sequence-caption { display: flex; flex-wrap: wrap; justify-content: space-between; padding: 14px 20px; }
  .sequence-source-links a { width: auto; margin: 0 0 0 auto; }
}
@media (min-width: 1080px) {
  .sequence-zoom-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; }
  .sequence-reading-notes { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>
