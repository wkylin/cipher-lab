<script setup lang="ts">
import { computed, ref } from 'vue'
import type { RequestTrace } from '../lib/http'
import LabIcon from './LabIcon.vue'
import { readable } from './format'
const props = defineProps<{ trace?: RequestTrace; busy: boolean }>()
const activeTab = ref('request')
const copyState = ref('复制')
const tabs = [
  { id: 'input', title: '业务输入', hint: '应用层' },
  { id: 'request', title: '网络请求', hint: '发送密文' },
  { id: 'response', title: '网络响应', hint: '收到密文' },
  { id: 'result', title: '解析结果', hint: '恢复数据' },
]
const content = computed(() => {
  const trace = props.trace
  if (!trace) return '点击「发送请求」，观察真实数据如何穿过加密链路。'
  const value = activeTab.value === 'input' ? trace.plainRequest : activeTab.value === 'request' ? trace.wireRequest : activeTab.value === 'response' ? trace.wireResponse : trace.plainResponse
  if (activeTab.value === 'result' && trace.method === 'HEAD' && trace.stage === 'done' && value === undefined) return 'HEAD 请求已完成。HTTP 响应没有 body；请查看「网络响应」中的 headers。'
  return readable(value)
})
const isWire = computed(() => ['request', 'response'].includes(activeTab.value))
const caption = computed(() => activeTab.value === 'input' ? '进入请求封装前的数据' : activeTab.value === 'request' ? '发送快照 · Token 已隐藏，文件显示摘要' : activeTab.value === 'response' ? '接收快照 · 二进制响应显示摘要' : '完成协议校验后的完整业务 envelope')
async function copy() {
  try { await navigator.clipboard.writeText(content.value); copyState.value = '已复制' }
  catch { copyState.value = '复制失败，请手动选取' }
  window.setTimeout(() => { copyState.value = '复制' }, 1800)
}
function navigateTabs(event: KeyboardEvent, index: number) {
  let next = index
  if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
  else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = tabs.length - 1
  else return
  event.preventDefault()
  activeTab.value = tabs[next]!.id
  const buttons = (event.currentTarget as HTMLButtonElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  buttons?.[next]?.focus()
}
</script>

<template>
  <section class="panel inspector-panel" aria-labelledby="inspector-title">
    <div class="panel-heading"><div><span class="eyebrow">LIVE INSPECTOR</span><h2 id="inspector-title">打开数据的每一层</h2></div><span class="inspector-live"><i class="status-dot" :class="{ idle: !trace }" />{{ busy ? 'PROCESSING' : trace ? 'CAPTURED' : 'READY' }}</span></div>
    <div class="inspector-tabs" role="tablist" aria-label="查看请求数据"><button v-for="(tab, index) in tabs" :id="`tab-${tab.id}`" :key="tab.id" type="button" role="tab" :aria-selected="activeTab === tab.id" :tabindex="activeTab === tab.id ? 0 : -1" aria-controls="inspector-content" :class="{ active: activeTab === tab.id }" @click="activeTab = tab.id" @keydown="navigateTabs($event, index)">{{ tab.title }}<small>{{ !trace?.encrypted && tab.id === 'request' ? '明文传输' : !trace?.encrypted && tab.id === 'response' ? '明文响应' : tab.hint }}</small></button></div>
    <div class="code-toolbar"><span><i class="code-dot" :class="{ plain: !trace?.encrypted || !isWire }" />{{ caption }}</span><button type="button" class="copy-button" @click="copy"><LabIcon name="copy" :size="14" />{{ copyState }}</button></div>
    <div id="inspector-content" class="code-window" role="tabpanel" :aria-labelledby="`tab-${activeTab}`" tabindex="0"><pre>{{ content }}</pre></div>
    <div v-if="trace?.encrypted && isWire" class="inspector-note"><span class="protocol-tag">JWE</span><p>{{ activeTab === 'request' ? '五段 Compact JWE：受保护头 · 加密内容密钥 · IV · 密文 · 认证标签。GET 的密文位于 X-Crypto-Context。' : '响应使用本次请求的 reply key。通过解密与上下文校验，才会交给页面。HEAD 的加密结果位于响应头。' }}</p></div>
    <div v-else class="inspector-note"><span class="protocol-tag" :class="{ amber: !trace?.encrypted }">{{ isWire ? 'PLAIN' : 'JSON' }}</span><p>{{ isWire ? '未启用应用层加密：业务参数按普通 HTTP 格式传输。切换加密后再次发送，对比这两个快照。' : '这里展示开发者可以使用的数据。页面组件不需要感知底层的加密与解密。' }}</p></div>
    <details v-if="trace?.steps.length" class="trace-details"><summary><span><LabIcon name="clock" :size="15" /> 实际执行记录</span><span>{{ trace.steps.length }} 个事件 <span class="mono">↗</span></span></summary><ol><li v-for="(step, index) in trace.steps" :key="index"><span class="event-number">{{ String(index + 1).padStart(2, '0') }}</span><div><strong>{{ step.label }}</strong><p>{{ step.detail }}</p></div><time>{{ step.ms.toFixed(1) }} ms</time></li></ol></details>
  </section>
</template>
