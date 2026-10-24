<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { MAX_BODY_BYTES, METHODS, type Method } from '../../shared/protocol'
import type { RequestOptions } from '../lib/http'
import LabIcon from './LabIcon.vue'
import LabSelect from './LabSelect.vue'
import LabInput from './LabInput.vue'
import LabTextarea from './LabTextarea.vue'
import LabCheckbox from './LabCheckbox.vue'
import LabFilePicker from './LabFilePicker.vue'

const props = defineProps<{ busy: boolean; encrypted: boolean }>()
const emit = defineEmits<{ send: [config: RequestOptions, token: string]; cancel: [] }>()
const method = ref<Method>('GET')
const url = ref('/api/profile')
const query = ref('{}')
const body = ref('{\n  "name": "Alex Chen",\n  "role": "Frontend Developer",\n  "note": "Hello from Cipher Lab"\n}')
const format = ref('json')
const token = ref(import.meta.env.VITE_DEMO_TOKEN ?? 'demo-token')
const timeout = ref(10000)
const selectedFiles = ref<File[]>([])
const multipleFiles = ref(false)
const acceptedFileTypes = ref('')
const fileSelectionValid = ref(true)
const filePicker = useTemplateRef<{ validate: () => boolean }>('filePicker')
const maxFileSize = 512 * 1024
// 为表单字段名及 note 内容预留 1 KiB，遵守 SDK 的 1 MiB 业务限额。
const maxFilesSize = MAX_BODY_BYTES - 1024
const fileTypeOptions = [
  { value: '', label: '所有文件', description: '不限制文件格式' },
  { value: 'image/*', label: '图片', description: 'image/* · 图片格式' },
  {
    value: '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    label: '文档', description: 'PDF / DOC / DOCX',
  },
  { value: '.txt,.csv,.json,text/plain,text/csv,application/json', label: '文本', description: 'TXT / CSV / JSON' },
]
const filePickerDescription = computed(() => acceptedFileTypes.value
  ? '请选择符合格式要求的文件，支持拖放。'
  : '支持拖放；未选择时会上传示例 hello-cipher.txt。')
const localError = ref('')
const selectedPreset = ref('profile')
const hasBody = computed(() => !['GET', 'HEAD', 'OPTIONS'].includes(method.value))
const methodDescriptions: Record<Method, string> = {
  GET: '读取资源', POST: '提交数据', PUT: '完整替换', PATCH: '局部更新',
  DELETE: '删除资源', HEAD: '仅取响应头', OPTIONS: '查询支持的方法',
}
const methodOptions = METHODS.map((value) => ({ value, label: value, description: methodDescriptions[value] }))
const endpointOptions = [
  { value: '/api/profile', label: '/api/profile', description: '用户资料 · 需要演示 token' },
  { value: '/api/echo', label: '/api/echo', description: '回显请求 · 支持全部方法' },
  { value: '/api/upload', label: '/api/upload', description: '文件上传 · 校验文件摘要' },
  { value: '/api/download', label: '/api/download', description: '文件下载 · CSV 示例' },
  { value: '/api/error', label: '/api/error', description: '错误响应 · 观察 422' },
  { value: '/api/delay', label: '/api/delay', description: '延迟响应 · 超时与取消' },
]
const formatOptions = [
  { value: 'json', label: 'JSON', description: '结构化对象与数组' },
  { value: 'text', label: 'Text', description: '原始文本内容' },
  { value: 'urlencoded', label: 'URL-encoded', description: '键值表单' },
  { value: 'form', label: 'FormData / 文件', description: '文件与多部分表单' },
  { value: 'binary', label: 'Binary', description: 'UTF-8 二进制数据' },
]
const presets = [
  { id: 'profile', label: '用户资料', hint: 'GET · 身份绑定' },
  { id: 'echo', label: '回声请求', hint: 'POST · 加密 body' },
  { id: 'query', label: '查询参数', hint: 'GET · 隐藏 query' },
  { id: 'upload', label: '文件上传', hint: 'POST · FormData' },
  { id: 'download', label: '文件下载', hint: 'GET · Blob' },
  { id: 'error', label: '错误响应', hint: 'GET · 422' },
  { id: 'delay', label: '超时 / 取消', hint: 'GET · 5s 延迟' },
  { id: 'head', label: '响应头', hint: 'HEAD · 无 body' },
]

