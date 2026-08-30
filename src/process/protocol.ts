export const VITE_KIT_RUNTIME_READY = 'vite-kit:runtime-ready'
export const VITE_KIT_SHUTDOWN_REQUEST = 'vite-kit:shutdown-request'

export interface ViteKitProcessMessage {
  type: typeof VITE_KIT_RUNTIME_READY | typeof VITE_KIT_SHUTDOWN_REQUEST
}

export function isViteKitProcessMessage(value: unknown): value is ViteKitProcessMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) return false
  return value.type === VITE_KIT_RUNTIME_READY || value.type === VITE_KIT_SHUTDOWN_REQUEST
}
