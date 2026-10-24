<script setup lang="ts">
import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue'
import { fileKey, formatFileSize, validateFiles, type FileRejection } from '../lib/file-picker'
import LabIcon from './LabIcon.vue'

const {
  id, label = '选择文件', description, accept = '', multiple = false,
  maxFiles, maxSize, maxTotalSize, disabled = false,
} = defineProps<{
  id?: string
  label?: string
  description?: string
  accept?: string
  multiple?: boolean
  maxFiles?: number
  maxSize?: number
  maxTotalSize?: number
  disabled?: boolean
}>()
const model = defineModel<File[]>({ required: true })
const emit = defineEmits<{
  change: [files: File[]]
  reject: [files: FileRejection[]]
  'validity-change': [valid: boolean]
}>()
const uid = useId()
const triggerId = computed(() => id ?? `file-picker-${uid}`)
const hintId = `file-picker-hint-${uid}`
const errorId = `file-picker-error-${uid}`
const input = useTemplateRef<HTMLInputElement>('input')
const trigger = useTemplateRef<HTMLButtonElement>('trigger')
const rejected = ref<FileRejection[]>([])
const dropError = ref('')
const announcement = ref('')
const dragDepth = ref(0)
let pendingCommit: File[] | undefined
const sameFiles = (left: readonly File[], right: readonly File[]) => left.length === right.length && left.every((file, index) => file === right[index])
const rules = computed(() => ({ accept, multiple, maxFiles, maxSize, maxTotalSize }))
const selectionErrors = computed(() => validateFiles(model.value, [], rules.value).rejected)
const invalidKeys = computed(() => new Set(selectionErrors.value.map(({ file }) => fileKey(file))))
const errors = computed(() => [...new Set([
  ...selectionErrors.value.map(({ file, message }) => `${file.name}：${message}`),
  ...rejected.value.map(({ file, message }) => `${file.name}：${message}`),
  ...(dropError.value ? [dropError.value] : []),
])])
const valid = computed(() => errors.value.length === 0)
const totalSize = computed(() => model.value.reduce((sum, file) => sum + file.size, 0))
const constraints = computed(() => [
  multiple ? (maxFiles === undefined ? '支持多选' : `最多 ${maxFiles} 个`) : '单选文件',
  ...(maxSize === undefined ? [] : [`单个 ≤ ${formatFileSize(maxSize)}`]),
  ...(maxTotalSize === undefined ? [] : [`合计 ≤ ${formatFileSize(maxTotalSize)}`]),
])
const typeHint = computed(() => {
  const tokens = accept.split(',').map((token) => token.trim()).filter(Boolean)
  const extensions = tokens.filter((token) => token.startsWith('.'))
  return tokens.length ? `允许：${(extensions.length ? extensions : tokens).join(' / ')}` : '支持所有文件格式'
})

function clearRejections() { rejected.value = []; dropError.value = '' }
// Validate external model/rule changes without silently dropping the user's files.
watch(model, (files) => {
  // A controlled model returns through the parent on its next render. Preserve
  // this selection's rejected items on that echo; only external edits reset them.
  if (pendingCommit && sameFiles(files, pendingCommit)) { pendingCommit = undefined; return }
  pendingCommit = undefined
  clearRejections()
}, { deep: true, flush: 'sync' })
watch(valid, (value) => emit('validity-change', value), { immediate: true, flush: 'sync' })
watch(() => disabled, () => { dragDepth.value = 0 })

function commit(files: File[]) {
  if (sameFiles(files, pendingCommit ?? model.value)) return
  pendingCommit = files
  model.value = files
  emit('change', [...files])
}
function chooseFiles(files: File[]) {
  if (disabled || !files.length) return
  const result = validateFiles(files, pendingCommit ?? model.value, rules.value)
  commit(result.files)
  dropError.value = ''
  rejected.value = result.rejected
  if (result.rejected.length) emit('reject', [...result.rejected])
  const bytes = result.files.reduce((sum, file) => sum + file.size, 0)
  announcement.value = `已选择 ${result.files.length} 个文件，总计 ${formatFileSize(bytes)}。`
}
function open() {
  if (disabled || !input.value) return
  input.value.value = '' // Selecting the same file again still fires change.
  input.value.click()
}
function changed(event: Event) {
  const element = event.target as HTMLInputElement
  chooseFiles(Array.from(element.files ?? []))
  element.value = ''
}
function remove(index: number) {
  if (disabled) return
  const file = model.value[index]
  if (!file) return
  const files = model.value.filter((_, position) => position !== index)
  commit(files)
  clearRejections()
  announcement.value = `已移除 ${file.name}，剩余 ${files.length} 个文件。`
  void nextTick(() => trigger.value?.focus({ preventScroll: true }))
}
function clear() {
  if (disabled) return
  commit([])
  clearRejections()
  if (input.value) input.value.value = ''
  announcement.value = '已清空文件选择。'
  void nextTick(() => trigger.value?.focus({ preventScroll: true }))
}
function hasFiles(event: DragEvent) { return Array.from(event.dataTransfer?.types ?? []).includes('Files') }
function dragEnter(event: DragEvent) { if (!disabled && hasFiles(event)) dragDepth.value++ }
function dragOver(event: DragEvent) {
  if (event.dataTransfer) event.dataTransfer.dropEffect = !disabled && hasFiles(event) ? 'copy' : 'none'
}
function dragLeave() { dragDepth.value = Math.max(0, dragDepth.value - 1) }
function drop(event: DragEvent) {
  dragDepth.value = 0
  if (disabled || !event.dataTransfer) return
  // Read directory entries only during drop; do not traverse users' folders.
  const hasDirectory = Array.from(event.dataTransfer.items).some((item) => item.webkitGetAsEntry?.()?.isDirectory)
  if (hasDirectory) {
    dropError.value = '暂不支持文件夹，请直接选择或拖入文件。'
    return
  }
  chooseFiles(Array.from(event.dataTransfer.files))
}
function validate() {
  if (!valid.value) trigger.value?.focus()
  return valid.value
}
defineExpose({ open, clear, validate, focus: (options?: FocusOptions) => trigger.value?.focus(options) })
</script>

