import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  build: {
    // Raise the warning threshold to account for the Three.js vendor chunk
    // (WebGPU renderer is legitimately large; the chunk itself is still lazy-loaded)
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Group dependencies into stable named chunks so browsers can cache them
        // across deployments even when app code changes.
        manualChunks(id) {
          // All Three.js modules → single lazy vendor chunk
          // (shared between HomeBackground and GameCanvas lazy chunks)
          if (id.includes('node_modules/three')) {
            return 'vendor-three';
          }
          // React ecosystem → separate vendor chunk (changes rarely)
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'vendor-react';
          }
          // React Router → separate vendor chunk
          if (id.includes('node_modules/react-router')) {
            return 'vendor-router';
          }
        },
      },
    },
  },
})
