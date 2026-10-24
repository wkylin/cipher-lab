<script setup lang="ts">
import { computed } from 'vue'
import LabIcon from './LabIcon.vue'
import type { LabStepItem, LabStepStatus } from './lab-steps'

const {
  items,
  label = '流程步骤',
  direction = 'auto',
  tone = 'cyan',
} = defineProps<{
  items: readonly LabStepItem[]
  label?: string
  direction?: 'auto' | 'horizontal' | 'vertical'
  tone?: 'cyan' | 'amber'
}>()

type StepSlot = { item: LabStepItem; index: number; status: LabStepStatus }
defineSlots<{
  icon?: (props: StepSlot) => unknown
  title?: (props: StepSlot) => unknown
  description?: (props: StepSlot) => unknown
}>()

const labels: Record<LabStepStatus, string> = {
  waiting: '等待执行', active: '进行中', complete: '已完成', error: '已停止',
}
const steps = computed(() => items.map((item) => ({ ...item, status: item.status ?? 'waiting' })))
const announcement = computed(() => {
  const current = steps.value.findIndex((step) => step.status === 'error' || step.status === 'active')
  if (current !== -1) {
    const step = steps.value[current]!
    return `第 ${current + 1} 步，${step.title}，${labels[step.status]}`
  }
  if (steps.value.length && steps.value.every((step) => step.status === 'complete')) return '全部步骤已完成'
  return ''
})

function connectorStatus(index: number): LabStepStatus {
  const step = steps.value[index]
  const next = steps.value[index + 1]
  if (step?.status !== 'complete' || !next) return 'waiting'
  return next.status
}
</script>

<template>
  <div class="lab-steps" :data-direction="direction" :data-tone="tone">
    <div
      class="lab-steps-scroll"
      :tabindex="direction === 'horizontal' ? 0 : undefined"
      :role="direction === 'horizontal' ? 'region' : undefined"
      :aria-label="direction === 'horizontal' ? `${label}（可横向滚动）` : undefined"
    >
      <ol class="lab-steps-list" role="list" :aria-label="label" :style="{ '--step-count': Math.max(items.length, 1) }">
        <li
          v-for="(item, index) in steps" :key="item.id"
          class="lab-step" :data-status="item.status"
          :aria-current="item.status === 'active' || item.status === 'error' ? 'step' : undefined"
        >
          <span v-if="index < steps.length - 1" class="lab-step-connector" :data-status="connectorStatus(index)" aria-hidden="true">
            <span class="lab-step-track" />
            <span class="lab-step-arrow"><LabIcon name="arrow" :size="12" /></span>
          </span>
          <div class="lab-step-node" aria-hidden="true">
            <slot name="icon" :item="item" :index="index" :status="item.status">
              <LabIcon v-if="item.icon" :name="item.icon" :size="23" />
              <span v-else class="lab-step-index">{{ String(index + 1).padStart(2, '0') }}</span>
            </slot>
            <span v-if="item.status !== 'waiting'" class="lab-step-badge">
              <LabIcon v-if="item.status === 'complete'" name="check" :size="10" />
              <span v-else-if="item.status === 'error'" class="lab-step-error-mark">!</span>
              <span v-else class="lab-step-spinner" />
            </span>
          </div>
          <div class="lab-step-content">
            <span class="lab-step-caption"><span>{{ String(index + 1).padStart(2, '0') }}</span><template v-if="item.caption"><span class="lab-step-slash" aria-hidden="true">/</span>{{ item.caption }}</template></span>
            <span class="lab-step-title"><slot name="title" :item="item" :index="index" :status="item.status">{{ item.title }}</slot></span>
            <span class="lab-step-sr-only">{{ labels[item.status] }}</span>
            <p v-if="item.description || $slots.description" class="lab-step-description"><slot name="description" :item="item" :index="index" :status="item.status">{{ item.description }}</slot></p>
            <span v-if="item.status === 'active' || item.status === 'error'" class="lab-step-status" aria-hidden="true">{{ labels[item.status] }}</span>
          </div>
        </li>
      </ol>
    </div>
    <span class="lab-step-sr-only" role="status" aria-atomic="true">{{ announcement }}</span>
  </div>
</template>

<style scoped src="./steps.css"></style>
