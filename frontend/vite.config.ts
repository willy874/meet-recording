import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendPort = process.env.MEET_BACKEND_PORT ?? '7001'
const frontendPort = Number(process.env.MEET_FRONTEND_PORT ?? '7002')

export default defineConfig({
  plugins: [react()],
  server: {
    port: frontendPort,
    strictPort: true,
    proxy: {
      '/api': {
        // 127.0.0.1, not localhost: the backend binds IPv4 loopback only, and
        // localhost may resolve to ::1 first.
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
})
