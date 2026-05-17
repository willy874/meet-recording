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
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
})
