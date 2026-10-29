import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The likeness scorer (backend/server.py) runs separately on port 8000.
  server: { proxy: { '/api': 'http://localhost:8000' } },
})
