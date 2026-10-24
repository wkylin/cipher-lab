import { computed, nextTick, onBeforeUnmount, readonly, ref, shallowRef, watch, type CSSProperties, type Ref } from 'vue'
import type { SelectOption } from '../components/select-types'

interface SelectController<T extends string | number> {
  options: () => readonly SelectOption<T>[]
  value: () => T
  disabled: () => boolean
  minWidth: () => number
  trigger: Readonly<Ref<HTMLButtonElement | null>>
  popup: Readonly<Ref<HTMLDivElement | null>>
  select: (value: T) => void
}

/** Select-only combobox: keyboard focus stays on the trigger, not in the teleported list. */
export function useSelect<T extends string | number>(config: SelectController<T>) {
  const opened = ref(false)
  const activeIndex = ref(-1)
  const placement = ref<'top' | 'bottom'>('bottom')
  const popupStyle = shallowRef<CSSProperties>({ visibility: 'hidden' })
  const selected = computed(() => config.options().find(option => option.value === config.value()))
  const enabled = computed(() => config.options().flatMap((option, index) => option.disabled ? [] : [index]))
  let search = ''
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let frame = 0
  let observer: ResizeObserver | undefined
  let disposed = false

  function close() {
    opened.value = false
    search = ''
    clearTimeout(searchTimer)
    removeListeners()
  }

  function position() {
    const trigger = config.trigger.value
    const popup = config.popup.value
    if (!opened.value || !trigger || !popup) return
    const rect = trigger.getBoundingClientRect()
    const viewport = window.visualViewport
    const leftEdge = viewport?.offsetLeft ?? 0
    const topEdge = viewport?.offsetTop ?? 0
    const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth)
    const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight)
    if (rect.bottom < topEdge || rect.top > bottomEdge || rect.right < leftEdge || rect.left > rightEdge) {
      close()
      return
    }
    const margin = 8
    const gap = 6
    const width = Math.min(Math.max(rect.width, config.minWidth()), rightEdge - leftEdge - margin * 2)
    const list = popup.querySelector<HTMLElement>('[role="listbox"]')
    const heading = popup.querySelector<HTMLElement>('.lab-select-menu-heading')
    const desiredHeight = Math.min(344, (list?.scrollHeight ?? 280) + (heading?.offsetHeight ?? 44) + 2)
    const below = bottomEdge - rect.bottom - gap - margin
    const above = rect.top - topEdge - gap - margin
    const flip = below < desiredHeight && above > below
    const maxHeight = Math.max(0, Math.min(344, flip ? above : below))
    placement.value = flip ? 'top' : 'bottom'
    popupStyle.value = {
      width: `${width}px`,
      maxHeight: `${maxHeight}px`,
      left: `${Math.max(leftEdge + margin, Math.min(rect.left, rightEdge - width - margin))}px`,
      top: flip ? undefined : `${rect.bottom + gap}px`,
      // Anchor upward menus by their bottom edge, even when descriptions wrap.
      bottom: flip ? `${window.innerHeight - rect.top + gap}px` : undefined,
      visibility: 'visible',
    }
  }

  function schedulePosition() {
    if (frame) return
    frame = requestAnimationFrame(() => { frame = 0; position() })
  }
  function onScroll(event: Event) {
    if (event.target instanceof Node && config.popup.value?.contains(event.target)) return
    schedulePosition()
  }
  function onOutside(event: Event) {
    const target = event.target
    if (target instanceof Node && (config.trigger.value?.contains(target) || config.popup.value?.contains(target))) return
    close()
  }
  function addListeners() {
    document.addEventListener('pointerdown', onOutside, true)
    document.addEventListener('focusin', onOutside, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', schedulePosition)
    window.addEventListener('blur', close)
    window.visualViewport?.addEventListener('resize', schedulePosition)
    window.visualViewport?.addEventListener('scroll', schedulePosition)
    observer = new ResizeObserver(schedulePosition)
    if (config.trigger.value) observer.observe(config.trigger.value)
  }
  function removeListeners() {
    document.removeEventListener('pointerdown', onOutside, true)
    document.removeEventListener('focusin', onOutside, true)
    window.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', schedulePosition)
    window.removeEventListener('blur', close)
    window.visualViewport?.removeEventListener('resize', schedulePosition)
    window.visualViewport?.removeEventListener('scroll', schedulePosition)
    observer?.disconnect()
    observer = undefined
    cancelAnimationFrame(frame)
    frame = 0
  }
  async function revealActive() {
    await nextTick()
    if (disposed || !opened.value) return
    // Scroll only the option list; scrollIntoView could move the surrounding page.
    const option = config.popup.value?.querySelector<HTMLElement>(`[data-select-index="${activeIndex.value}"]`)
    const list = option?.parentElement
    if (!option || !list) return
    const itemRect = option.getBoundingClientRect()
    const listRect = list.getBoundingClientRect()
    if (itemRect.top < listRect.top) list.scrollTop -= listRect.top - itemRect.top
    else if (itemRect.bottom > listRect.bottom) list.scrollTop += itemRect.bottom - listRect.bottom
  }
  async function open() {
    if (opened.value || config.disabled() || !enabled.value.length) return
    activeIndex.value = config.options().findIndex(option => option.value === config.value() && !option.disabled)
    if (activeIndex.value < 0) activeIndex.value = enabled.value[0]!
    popupStyle.value = { visibility: 'hidden' }
    opened.value = true
    addListeners()
    await nextTick()
    if (disposed || !opened.value) return
    position()
    await nextTick() // Re-measure once after the popup's final width is applied.
    if (disposed || !opened.value) return
    position()
    await revealActive()
  }
  function toggle() { if (opened.value) close(); else void open() }
  function choose(index: number, restoreFocus = true) {
    const option = config.options()[index]
    if (!opened.value || !option || option.disabled || config.disabled()) return
    config.select(option.value)
    close()
    if (restoreFocus) config.trigger.value?.focus({ preventScroll: true })
  }
  function move(step: number) {
    const current = enabled.value.indexOf(activeIndex.value)
    const next = Math.max(0, Math.min(enabled.value.length - 1, current + step))
    activeIndex.value = enabled.value[next] ?? -1
    void revealActive()
  }
  function hover(index: number, event: PointerEvent) {
    if (event.pointerType === 'mouse' && !config.options()[index]?.disabled) activeIndex.value = index
  }
  function typeAhead(key: string) {
    clearTimeout(searchTimer)
    search += key.toLocaleLowerCase()
    searchTimer = setTimeout(() => { search = '' }, 650)
    const query = [...search].every(char => char === search[0]) ? search[0]! : search
    const from = enabled.value.indexOf(activeIndex.value)
    const ordered = query.length === 1
      ? [...enabled.value.slice(from + 1), ...enabled.value.slice(0, from + 1)]
      : enabled.value
    const match = ordered.find(index => config.options()[index]!.label.toLocaleLowerCase().startsWith(query))
    if (match !== undefined) { activeIndex.value = match; void revealActive() }
  }
  function keydown(event: KeyboardEvent) {
    if (config.disabled() || event.isComposing) return
    if (event.key === 'Tab') { if (opened.value) choose(activeIndex.value, false); return }
    if (event.key === 'Escape') {
      if (opened.value) { event.preventDefault(); event.stopPropagation(); close() }
      return
    }
    if (event.altKey && event.key === 'ArrowUp') {
      if (opened.value) { event.preventDefault(); choose(activeIndex.value) }
      return
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      if (event.key === 'Enter' || event.key === ' ') {
        if (opened.value) choose(activeIndex.value); else void open()
        return
      }
      const wasOpen = opened.value
      if (!wasOpen) void open()
      if (event.key === 'Home') activeIndex.value = enabled.value[0] ?? -1
      else if (event.key === 'End') activeIndex.value = enabled.value.at(-1) ?? -1
      else if (wasOpen && !event.altKey) move(event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : event.key === 'PageDown' ? 10 : -10)
      void revealActive()
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      if (!opened.value) void open()
      typeAhead(event.key)
    }
  }

  watch(config.disabled, disabled => { if (disabled) close() })
  watch([config.value, config.options], () => {
    if (!opened.value) return
    if (!enabled.value.length) { close(); return }
    activeIndex.value = config.options().findIndex(option => option.value === config.value() && !option.disabled)
    if (activeIndex.value < 0) activeIndex.value = enabled.value[0]!
    schedulePosition()
    void revealActive()
  }, { deep: true })
  onBeforeUnmount(() => { disposed = true; close() })
  return { opened: readonly(opened), activeIndex: readonly(activeIndex), placement: readonly(placement), popupStyle: readonly(popupStyle), selected, toggle, choose, hover, keydown }
}
