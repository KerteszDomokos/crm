import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const localBrandDirectory = fileURLToPath(new URL('../../brand/', import.meta.url))

export default defineConfig({
  plugins: [react()],
  publicDir: existsSync(localBrandDirectory) ? localBrandDirectory : false,
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:3000',
        changeOrigin: false,
      },
      '/health': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
})
