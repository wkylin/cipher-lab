<script setup lang="ts">
import { useId, useTemplateRef } from 'vue'
import LabIcon from './LabIcon.vue'

const { label, description, disabled = false } = defineProps<{
  label: string
  description?: string
  disabled?: boolean
}>()
const model = defineModel<boolean>({ required: true })
const emit = defineEmits<{ change: [checked: boolean] }>()
const uid = useId()
const labelId = `checkbox-label-${uid}`
const descriptionId = `checkbox-description-${uid}`
const control = useTemplateRef<HTMLButtonElement>('control')

function toggle() {
  if (disabled) return
  const checked = !model.value
  model.value = checked
  emit('change', checked)
}

defineExpose({
  focus: (options?: FocusOptions) => control.value?.focus(options),
  blur: () => control.value?.blur(),
})
</script>

<template>
  <!-- Space / Enter already trigger the button's click; no duplicate key handlers. -->
  <button ref="control" type="button" role="checkbox" class="lab-checkbox"
    :class="{ 'is-checked': model, 'has-description': description }"
    :disabled="disabled" :aria-checked="model"
    :aria-labelledby="labelId" :aria-describedby="description ? descriptionId : undefined"
    @click="toggle">
    <span class="lab-checkbox-box" aria-hidden="true">
      <LabIcon class="lab-checkbox-check" name="check" :size="14" />
    </span>
    <span class="lab-checkbox-content">
      <span :id="labelId" class="lab-checkbox-label">{{ label }}</span>
      <span v-if="description" :id="descriptionId" class="lab-checkbox-description">{{ description }}</span>
    </span>
  </button>
</template>

<style scoped>
.lab-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  min-height: 48px;
  max-width: 100%;
  margin: 0;
  padding: 8px 11px;
  border: 1px solid #263e51;
  border-radius: 6px;
  background: #0a1927;
  color: #9bb4c7;
  font: inherit;
  font-size: max(14px, var(--checkbox-font-size, 14px));
  line-height: 1.6;
  text-align: start;
  cursor: pointer;
  user-select: none;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition: background-color .16s ease, border-color .16s ease, color .16s ease;
}
.lab-checkbox:hover:where(:not(:disabled)) { background: #102636; border-color: #3c6177; color: #c8dfeb; }
.lab-checkbox.is-checked { background: #102b38; border-color: #2d5b6c; color: #b7eaf3; }
.lab-checkbox.is-checked:hover:where(:not(:disabled)) { background: #143443; border-color: #3a7386; }
.lab-checkbox:disabled { opacity: .45; cursor: not-allowed; }
.lab-checkbox:focus-visible { outline: none; outline-offset: 0; }
.lab-checkbox-box {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 20px;
  width: 20px;
  height: 20px;
  border: 1px solid #527188;
  border-radius: 4px;
  background: #071522;
  color: #082330;
  transition: background-color .16s ease, border-color .16s ease, box-shadow .16s ease;
}
.lab-checkbox.is-checked .lab-checkbox-box { background: var(--cyan, #58d9f4); border-color: var(--cyan, #58d9f4); }
.lab-checkbox:focus-visible .lab-checkbox-box { border-color: #ddfaff; box-shadow: inset 0 0 0 1px #ddfaff; }
.lab-checkbox:focus-visible .lab-checkbox-label { text-decoration: underline; text-underline-offset: 4px; }
.lab-checkbox-check { opacity: 0; transform: scale(.7); stroke-width: 2.5; transition: opacity .14s ease, transform .14s ease; }
.lab-checkbox.is-checked .lab-checkbox-check { opacity: 1; transform: scale(1); }
.lab-checkbox-content { display: block; min-width: 0; overflow-wrap: anywhere; }
.lab-checkbox-label { display: block; }
.lab-checkbox-description { display: block; margin-top: 3px; font-size: 12px; line-height: 1.7; color: #819eb3; }
.lab-checkbox.has-description { align-items: flex-start; }
.lab-checkbox.has-description .lab-checkbox-box { margin-top: 1px; }
@media (min-width: 1024px) and (pointer: fine) { .lab-checkbox { min-height: 40px; font-size: max(13px, var(--checkbox-font-size, 13px)); } }
@media (prefers-reduced-motion: reduce) { .lab-checkbox, .lab-checkbox-box, .lab-checkbox-check { transition: none; } }
@media (forced-colors: active) {
  .lab-checkbox { border-color: ButtonText; }
  .lab-checkbox-box { border-color: ButtonText; }
  .lab-checkbox.is-checked .lab-checkbox-box { background: Highlight; border-color: Highlight; color: HighlightText; forced-color-adjust: none; }
  .lab-checkbox:focus-visible .lab-checkbox-box { outline: 1px solid ButtonText; outline-offset: -3px; }
}
</style>
