<script setup lang="ts" generic="T extends string | number">
import { computed, useId, useTemplateRef } from 'vue'
import { useSelect } from '../composables/useSelect'
import type { SelectOption } from './select-types'
import LabIcon from './LabIcon.vue'

const {
  options, label, id, disabled = false, size = 'default', tone = 'default',
  menuMinWidth = 180, placeholder = '请选择', name,
} = defineProps<{
  options: readonly SelectOption<T>[]
  label: string
  id?: string
  disabled?: boolean
  size?: 'default' | 'small'
  tone?: 'default' | 'accent'
  menuMinWidth?: number
  placeholder?: string
  name?: string
}>()
const model = defineModel<T>({ required: true })
const emit = defineEmits<{ change: [value: T] }>()
const uid = useId()
const triggerId = computed(() => id ?? `select-${uid}`)
const listId = `select-list-${uid}`
const trigger = useTemplateRef<HTMLButtonElement>('trigger')
const popup = useTemplateRef<HTMLDivElement>('popup')
const { opened, activeIndex, placement, popupStyle, selected, toggle, choose, hover, keydown } = useSelect({
  options: () => options,
  value: () => model.value,
  disabled: () => disabled,
  minWidth: () => menuMinWidth,
  trigger,
  popup,
  select(value) {
    if (model.value !== value) { model.value = value; emit('change', value) }
  },
})
const optionId = (index: number) => `${listId}-option-${index}`
defineExpose({ focus: () => trigger.value?.focus() })
</script>

<template>
  <div class="lab-select" :class="[`lab-select--${size}`, `lab-select--${tone}`, { 'is-open': opened, 'is-disabled': disabled }]">
    <input v-if="name" type="hidden" :name="name" :value="model" :disabled="disabled" />
    <button :id="triggerId" ref="trigger" type="button" class="lab-select-trigger" role="combobox"
      :disabled="disabled" :aria-label="label" aria-haspopup="listbox" :aria-expanded="opened"
      :aria-controls="opened ? listId : undefined"
      :aria-activedescendant="opened && activeIndex >= 0 ? optionId(activeIndex) : undefined"
      @click="toggle" @keydown="keydown">
      <span class="lab-select-value" :class="{ 'is-placeholder': !selected }">{{ selected?.label ?? placeholder }}</span>
      <svg class="lab-select-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <!-- Teleport escapes panels with overflow:hidden. Focus stays on the combobox above. -->
    <Teleport to="body">
      <Transition name="lab-select-pop">
        <div v-if="opened" ref="popup" class="lab-select-menu" :data-placement="placement" :style="popupStyle">
          <div class="lab-select-menu-heading" aria-hidden="true"><span>{{ label }}</span><span>{{ options.length }} 项</span></div>
          <ul :id="listId" class="lab-select-list" role="listbox" :aria-label="label">
            <li v-for="(option, index) in options" :id="optionId(index)" :key="option.value" role="option"
              :data-select-index="index" :aria-label="option.label" :aria-selected="option.value === model" :aria-disabled="option.disabled || undefined"
              :aria-describedby="option.description ? `${optionId(index)}-description` : undefined"
              class="lab-select-option" :class="{ 'is-selected': option.value === model, 'is-active': index === activeIndex, 'is-disabled': option.disabled }"
              @pointermove="hover(index, $event)" @mousedown.prevent @click="choose(index)">
              <span class="lab-select-option-text"><span class="lab-select-option-label">{{ option.label }}</span><span v-if="option.description" :id="`${optionId(index)}-description`" class="lab-select-description">{{ option.description }}</span></span>
              <span class="lab-select-check" aria-hidden="true"><LabIcon v-if="option.value === model" name="check" :size="15" /></span>
            </li>
          </ul>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
