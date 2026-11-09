import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Unique per deploy: Cloudflare Pages sets CF_PAGES_COMMIT_SHA; fall back to a
// build timestamp for local/other builds. Baked into the bundle as __BUILD_ID__
// and written to /version.json so the running app can detect a new deploy.
const buildId = process.env.CF_PAGES_COMMIT_SHA || String(Date.now())

// Emits /version.json (served alongside the app) containing the build id.
const emitVersion = () => ({
  name: 'emit-version-json',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: buildId }) })
  },
})

// https://vite.dev/config/
export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [react(), emitVersion()],
})
