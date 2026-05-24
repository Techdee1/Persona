import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'https://personabackend.duckdns.org',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, ''),
        secure: true,
      },
    },
  },
})
