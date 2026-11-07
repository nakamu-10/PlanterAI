import { defineConfig } from "vite";
import { resolve } from "path";

const root = import.meta.dirname;

export default defineConfig({
  base: "/app/",
  build: {
    outDir: resolve(root, "../site/dist/app"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        numbers: resolve(root, "numbers.html"),
        records: resolve(root, "records.html"),
        settings: resolve(root, "settings.html"),
      },
    },
  },
});
