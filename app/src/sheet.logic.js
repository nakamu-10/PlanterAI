// 下のシートを引き上げて広げる（ADR 0020）。この長さより短い動きは、引いたとみなさない
export const SHEET_DRAG_PX = 30;

export function sheetExpandedAfterDrag(expanded, dy) {
  if (dy <= -SHEET_DRAG_PX) return true;
  if (dy >= SHEET_DRAG_PX) return false;
  return expanded;
}
