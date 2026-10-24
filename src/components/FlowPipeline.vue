<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import type { RequestTrace } from '../lib/http'
import type { LabStepItem, LabStepStatus } from './lab-steps'
import LabIcon from './LabIcon.vue'
import LabSteps from './LabSteps.vue'

const { trace, busy, encrypted } = defineProps<{ trace?: RequestTrace; busy: boolean; encrypted: boolean }>()
const detailsId = useId()
const mobileExpanded = ref(false)
const isDesktop = ref(false)
const expanded = computed(() => isDesktop.value || mobileExpanded.value)
let desktopQuery: MediaQueryList | undefined
function syncLayout() { isDesktop.value = desktopQuery?.matches ?? false }
onMounted(() => {
  desktopQuery = window.matchMedia('(min-width: 1024px)')
  syncLayout()
  desktopQuery.addEventListener('change', syncLayout)
})
onBeforeUnmount(() => desktopQuery?.removeEventListener('change', syncLayout))

const completed = computed(() => trace?.stage === 'done')
const caption = computed(() => trace?.error ? '请求已结束 · 查看错误' : busy ? '请求运行中' : completed.value ? '完整链路已完成' : '一次请求的完整旅程')
const steps = computed<LabStepItem[]>(() => {
  const labels = new Set(trace?.steps.map((step) => step.label))
  const opened = labels.has('响应解密') || labels.has('响应解析')
  const done = [
    Boolean(trace?.plainRequest),
    labels.has('加密封装') || labels.has('明文对照') || Boolean(trace?.wireRequest),
    Boolean(trace?.wireResponse),
    opened,
    completed.value,
  ]
  const current = done.findIndex((value) => !value)
  const status = (index: number): LabStepStatus => {
    if (done[index]) return 'complete'
    if (index === current && trace?.error) return 'error'
    if (index === current && busy) return 'active'
    return 'waiting'
  }
  const items: LabStepItem[] = [
    { id: 'prepare', title: '业务数据', caption: 'PLAINTEXT', icon: 'code', description: 'JSON · Query · 文件' },
    { id: 'seal', title: encrypted ? '封装与加密' : '序列化', caption: encrypted ? 'SEAL' : 'ENCODE', icon: encrypted ? 'lock' : 'code', description: encrypted ? 'RSA-OAEP + AES-GCM' : 'JSON / 原始数据' },
    { id: 'wire', title: '网络传输', caption: 'ON THE WIRE', icon: 'wire', description: encrypted ? 'Compact JWE' : '普通 HTTP 请求' },
    { id: 'open', title: encrypted ? '校验与解密' : '解析响应', caption: encrypted ? 'OPEN' : 'PARSE', icon: 'unlock', description: encrypted ? 'reply key · 完整性校验' : 'Content-Type → 数据' },
    { id: 'render', title: '页面渲染', caption: 'RENDER', icon: 'window', description: trace?.error && opened ? '响应已解析，请求停止 · 查看错误' : '响应数据 → Vue ref' },
  ]
  return items.map((item, index) => ({ ...item, status: status(index) }))
})
const progressDescription = computed(() => {
  const current = steps.value.findIndex((step) => step.status === 'active' || step.status === 'error')
  if (current !== -1) {
    const step = steps.value[current]!
    return `第 ${current + 1} / ${steps.value.length} 步 · ${step.title}${step.status === 'error' ? '已停止' : ''}`
  }
  if (completed.value) return `${steps.value.length} / ${steps.value.length} 步已完成`
  return `${steps.value.length} 个步骤 · 业务数据 → 页面渲染`
})
</script>

