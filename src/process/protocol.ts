export const VITE_LINK_RUNTIME_READY = 'vite-link:runtime-ready'
export const VITE_LINK_SHUTDOWN_REQUEST = 'vite-link:shutdown-request'

export interface ViteLinkProcessMessage {
  type: typeof VITE_LINK_RUNTIME_READY | typeof VITE_LINK_SHUTDOWN_REQUEST
}

export function isViteLinkProcessMessage(value: unknown): value is ViteLinkProcessMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) return false
  return value.type === VITE_LINK_RUNTIME_READY || value.type === VITE_LINK_SHUTDOWN_REQUEST
}
