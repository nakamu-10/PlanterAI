// 下のシートを引き上げて広げる（ADR 0020）。この長さより短い動きは、引いたとみなさない
export const SHEET_DRAG_PX = 30;

export function sheetExpandedAfterDrag(expanded, dy) {
  if (dy <= -SHEET_DRAG_PX) return true;
  if (dy >= SHEET_DRAG_PX) return false;
  return expanded;
}

// 広げて伸ばす高さ[px]。画面の半分まで。ただし、背の低い画面（横向きなど）でつまみが
// 上に重ねたヘッダーの下へ隠れないよう、閉じたシートの上端からヘッダーの下までに抑える
const HEADER_GAP_PX = 8;
export function sheetMoreHeight({ viewportHeight, sheetTop, headerBottom }) {
  const room = sheetTop - headerBottom - HEADER_GAP_PX;
  return Math.max(0, Math.min(viewportHeight / 2, room));
}
