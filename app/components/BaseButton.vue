<script setup lang="ts">
type ButtonVariant = 'primary' | 'dark' | 'surface' | 'danger' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

withDefaults(
  defineProps<{
    variant?: ButtonVariant
    size?: ButtonSize
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
  }>(),
  {
    variant: 'primary',
    size: 'md',
    type: 'button',
    disabled: false,
  }
)
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    class="inline-flex items-center justify-center font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
    :class="[
      {
        'rounded-xl px-4 py-2.5 text-xs': size === 'sm',
        'rounded-full px-5 py-3 text-sm': size === 'md',
        'rounded-full px-6 py-5 text-xl': size === 'lg',
      },
      {
        'bg-accent text-ink hover:bg-accent/85': variant === 'primary',
        'bg-ink text-surface hover:bg-ink/85': variant === 'dark',
        'bg-surface text-ink hover:bg-white': variant === 'surface',
        'border border-danger/50 bg-danger/10 text-danger hover:bg-danger/20': variant === 'danger',
        'text-muted hover:text-ink hover:underline': variant === 'ghost',
      },
    ]"
  >
    <slot />
  </button>
</template>
