import { defineConfig } from 'vite'
import { resolve } from 'path'

const root = import.meta.dirname

export default defineConfig({
  base: '/app/',
  build: {
    outDir: resolve(root, '../site/dist/app'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        chat: resolve(root, 'chat.html'),
        karami: resolve(root, 'karami.html'),
      },
    },
  },
})
