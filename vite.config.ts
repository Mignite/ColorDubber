import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    // 127.0.0.1 explícito: con host:false vite quedaba solo en ::1 y los
    // clientes que resolvían localhost a 127.0.0.1 veían ventana en blanco
    // sin error en consola. Solo afecta a dev, nunca al release.
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      // Cuidado con agregar carpetas acá abajo: el watcher (chokidar) recorre
      // TODO el project root, y `diarization-benchmark/` tiene ~71k archivos
      // (casi todos de dos .venv de Python). Sin esto, el crawl inicial tardaba
      // minutos y el request del webview a devUrl caia en medio del crawl: se
      // colgaba y la ventana quedaba negra. El build de release no lo suffería
      // porque no hay dev server ni watcher.
      ignored: [
        "**/src-tauri/**",
        "**/diarization-benchmark/**",
        "**/.venv*/**",
        "**/__pycache__/**",
      ],
    },
  },
}));