<template>
  <section class="flow-panel" aria-label="实际请求处理流程">
    <div class="flow-header">
      <div class="flow-caption">
        <span class="flow-current" role="status"><i class="status-dot" :class="{ idle: !trace, error: trace?.error }" />{{ caption }}</span>
        <span class="mono">BROWSER <span class="flow-caption-arrow">⇄</span> KOA SERVER</span>
      </div>
      <button
        v-if="!isDesktop"
        type="button"
        class="flow-toggle"
        :aria-expanded="expanded"
        :aria-controls="detailsId"
        @click="mobileExpanded = !mobileExpanded"
      >
        <span>{{ expanded ? '收起流程' : '展开流程' }}</span>
        <LabIcon name="arrow" :size="16" />
      </button>
    </div>
    <div v-if="!isDesktop && !expanded" class="flow-summary" :data-tone="encrypted ? 'cyan' : 'amber'">
      <span class="flow-summary-label">{{ progressDescription }}</span>
      <span class="flow-mini-steps" aria-hidden="true">
        <span v-for="step in steps" :key="step.id" :data-status="step.status" />
      </span>
    </div>
    <div :id="detailsId" v-show="expanded" class="flow-details">
      <LabSteps class="flow-progress" :items="steps" :tone="encrypted ? 'cyan' : 'amber'" label="从业务数据到页面渲染" />
    </div>
    <div class="flow-security-note"><LabIcon name="lock" :size="16" /><span>HTTPS 保护传输通道。应用层加密保护 body 与 query，方法和路径仍然可见。</span></div>
  </section>
</template>

<style scoped>
.flow-panel { min-width: 0; margin-bottom: 20px; overflow: hidden; border: 1px solid #264254; border-radius: 12px; background: linear-gradient(110deg, #0e202f, #0b1a28 75%); }
.flow-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; }
.flow-caption { display: flex; flex-direction: column; gap: 7px; min-width: 0; color: #b0c6d5; font-size: 13px; line-height: 1.5; }
.flow-current { display: flex; align-items: center; gap: 8px; }
.flow-current .status-dot { flex-shrink: 0; }
.flow-caption .mono { color: #829eb2; font-size: 12px; letter-spacing: .3px; }
.flow-caption-arrow { margin: 0 5px; color: #86aebf; }
.flow-toggle { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; gap: 6px; min-height: 48px; padding: 0 10px; border: 1px solid #2b4b5f; border-radius: 8px; background: #102b3b; color: #a6d2e1; font: inherit; font-size: 13px; white-space: nowrap; cursor: pointer; }
.flow-toggle:hover { border-color: #4e879c; background: #163748; }
.flow-toggle:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--cyan, #58d9f4); }
.flow-toggle svg { transform: rotate(90deg); transition: transform .18s ease; }
.flow-toggle[aria-expanded='true'] svg { transform: rotate(-90deg); }
.flow-summary { padding: 0 16px 16px; --summary-accent: var(--cyan, #58d9f4); }
.flow-summary[data-tone='amber'] { --summary-accent: var(--amber, #e6b775); }
.flow-summary-label { color: #9cb5c8; font-size: 13px; line-height: 1.6; }
.flow-mini-steps { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 5px; margin-top: 9px; }
.flow-mini-steps > span { height: 3px; border-radius: 2px; background: #2a4356; }
.flow-mini-steps > span[data-status='complete'] { background: var(--summary-accent); }
.flow-mini-steps > span[data-status='active'] { background: var(--summary-accent); box-shadow: 0 0 0 2px #315967; }
.flow-mini-steps > span[data-status='error'] { background: #f0a395; }
.flow-progress { margin: 8px 18px 20px; }
.flow-security-note { display: flex; align-items: flex-start; gap: 8px; border-top: 1px solid #1a3347; padding: 12px 16px; background: #09172577; color: #8faabc; font-size: 12px; line-height: 1.7; }
.flow-security-note svg { flex-shrink: 0; margin-top: 2px; }
@media (min-width: 1024px) {
  .flow-panel { margin-bottom: 26px; }
  .flow-header { padding: 20px 24px 0; }
  .flow-caption { width: 100%; flex-direction: row; justify-content: space-between; align-items: center; gap: 16px; }
  .flow-progress { margin: 26px 24px 24px; }
  .flow-security-note { justify-content: center; padding: 12px 24px; }
}
@media (prefers-reduced-motion: reduce) { .flow-toggle svg { transition: none; } }
@media (forced-colors: active) {
  .flow-mini-steps > span { border: 1px solid GrayText; }
  .flow-mini-steps > span[data-status='complete'], .flow-mini-steps > span[data-status='active'] { background: Highlight; }
  .flow-toggle:focus-visible { outline: 2px solid Highlight; outline-offset: -3px; }
}
</style>
