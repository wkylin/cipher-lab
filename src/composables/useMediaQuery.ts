import { onMounted, onBeforeUnmount, readonly, ref } from 'vue'

/** Keep layout-dependent UI state in sync when rotating or resizing the viewport. */
export function useMediaQuery(query: string) {
  const media = typeof window === 'undefined' ? undefined : window.matchMedia(query)
  const matches = ref(media?.matches ?? false)
  const update = () => { matches.value = media?.matches ?? false }
  onMounted(() => { update(); media?.addEventListener('change', update) })
  onBeforeUnmount(() => media?.removeEventListener('change', update))
  return readonly(matches)
}
