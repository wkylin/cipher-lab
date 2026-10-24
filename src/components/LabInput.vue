<script setup lang="ts" generic="T extends string | number">
import { useTemplateRef } from 'vue'
import './text-control.css'

const { type = 'text', size = 'default', invalid = false } = defineProps<{
  type?: 'text' | 'password' | 'email' | 'number' | 'tel' | 'search' | 'url'
  size?: 'default' | 'small'
  invalid?: boolean
}>()
const model = defineModel<T, 'number'>({ required: true })
const input = useTemplateRef<HTMLInputElement>('input')

defineExpose({
  focus: (options?: FocusOptions) => input.value?.focus(options),
  blur: () => input.value?.blur(),
  select: () => input.value?.select(),
})
</script>

<template>
  <!-- Native v-model preserves IME composition and number input behavior.
       A single native root forwards attributes and DOM events to the field. -->
  <input ref="input" v-model="model" :type="type"
    class="lab-text-control lab-input" :class="`lab-input--${size}`"
    :aria-invalid="invalid || undefined" />
</template>
