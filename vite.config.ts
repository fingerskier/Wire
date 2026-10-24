import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { fileURLToPath } from 'node:url'

// GramJS is a Node-first CommonJS package. In the browser its `crypto`
// import must point at the WebCrypto-backed shim it ships, and `net`/`fs`
// only need to exist. An alias (not a plugin hook) so dev pre-bundling
// gets the same mapping as the production build.
const gramCrypto = fileURLToPath(new URL('./node_modules/telegram/crypto/crypto.js', import.meta.url))

export default defineConfig({
  base: './',
  resolve: {
    alias: [{ find: /^crypto$/, replacement: gramCrypto }],
  },
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'os', 'util', 'path', 'process', 'events', 'net', 'tls', 'fs'],
      globals: { Buffer: true, process: true, global: true },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
})
