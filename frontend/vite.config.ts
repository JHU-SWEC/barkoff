import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // backend/server.py runs separately: scoring over HTTP on 8000, the duel socket on 8001.
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8001', ws: true },
    },
  },
})
