import { defineConfig } from 'vite'
import { resolve } from 'path'

const root = import.meta.dirname

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        software: resolve(root, 'software.html'),
        hardware: resolve(root, 'hardware.html'),
        karami: resolve(root, 'karami.html'),
        team: resolve(root, 'team.html'),
        roadmap: resolve(root, 'roadmap.html'),
      },
    },
  },
})
