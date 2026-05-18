import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The Function URL is injected at build time via VITE_AGENT_URL env var.
// In local dev: set it in .env.local
// In CI/CD:     the workflow reads it from SSM and exports it before build

export default defineConfig({
  plugins: [react()],
})
