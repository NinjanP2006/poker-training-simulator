import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The core worker imports the WebAssembly glue as an ES module.
  worker: { format: 'es' },
})
