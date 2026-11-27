import {
  SHEET_DRAG_PX,
  sheetExpandedAfterDrag,
  sheetMoreHeight,
} from "./sheet.logic.js";

// つまみを押すか上下に引くと、シートを広げたり戻したりする。初めて広げたときに onFirstOpen を呼ぶ
export function setupSheet({ sheet, handle, more, header, onFirstOpen }) {
  let expanded = false;
  let opened = false;
  const setExpanded = (next) => {
    if (next && !expanded) {
      // 閉じている今のシートの上端で測る
      const height = sheetMoreHeight({
        viewportHeight: innerHeight,
        sheetTop: sheet.getBoundingClientRect().top,
        headerBottom: header.getBoundingClientRect().bottom,
      });
      sheet.style.setProperty("--sheet-more", `${height}px`);
    }
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

  // 押している指。2本目の指や右ボタンでは動かさない
  let press = null;
  // 引いたあとに来る click で、もう一度切り替えないようにする
  let dragged = false;
  handle.addEventListener("pointerdown", (event) => {
    dragged = false;
    if (press || event.button !== 0) return;
    press = { pointerId: event.pointerId, startY: event.clientY };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointerup", (event) => {
    if (press?.pointerId !== event.pointerId) return;
    const dy = event.clientY - press.startY;
    press = null;
    dragged = Math.abs(dy) >= SHEET_DRAG_PX;
    if (dragged) setExpanded(sheetExpandedAfterDrag(expanded, dy));
  });
  handle.addEventListener("pointercancel", (event) => {
    if (press?.pointerId !== event.pointerId) return;
    press = null;
    dragged = false;
  });
  handle.addEventListener("click", () => {
    if (!dragged) setExpanded(!expanded);
    dragged = false;
  });
}
