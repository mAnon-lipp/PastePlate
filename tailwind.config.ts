import type { Config } from 'tailwindcss'

const withOpacity = (variable: string) => `rgb(var(${variable}) / <alpha-value>)`

export default <Partial<Config>>{
  theme: {
    extend: {
      colors: {
        canvas: withOpacity('--color-canvas'),
        surface: withOpacity('--color-surface'),
        ink: withOpacity('--color-ink'),
        muted: withOpacity('--color-muted'),
        accent: withOpacity('--color-accent'),
        'accent-strong': withOpacity('--color-accent-strong'),
        'accent-soft': withOpacity('--color-accent-soft'),
        border: withOpacity('--color-border'),
        'dark-canvas': withOpacity('--color-dark-canvas'),
        'dark-surface': withOpacity('--color-dark-surface'),
        'dark-border': withOpacity('--color-dark-border'),
        danger: withOpacity('--color-danger'),
        'danger-soft': withOpacity('--color-danger-soft'),
      },
    },
  },
}
