// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },
  modules: ['@nuxtjs/tailwindcss', '@vite-pwa/nuxt'],
  css: ['~/assets/css/main.css'],
  nitro: {
    preset: 'vercel',
  },
  runtimeConfig: {
    geminiApiKey: process.env.GEMINI_API_KEY,
    apifyApiToken: process.env.APIFY_API_TOKEN,
  },
  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'PastePlate',
      short_name: 'PastePlate',
      description: 'Extrais et organise tes recettes TikTok et Instagram',
      theme_color: '#0a0a0a',
      background_color: '#0a0a0a',
      display: 'standalone',
      orientation: 'portrait',
      start_url: '/',
      icons: [
        {
          src: '/pwa-192x192.png',
          sizes: '192x192',
          type: 'image/png',
        },
        {
          src: '/pwa-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any maskable',
        },
      ],
      share_target: {
        action: '/',
        method: 'GET',
        params: {
          title: 'title',
          text: 'text',
          url: 'url',
        },
      },
    },
    workbox: {
      navigateFallback: undefined,
      globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
    },
  },
})