:where(.lab-select) { width: 100%; min-width: 0; }
.lab-select-trigger { width: 100%; min-height: max(48px, var(--select-height, 48px)); min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px var(--select-padding-x, 12px); border: 1px solid #30465c; border-radius: 6px; background: #081724; color: #b4ccdc; text-align: left; font: max(16px, var(--select-font-size, 16px))/1.5 var(--mono); touch-action: manipulation; -webkit-tap-highlight-color: transparent; cursor: pointer; box-shadow: inset 0 1px 0 #ffffff03; transition: border-color .16s, box-shadow .16s, background .16s; }
.lab-select-trigger:hover:not(:disabled) { background: #102336; border-color: #4b7087; }
.lab-select-trigger:focus-visible { outline: 2px solid #58d9f4; outline-offset: 3px; }
.lab-select.is-open .lab-select-trigger { border-color: #52b7d0; background: #0d2435; box-shadow: 0 0 0 3px #58d9f410; }
.lab-select--accent .lab-select-value { color: #70d6ec; font-weight: 600; }
.lab-select-value { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.lab-select-value.is-placeholder { color: #6f8ba2; }
.lab-select-chevron { color: #7097ad; transition: transform .18s, color .18s; flex-shrink: 0; }
.lab-select.is-open .lab-select-chevron { transform: rotate(180deg); color: #58d9f4; }
.lab-select-trigger:disabled { opacity: .45; cursor: not-allowed; }
.lab-select--small .lab-select-trigger { min-height: max(44px, var(--select-height, 44px)); padding: 9px var(--select-padding-x, 10px); font-size: max(14px, var(--select-font-size, 14px)); }
.lab-select-menu { position: fixed; box-sizing: border-box; z-index: 1000; display: flex; flex-direction: column; overflow: hidden; border: 1px solid #3c6077; border-radius: 9px; background: linear-gradient(155deg, #12273a, #0c1c2d 75%); color: #c1d4e2; box-shadow: 0 18px 50px #02081299, 0 3px 12px #02081288, inset 0 1px 0 #83d9f41a; transform-origin: top center; }
.lab-select-menu[data-placement=top] { transform-origin: bottom center; }
.lab-select-menu-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-shrink: 0; padding: 10px 12px 9px; border-bottom: 1px solid #274052; font: 12px/1.5 'Avenir Next', 'PingFang SC', 'Microsoft YaHei', sans-serif; color: #91adbf; }
.lab-select-menu-heading > span:first-child { min-width: 0; overflow-wrap: anywhere; }
.lab-select-menu-heading > span:last-child { flex-shrink: 0; font: 11px var(--mono); color: #829fb2; }
.lab-select-list { margin: 0; padding: 5px; list-style: none; min-height: 0; overflow: auto; overscroll-behavior: contain; touch-action: pan-y; scrollbar-width: thin; scrollbar-color: #36576c transparent; }
.lab-select-option { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 16px; box-sizing: border-box; min-height: 48px; margin: 2px 0; padding: 10px 12px; touch-action: pan-y; border: 1px solid transparent; border-radius: 5px; cursor: pointer; user-select: none; }
.lab-select-option.is-active { background: #1b374b; border-color: #385a71; }
.lab-select-option.is-selected { background: #123747; color: #7ee0f3; }
.lab-select-option.is-selected::before { content: ''; position: absolute; left: -1px; top: 10px; bottom: 10px; width: 2px; border-radius: 3px; background: #58d9f4; }
.lab-select-option.is-selected.is-active { border-color: #39798d; background: #174252; }
.lab-select-option.is-disabled { opacity: .38; cursor: not-allowed; }
.lab-select-option-text { min-width: 0; }
.lab-select-option-label { display: block; font: 16px/1.5 var(--mono); overflow-wrap: anywhere; }
.lab-select-description { display: block; color: #83a2b8; font: 13px/1.6 'Avenir Next', 'PingFang SC', 'Microsoft YaHei', sans-serif; margin-top: 2px; overflow-wrap: anywhere; }
.lab-select-option.is-selected .lab-select-description { color: #8fbfce; }
.lab-select-check { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 16px; color: #68d8ef; }
.lab-select-pop-enter-active { transition: opacity .12s ease, transform .12s ease; }
.lab-select-pop-leave-active { transition: none; pointer-events: none; }
.lab-select-pop-enter-from, .lab-select-pop-leave-to { opacity: 0; transform: translateY(-3px) scale(.98); }
.lab-select-menu[data-placement=top].lab-select-pop-enter-from, .lab-select-menu[data-placement=top].lab-select-pop-leave-to { transform: translateY(3px) scale(.98); }
@media (min-width: 1024px) and (pointer: fine) {
  .lab-select-trigger { min-height: max(40px, var(--select-height, 40px)); padding-block: 8px; font-size: max(13px, var(--select-font-size, 13px)); }
  .lab-select--small .lab-select-trigger { min-height: max(36px, var(--select-height, 36px)); padding-block: 7px; font-size: max(12px, var(--select-font-size, 12px)); }
  .lab-select-option { min-height: 40px; padding-block: 8px; }
  .lab-select-option-label { font-size: 13px; }
  .lab-select-description { font-size: 12px; }
}
@media (prefers-reduced-motion: reduce) { .lab-select-trigger, .lab-select-chevron, .lab-select-pop-enter-active, .lab-select-pop-leave-active { transition: none; } }
</style>
