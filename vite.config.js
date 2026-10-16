import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
  server: {
    // Fail loudly if 5173 is taken: the launchers always open 5173, so drifting to 5174 would
    // leave the browser on whatever stale server still holds it.
    port: 5173,
    strictPort: true,
    // Loopback only. `host: true` (or `0.0.0.0`) would publish the dev server — and, through
    // the proxy, the API — on every interface. The name `localhost` (not a single address) is
    // what the launchers open; Vite resolves it to the loopback address this machine uses.
    host: 'localhost',
    proxy: {
      // 127.0.0.1, not "localhost". Node 17+ resolves that name to ::1 first, and a proxy
      // that follows it would miss an IPv4 bind (or the reverse). The API listens on both
      // loopback addresses; the proxy is pinned to the one that always exists.
      '/api': 'http://127.0.0.1:3001',
    },
  },
  preview: {
    // Preview does not reliably inherit server.host. Keep the built app on loopback too,
    // and send /api to the same IPv4 loopback target as the dev proxy.
    host: 'localhost',
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
})