<template>
  <div class="lab-file-picker" :class="{ 'is-dragging': dragDepth > 0, 'is-disabled': disabled, 'has-errors': !valid }"
    @dragenter.prevent="dragEnter" @dragover.prevent="dragOver" @dragleave.prevent="dragLeave" @drop.prevent.stop="drop">
    <!-- The native input only opens the system dialog; its browser UI stays hidden. -->
    <input ref="input" type="file" hidden tabindex="-1" aria-hidden="true"
      :accept="accept || undefined" :multiple="multiple" :disabled="disabled" @change="changed" />
    <button :id="triggerId" ref="trigger" type="button" class="lab-file-dropzone" :disabled="disabled"
      :aria-label="model.length ? (multiple ? '继续添加文件' : '更换文件') : label" :aria-describedby="`${hintId}${valid ? '' : ` ${errorId}`}`" :aria-invalid="!valid || undefined" @click="open">
      <span class="lab-file-mode" aria-hidden="true">{{ multiple ? 'MULTI FILE' : 'SINGLE FILE' }}</span>
      <span class="lab-file-upload-mark" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6" /></svg>
      </span>
      <strong>{{ dragDepth ? '松开以添加文件' : model.length ? (multiple ? '继续添加文件' : '更换文件') : label }}</strong>
      <span class="lab-file-drop-hint">点击浏览文件，或拖拽到此处</span>
    </button>
    <div :id="hintId" class="lab-file-hints">
      <p class="lab-file-types">{{ typeHint }}</p>
      <div class="lab-file-limits"><span v-for="constraint in constraints" :key="constraint">{{ constraint }}</span></div>
      <p v-if="description" class="lab-file-description">{{ description }}</p>
    </div>
    <div v-if="model.length || errors.length" class="lab-file-selection">
      <div class="lab-file-selection-heading">
        <span>已选 <b>{{ model.length }}</b> 个<span class="lab-file-total"> / {{ formatFileSize(totalSize) }}</span></span>
        <button type="button" class="lab-file-clear" :disabled="disabled" @click="clear">清空</button>
      </div>
      <ul v-if="model.length" class="lab-file-list" aria-label="已选文件">
        <li v-for="(file, index) in model" :key="`${fileKey(file)}-${index}`" class="lab-file-row" :class="{ 'is-invalid': invalidKeys.has(fileKey(file)) }">
          <span class="lab-file-document" aria-hidden="true"><svg width="17" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H5v20h14V7l-5-5Zm0 0v5h5M8 12h8m-8 4h6" /></svg></span>
          <span class="lab-file-info"><span class="lab-file-name" :title="file.name">{{ file.name }}</span><span class="lab-file-meta">{{ formatFileSize(file.size) }} · {{ file.type || '未标注类型' }}</span></span>
          <button type="button" class="lab-file-remove" :disabled="disabled" :aria-label="`移除 ${file.name}`" @click="remove(index)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button>
        </li>
      </ul>
    </div>
    <div v-if="errors.length" :id="errorId" class="lab-file-errors" role="alert">
      <div class="lab-file-error-heading"><LabIcon name="info" :size="14" /><strong>请调整文件选择</strong></div>
      <ul><li v-for="message in errors.slice(0, 5)" :key="message">{{ message }}</li></ul>
      <p v-if="errors.length > 5">另有 {{ errors.length - 5 }} 项未显示。</p>
      <button v-if="rejected.length || dropError" type="button" class="lab-file-dismiss" :disabled="disabled" @click="clearRejections">忽略未添加项</button>
    </div>
    <span class="lab-file-status" role="status" aria-live="polite">{{ announcement }}</span>
  </div>
</template>

<style scoped src="./file-picker.css" />
