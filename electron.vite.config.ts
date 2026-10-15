import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Strict Content Security Policy injected into the production renderer only.
// The dev server needs inline scripts and websockets for hot reload.
const PROD_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'"
].join('; ')

function cspPlugin(): Plugin {
  return {
    name: 'kss-csp',
    apply: 'build',
    transformIndexHtml(html: string) {
      return html.replace(
        '<!-- CSP -->',
        `<meta http-equiv="Content-Security-Policy" content="${PROD_CSP}" />`
      )
    }
  }
}

const shared = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: {
      rollupOptions: {
        external: ['node:sqlite']
      }
    }
  },
  preload: {
    resolve: { alias: shared }
  },
  renderer: {
    resolve: {
      alias: { ...shared, '@renderer': resolve(__dirname, 'src/renderer/src') }
    },
    plugins: [react(), tailwindcss(), cspPlugin()]
  }
})
