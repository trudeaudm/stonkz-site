import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'app',
  base: '/app/',
  envDir: '..',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: '../dist/app',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
})
