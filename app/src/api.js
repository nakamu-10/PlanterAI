const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL;
const DEVICE_KEY = import.meta.env.VITE_DEVICE_KEY;

// 鍵はブラウザに配れないので、本番の /app/ は鍵なしの app-public で見るだけにする。
// 鍵を使うのは手元の開発（app/.env）だけ（ADR 0006）
export const isPublicView = !DEVICE_KEY;
// どの鉢を見るか（/app/?pot=karami）。無ければカラ美
export const POT = new URLSearchParams(location.search).get("pot") ?? "karami";

async function readJson(res, name) {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      data?.error ?? `${name} の呼び出しに失敗しました (HTTP ${res.status})`,
    );
  }
  return data;
}

async function callFunction(name, body) {
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-device-key": DEVICE_KEY ?? "",
    },
    body: JSON.stringify(body),
  });
  return readJson(res, name);
}

export async function fetchDashboard() {
  if (isPublicView) {
    const res = await fetch(
      `${FUNCTIONS_URL}/app-public?pot=${encodeURIComponent(POT)}`,
    );
    return readJson(res, "app-public");
  }
  return callFunction("app-data", { action: "dashboard" });
}

export function updateSettings(patch) {
  return callFunction("app-data", { action: "update_settings", ...patch });
}

// 触ったことを記録し、あとの会話で触れられるようにする。鍵が無いときは記録しない（ADR 0007）
export function recordTouch(kind) {
  if (isPublicView) return Promise.resolve();
  return callFunction("app-data", { action: "touch", kind });
}

export function sendChatMessage(message) {
  return callFunction("app-chat", { message });
}