function selectPreset(id: string) {
  selectedPreset.value = id
  localError.value = ''
  query.value = '{}'
  format.value = 'json'
  timeout.value = 10000
  method.value = id === 'echo' || id === 'upload' ? 'POST' : id === 'head' ? 'HEAD' : 'GET'
  url.value = ['/api/profile', '/api/echo', '/api/upload', '/api/download', '/api/error', '/api/delay'].find((path) => path.endsWith(id)) || '/api/echo'
  if (id === 'query') query.value = '{ "q": "hello", "page": 1 }'
  if (id === 'delay') { query.value = '{ "ms": 5000 }'; timeout.value = 2500 }
  if (id === 'upload') format.value = 'form'
  body.value = id === 'profile'
    ? '{\n  "name": "Alex Chen",\n  "role": "Frontend Developer",\n  "note": "Hello from Cipher Lab"\n}'
    : '{\n  "message": "Hello, encrypted world!",\n  "from": "Cipher Lab"\n}'
}

function parseRecord(value: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value || '{}')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label}必须是 JSON 对象。`)
  return parsed as Record<string, unknown>
}

function submit() {
  localError.value = ''
  try {
    const params = parseRecord(query.value, '查询参数')
    for (const value of Object.values(params)) {
      if (!['string', 'number', 'boolean'].includes(typeof value) && !(Array.isArray(value) && value.every((item) => typeof item === 'string'))) {
        throw new Error('查询参数支持字符串、数字、布尔值或字符串数组。')
      }
    }
    let data: unknown
    if (hasBody.value) {
      if (format.value === 'json') data = JSON.parse(body.value || '{}')
      if (format.value === 'text') data = body.value
      if (format.value === 'urlencoded') {
        data = new URLSearchParams(Object.entries(parseRecord(body.value, '表单')).map(([key, value]) => [key, String(value)]))
      }
      if (format.value === 'form') {
        // 规则变更不静默删除文件；提交时复查当前选择和最近的拒绝原因。
        if (!filePicker.value?.validate()) throw new Error('请修正文件选择中的错误后再发送请求。')
        if (!selectedFiles.value.length && acceptedFileTypes.value) throw new Error('已限制文件格式，请先选择符合要求的文件。')
        const files = selectedFiles.value.length ? selectedFiles.value : [
          new File(['Hello from Cipher Lab.\nThis file travels inside JWE.'], 'hello-cipher.txt', { type: 'text/plain' }),
        ]
        const form = new FormData()
        // 同名字段逐项追加；明文 multipart 与加密 PackedBody 均保留所有文件。
        for (const file of files) form.append('file', file)
        form.append('note', 'A real multipart upload')
        data = form
      }
      if (format.value === 'binary') data = new TextEncoder().encode(body.value)
    }
    emit('send', {
      url: url.value,
      method: method.value as RequestOptions['method'],
      params: params as RequestOptions['params'],
      data,
      encrypted: props.encrypted,
      timeout: timeout.value,
      responseType: url.value === '/api/download' ? 'blob' : 'json',
    }, token.value)
  } catch (error) {
    localError.value = error instanceof Error ? error.message : '请检查请求输入。'
  }
}

defineExpose({ submit })
</script>

<template>
  <section class="panel request-panel" aria-labelledby="request-title">
    <div class="panel-heading"><div><span class="eyebrow">REQUEST BUILDER</span><h2 id="request-title">构造一个请求</h2></div><span class="small-tag">01</span></div>
    <form @submit.prevent="submit">
      <fieldset class="preset-fieldset" :disabled="busy">
        <legend class="field-label">从一个场景开始</legend>
        <div class="preset-grid">
          <button v-for="preset in presets" :key="preset.id" type="button" class="preset-button" :class="{ selected: selectedPreset === preset.id }" :aria-pressed="selectedPreset === preset.id" @click="selectPreset(preset.id)">
            <span>{{ preset.label }}</span><small>{{ preset.hint }}</small>
          </button>
        </div>
      </fieldset>
      <div class="request-url">
        <div class="method-field">
          <label class="field-label" for="request-method">Method</label>
          <LabSelect id="request-method" v-model="method" :options="methodOptions" label="HTTP 方法" tone="accent" :disabled="busy" />
        </div>
        <div class="url-field">
          <label class="field-label" for="request-endpoint">Endpoint</label>
          <LabSelect id="request-endpoint" v-model="url" :options="endpointOptions" label="接口路径" :menu-min-width="250" :disabled="busy" />
        </div>
      </div>
      <div class="form-field">
        <label class="field-label" for="request-query">Query parameters <span>JSON</span></label>
        <LabTextarea id="request-query" v-model="query" rows="2" spellcheck="false" :disabled="busy" aria-label="查询参数 JSON" />
      </div>
      <div v-show="hasBody" class="form-field">
        <div class="request-body-heading">
          <label class="field-label" :for="format === 'form' ? 'upload-file' : 'request-body'">Request body</label>
          <LabSelect id="body-format" v-model="format" class="body-format-select" :options="formatOptions" label="请求 body 格式" size="small" :menu-min-width="220" :disabled="busy" />
        </div>
        <div v-show="format === 'form'" class="request-file-field">
          <div class="file-picker-settings">
            <LabCheckbox v-model="multipleFiles" label="多选文件" :disabled="busy" />
            <div class="file-type-field">
              <label class="field-label" for="file-type-filter">文件格式</label>
              <LabSelect id="file-type-filter" v-model="acceptedFileTypes" :options="fileTypeOptions" label="允许的文件格式" size="small" :menu-min-width="205" :disabled="busy" />
            </div>
          </div>
          <LabFilePicker
            id="upload-file" ref="filePicker" v-model="selectedFiles"
            :label="multipleFiles ? '选择文件' : '选择一个文件'" :description="filePickerDescription"
            :accept="acceptedFileTypes" :multiple="multipleFiles" :max-files="5"
            :max-size="maxFileSize" :max-total-size="maxFilesSize" :disabled="busy"
            @validity-change="fileSelectionValid = $event"
          />
          <small class="file-picker-note" :class="{ 'is-invalid': !fileSelectionValid }">
            {{ fileSelectionValid ? '文件只在点击发送请求后上传。' : '请调整文件选择后再发送；切换规则会保留已选文件。' }}
          </small>
        </div>
        <LabTextarea v-if="format !== 'form'" id="request-body" v-model="body" rows="5" spellcheck="false" :disabled="busy" aria-label="请求 body" />
      </div>
      <div v-if="!hasBody" class="body-hint"><LabIcon name="info" :size="16" /><span>{{ method === 'HEAD' ? 'HEAD 没有响应 body；加密结果从响应头解开。' : method === 'GET' ? 'GET 不携带 body；加密时查询参数进入密文头。' : 'OPTIONS 用于查询资源支持的请求方法。' }}</span></div>
      <details class="advanced-settings">
        <summary>身份与请求设置 <span>Bearer · Timeout</span></summary>
        <div class="form-field">
          <label class="field-label" for="request-token">演示 token</label>
          <LabInput id="request-token" v-model="token" :disabled="busy" placeholder="demo-token" autocomplete="off" spellcheck="false" aria-describedby="request-token-hint" />
          <small id="request-token-hint">/api/profile 使用 demo-token；清空可观察 401。</small>
        </div>
        <div class="form-field">
          <label class="field-label" for="request-timeout">超时时间（毫秒）</label>
          <LabInput id="request-timeout" v-model.number="timeout" type="number" min="100" max="60000" step="100" :disabled="busy" />
        </div>
      </details>
      <p v-if="localError" class="error-note" role="alert">{{ localError }}</p>
      <div class="send-actions"><button class="send-button" type="submit" :disabled="busy"><span>{{ busy ? '请求进行中…' : '发送请求' }}</span><LabIcon :name="busy ? 'clock' : 'arrow'" :size="20" /></button><button v-if="busy" type="button" class="cancel-button" @click="emit('cancel')">取消</button></div>
      <p class="request-footnote">{{ encrypted ? '此请求将通过 JWE 加密传输' : '此请求使用普通 HTTP 数据格式' }}</p>
    </form>
  </section>
</template>
