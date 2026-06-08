import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-oxc'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
