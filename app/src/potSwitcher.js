import { POT } from "./api.js";
import { potMenuItems } from "./potMenu.logic.js";

// 画面を移っても、見ている鉢と ?demo・?debug を保つ
export function keepQueryOnLinks() {
  for (const link of document.querySelectorAll("a[data-keep-query]")) {
    link.search = location.search;
  }
}

// 見学会では鉢が3つ並ぶので、名前を押すと鉢の一覧を開けるようにする。
// 鉢が1つだけのとき（鍵ありの手元の開発も）は、名前はただの文字に見せる
export function renderPotSwitcher(button, menu, pots) {
  const items = potMenuItems(pots, POT, location.pathname, location.search);
  button.disabled = items.length === 0;
  if (button.disabled) setOpen(button, menu, false);
  menu.replaceChildren(...items.map((item) => {
    const link = document.createElement("a");
    link.className = "pot-menu__item";
    link.href = item.href;
    link.textContent = item.name;
    if (item.current) link.setAttribute("aria-current", "page");
    return link;
  }));
}

function setOpen(button, menu, open) {
  menu.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
}

export function setupPotMenu(button, menu) {
  const isInside = (target) => button.contains(target) || menu.contains(target);
  button.addEventListener("click", () => setOpen(button, menu, menu.hidden));
  // 一覧が開いている間に外を押したら、閉じるだけにする。部屋の小物やキャラに届くと、
  // 閉じたうえでページを移ったり、なでた反応が出たりする。
  // 部屋のステージは touchend を止めていて iPhone では click が来ないので、押した時で見る
  document.addEventListener("pointerdown", (event) => {
    if (menu.hidden || isInside(event.target)) return;
    event.stopPropagation();
    setOpen(button, menu, false);
  }, { capture: true });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || menu.hidden) return;
    setOpen(button, menu, false);
    button.focus();
  });
  // Tab・Shift+Tab で、ボタンと一覧の外へ出たら閉じる。行き先が無いとき（一覧の余白を
  // 押した、ウィンドウを切り替えた）は閉じない。外を押したときは pointerdown で閉じる
  for (const element of [button, menu]) {
    element.addEventListener("focusout", (event) => {
      const leaving = event.relatedTarget && !isInside(event.relatedTarget);
      if (leaving) setOpen(button, menu, false);
    });
  }
}
