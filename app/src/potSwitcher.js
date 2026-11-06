import { POT } from "./api.js";

// 見学会では鉢が3つ並ぶので、ホームと数値の画面の上で鉢を選べるようにする。
// 鉢が1つだけのとき（鍵ありの手元の開発も）は出さない
export function renderPotSwitcher(nav, pots) {
  nav.hidden = !pots || pots.length < 2;
  if (nav.hidden) return;
  nav.replaceChildren(...pots.map((pot) => {
    const link = document.createElement("a");
    link.className = "pot-switcher__item";
    link.href = `${location.pathname}?pot=${encodeURIComponent(pot.slug)}`;
    link.textContent = pot.name;
    if (pot.slug === POT) {
      link.classList.add("is-active");
      link.setAttribute("aria-current", "page");
    }
    return link;
  }));
}
