const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL
const DEVICE_KEY = import.meta.env.VITE_DEVICE_KEY

async function callFunction(name, body) {
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-device-key': DEVICE_KEY ?? '',
    },
    body: JSON.stringify(body),
  })

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.error ?? `${name} の呼び出しに失敗しました (HTTP ${res.status})`)
  }
  return data
}

export function fetchDashboard() {
  return callFunction('app-data', { action: 'dashboard' })
}

export function updateSettings(patch) {
  return callFunction('app-data', { action: 'update_settings', ...patch })
}

export function sendChatMessage(message) {
  return callFunction('app-chat', { message })
}
