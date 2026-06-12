/*
 * Ferrobase — Tauri-backed drop-in replacement for the Wails runtime module.
 *
 * The Ferrobase frontend imports event/runtime helpers from this module. Instead
 * of routing through window.runtime (Wails), we map them onto the Tauri v2
 * event system (@tauri-apps/api/event) and a couple of backend bridge calls.
 */

import { listen, emit } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'

// Registry mapping eventName -> Set of active unlisten functions so EventsOff
// can tear down every listener for a given event name.
const registry = new Map()

function register(eventName, unlisten) {
  let set = registry.get(eventName)
  if (!set) {
    set = new Set()
    registry.set(eventName, set)
  }
  set.add(unlisten)
  return () => {
    unlisten()
    const s = registry.get(eventName)
    if (s) {
      s.delete(unlisten)
      if (s.size === 0) registry.delete(eventName)
    }
  }
}

export function EventsOnMultiple(eventName, callback, maxCallbacks) {
  let unlistenFn = null
  let cancelled = false
  let count = 0
  // Holder so the wrapper can call the real unsubscribe once resolved.
  const holder = { off: () => {} }

  listen(eventName, (event) => {
    // Wails delivers the payload directly to the callback.
    callback(event.payload)
    count += 1
    if (typeof maxCallbacks === 'number' && maxCallbacks > 0 && count >= maxCallbacks) {
      holder.off()
    }
  })
    .then((fn) => {
      if (cancelled) {
        fn()
        return
      }
      unlistenFn = fn
      holder.off = register(eventName, fn)
    })
    .catch(() => {})

  holder.off = () => {
    cancelled = true
    if (unlistenFn) {
      const s = registry.get(eventName)
      if (s) s.delete(unlistenFn)
      unlistenFn()
      unlistenFn = null
    }
  }
  return () => holder.off()
}

export function EventsOn(eventName, callback) {
  return EventsOnMultiple(eventName, callback, -1)
}

export function EventsOnce(eventName, callback) {
  return EventsOnMultiple(eventName, callback, 1)
}

export function EventsOff(eventName, ...additionalEventNames) {
  const names = [eventName, ...additionalEventNames]
  for (const name of names) {
    const set = registry.get(name)
    if (set) {
      for (const fn of set) {
        try { fn() } catch { /* ignore */ }
      }
      registry.delete(name)
    }
  }
}

export function EventsOffAll() {
  for (const [, set] of registry) {
    for (const fn of set) {
      try { fn() } catch { /* ignore */ }
    }
  }
  registry.clear()
}

export function EventsEmit(eventName, ...data) {
  const payload = data.length === 0 ? undefined : (data.length === 1 ? data[0] : data)
  return emit(eventName, payload)
}

// ── Logging (route to console) ──────────────────────────────────────────────
export function LogPrint(message) { console.log(message) }
export function LogTrace(message) { console.trace(message) }
export function LogDebug(message) { console.debug(message) }
export function LogInfo(message) { console.info(message) }
export function LogWarning(message) { console.warn(message) }
export function LogError(message) { console.error(message) }
export function LogFatal(message) { console.error(message) }

// ── Environment ───────────────────────────────────────────────────────────
let _platform = 'unknown'
try {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || ''
  if (/Mac/i.test(ua)) _platform = 'darwin'
  else if (/Win/i.test(ua)) _platform = 'windows'
  else if (/Linux/i.test(ua)) _platform = 'linux'
} catch { /* ignore */ }

export function Environment() {
  return Promise.resolve({ buildType: 'production', platform: _platform, arch: 'unknown' })
}

export function BrowserOpenURL(url) {
  return invoke('bridge_call', { method: 'BrowserOpenURL', args: [url] }).catch(() => {})
}

export function Quit() { return invoke('bridge_call', { method: 'Quit', args: [] }).catch(() => {}) }
export function Hide() {}
export function Show() {}

// ── Window controls (no-ops; macOS uses native title bar) ───────────────────
export function WindowReload() { if (typeof window !== 'undefined') window.location.reload() }
export function WindowReloadApp() { if (typeof window !== 'undefined') window.location.reload() }
export function WindowSetAlwaysOnTop() {}
export function WindowSetSystemDefaultTheme() {}
export function WindowSetLightTheme() {}
export function WindowSetDarkTheme() {}
export function WindowCenter() {}
export function WindowSetTitle() {}
export function WindowFullscreen() {}
export function WindowUnfullscreen() {}
export function WindowIsFullscreen() { return Promise.resolve(false) }
export function WindowGetSize() { return Promise.resolve({ w: 0, h: 0 }) }
export function WindowSetSize() {}
export function WindowSetMaxSize() {}
export function WindowSetMinSize() {}
export function WindowSetPosition() {}
export function WindowGetPosition() { return Promise.resolve({ x: 0, y: 0 }) }
export function WindowHide() {}
export function WindowShow() {}
export function WindowMaximise() {}
export function WindowToggleMaximise() {}
export function WindowUnmaximise() {}
export function WindowIsMaximised() { return Promise.resolve(false) }
export function WindowMinimise() {}
export function WindowUnminimise() {}
export function WindowSetBackgroundColour() {}
export function ScreenGetAll() { return Promise.resolve([]) }
export function WindowIsMinimised() { return Promise.resolve(false) }
export function WindowIsNormal() { return Promise.resolve(true) }

// ── Clipboard ───────────────────────────────────────────────────────────────
export function ClipboardGetText() {
  try { return navigator.clipboard.readText() } catch { return Promise.resolve('') }
}
export function ClipboardSetText(text) {
  try { return navigator.clipboard.writeText(text).then(() => true).catch(() => false) }
  catch { return Promise.resolve(false) }
}

// ── File drop / notifications (unused stubs) ─────────────────────────────────
export function OnFileDrop() {}
export function OnFileDropOff() {}
export function CanResolveFilePaths() { return false }
export function ResolveFilePaths() { return [] }
export function InitializeNotifications() { return Promise.resolve() }
export function CleanupNotifications() { return Promise.resolve() }
export function IsNotificationAvailable() { return false }
export function RequestNotificationAuthorization() { return Promise.resolve(false) }
export function CheckNotificationAuthorization() { return Promise.resolve(false) }
export function SendNotification() { return Promise.resolve() }
export function SendNotificationWithActions() { return Promise.resolve() }
export function RegisterNotificationCategory() { return Promise.resolve() }
export function RemoveNotificationCategory() { return Promise.resolve() }
export function RemoveAllPendingNotifications() { return Promise.resolve() }
export function RemovePendingNotification() { return Promise.resolve() }
export function RemoveAllDeliveredNotifications() { return Promise.resolve() }
export function RemoveDeliveredNotification() { return Promise.resolve() }
export function RemoveNotification() { return Promise.resolve() }
