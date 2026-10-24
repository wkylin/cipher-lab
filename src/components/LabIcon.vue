<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 })
const paths: Record<string, string> = {
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M6 10h12v11H6zM12 14v3',
  unlock: 'M7 10V7a5 5 0 0 1 9-3M6 10h12v11H6zM12 14v3',
  code: 'm8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18',
  send: 'm3 3 19 9-19 9 4-9-4-9Zm4 9h15',
  wire: 'M2 12h20M7 7l-5 5 5 5m10-10 5 5-5 5',
  window: 'M3 4h18v16H3zM3 9h18M7 6.5h.01M10 6.5h.01M7 13h7m-7 3h10',
  copy: 'M8 8h12v13H8zM16 8V3H3v13h5',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  check: 'm5 12 4 4L19 6',
  book: 'M12 5v16M12 5C8 2 4 3 2 4v15c3-1 6-1 10 2 4-3 7-3 10-2V4c-2-1-6-2-10 1Z',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  clock: 'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2',
  info: 'M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
}
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="paths[name] || paths.code" />
  </svg>
</template>
