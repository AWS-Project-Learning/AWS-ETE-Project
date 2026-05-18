import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // BFF / orders / invoices
      '/api': {
        target: 'https://orderflow.gleeze.com',
        changeOrigin: true,
        secure: true,
      },
      // Security agent — goes straight to Lambda via ALB (bypasses BFF)
      '/security': {
        target: 'https://orderflow.gleeze.com',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
