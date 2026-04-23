import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // In dev, proxy /api to the backend. In production builds the frontend is
  // either served by the backend (same origin) or VITE_API_BASE_URL points
  // at the hosted backend (e.g. https://your-api.fly.dev).
  const backendTarget = env.VITE_API_BASE_URL || 'http://localhost:8000'

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
