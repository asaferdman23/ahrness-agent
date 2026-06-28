import { defineConfig } from 'vite'

const backend = `http://localhost:${process.env.CALLBACK_PORT ?? 3456}`

export default defineConfig({
  root: 'frontend/onboarding',
  base: '/onboarding/',
  build: {
    outDir: '../../dist/onboarding',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: false,
    allowedHosts: ['.ngrok-free.dev'],
    proxy: {
      '/api': backend,
      '/oauth': backend,
      '/auth': backend,
      '/onboarding/qr-stream': backend,
    },
  },
})
