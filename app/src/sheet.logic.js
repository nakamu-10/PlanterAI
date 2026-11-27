// 下のシートを引き上げて広げる（ADR 0020）。この長さより短い動きは、引いたとみなさない
export const SHEET_DRAG_PX = 30;

export function sheetExpandedAfterDrag(expanded, dy) {
  if (dy <= -SHEET_DRAG_PX) return true;
  if (dy >= SHEET_DRAG_PX) return false;
  return expanded;
}

// 広げたシートには、最近の会話を新しい順に少しだけ出す。全部は記録のページで見る
export function recentTalk(rows, count = 5) {
  return [...(rows ?? [])]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, count);
}
