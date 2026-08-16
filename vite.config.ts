import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  /* Pages serves a project repo from https://daz029.github.io/quant-cardio/, so
     built asset URLs need that prefix. Only on build — the dev server stays at
     the root, where it is easier to reach. */
  base: command === 'build' ? '/quant-cardio/' : '/',
  plugins: [react()],
}))
