/*
 * Ferrobase — Tauri IPC bridge installer.
 *
 * The Ferrobase frontend talks to its Go backend through the Wails-injected
 * `window.go.main.App.<Method>(...)` object. We polyfill that object with a
 * Proxy so every method call is forwarded to the Rust backend through a single
 * generic Tauri command, `bridge_call(method, args)`. This keeps the entire
 * frontend (bridge.js + generated bindings) working unchanged.
 *
 * Argument order is preserved exactly as the generated Wails bindings pass it,
 * so the Rust dispatcher can deserialize positional args the same way.
 */

import { invoke } from '@tauri-apps/api/core'

function makeAppProxy() {
  return new Proxy(Object.create(null), {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined
      return (...args) => invoke('bridge_call', { method: prop, args })
    },
    has() {
      return true
    },
  })
}

if (typeof window !== 'undefined') {
  const appProxy = makeAppProxy()
  // Mirror the Wails object shape so isWails() checks and generated bindings
  // (window['go']['main']['App'][name]) resolve to our proxy.
  window.go = window.go || {}
  window.go.main = window.go.main || {}
  window.go.main.App = appProxy
}

export {}
