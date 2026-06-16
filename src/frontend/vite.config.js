import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Proxy API calls to the live backend during development. changeOrigin
      // rewrites the Host header so the HTTPS backend's SNI/vhost matches.
      '/api': {
        target: 'https://dns.diic-hpi.org',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
