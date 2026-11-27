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
  menu.replaceChildren(...items.map((item) => {
    const link = document.createElement("a");
    link.className = "pot-menu__item";
    link.href = item.href;
    link.textContent = item.name;
    if (item.current) link.setAttribute("aria-current", "page");
    return link;
  }));
}

export function setupPotMenu(button, menu) {
  const open = (next) => {
    menu.hidden = !next;
    button.setAttribute("aria-expanded", String(next));
  };
  button.addEventListener("click", () => open(menu.hidden));
  // 部屋のステージは touchend を止めていて iPhone では click が来ないので、押した時で閉じる
  document.addEventListener("pointerdown", (event) => {
    const inside = button.contains(event.target) ||
      menu.contains(event.target);
    if (!menu.hidden && !inside) open(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") open(false);
  });
}
