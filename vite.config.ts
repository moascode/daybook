import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Proxy API calls to the Node server (Phase 4 home-network backend).
    // Target is overridable so the e2e suite can point the dev server at its
    // own isolated API instance (different port) instead of the always-on
    // local/LAN server on 3001.
    proxy: {
      '/api': {
        target: process.env.DAYBOOK_API_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
