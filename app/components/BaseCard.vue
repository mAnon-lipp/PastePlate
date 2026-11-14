<script setup lang="ts">
type CardTone = 'surface' | 'soft' | 'dark'

withDefaults(
  defineProps<{
    tone?: CardTone
    padding?: 'none' | 'sm' | 'md' | 'lg'
  }>(),
  {
    tone: 'surface',
    padding: 'md',
  }
)
</script>

<template>
  <div
    :class="[
      {
        'bg-surface text-ink': tone === 'surface',
        'bg-accent-soft/35 text-ink': tone === 'soft',
        'border border-dark-border bg-dark-surface/70 text-surface': tone === 'dark',
      },
      {
        'p-0': padding === 'none',
        'p-3': padding === 'sm',
        'p-5': padding === 'md',
        'p-8': padding === 'lg',
      },
    ]"
  >
    <slot />
  </div>
</template>
