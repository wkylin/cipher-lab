<script setup lang="ts">
import { useTemplateRef } from 'vue'
import './text-control.css'

const { resize = 'vertical', invalid = false } = defineProps<{
  resize?: 'vertical' | 'none' | 'both'
  invalid?: boolean
}>()
const model = defineModel<string>({ required: true })
const textarea = useTemplateRef<HTMLTextAreaElement>('textarea')

defineExpose({
  focus: (options?: FocusOptions) => textarea.value?.focus(options),
  blur: () => textarea.value?.blur(),
  select: () => textarea.value?.select(),
})
</script>

<template>
  <!-- Keep native editing, rows, readonly, maxlength and accessibility attributes. -->
  <textarea ref="textarea" v-model="model"
    class="lab-text-control lab-textarea" :style="{ resize }"
    :aria-invalid="invalid || undefined" />
</template>
