import { SHEET_DRAG_PX, sheetExpandedAfterDrag } from "./sheet.logic.js";

// つまみを押すか上下に引くと、シートを広げたり戻したりする。初めて広げたときに onFirstOpen を呼ぶ
export function setupSheet({ sheet, handle, more, onFirstOpen }) {
  let expanded = false;
  let opened = false;
  const setExpanded = (next) => {
    expanded = next;
    sheet.classList.toggle("is-expanded", expanded);
    handle.setAttribute("aria-expanded", String(expanded));
    // 閉じている間は、隠れたリンクに Tab で入らないようにする
    more.inert = !expanded;
    if (expanded && !opened) {
      opened = true;
      onFirstOpen();
    }
  };
  setExpanded(false);

  let startY = null;
  // 引いたあとに来る click で、もう一度切り替えないようにする
  let dragged = false;
  handle.addEventListener("pointerdown", (event) => {
    startY = event.clientY;
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointerup", (event) => {
    if (startY === null) return;
    const dy = event.clientY - startY;
    startY = null;
    dragged = Math.abs(dy) >= SHEET_DRAG_PX;
    if (dragged) setExpanded(sheetExpandedAfterDrag(expanded, dy));
  });
  handle.addEventListener("pointercancel", () => {
    startY = null;
  });
  handle.addEventListener("click", () => {
    if (!dragged) setExpanded(!expanded);
    dragged = false;
  });
}
