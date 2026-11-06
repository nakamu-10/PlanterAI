import { POT } from "./api.js";

// 画面を移っても、見ている鉢と ?demo・?debug を保つ
export function keepQueryOnLinks() {
  for (const link of document.querySelectorAll("a[data-keep-query]")) {
    link.search = location.search;
  }
}

// 見学会では鉢が3つ並ぶので、ホームと数値の画面の上で鉢を選べるようにする。
// 鉢が1つだけのとき（鍵ありの手元の開発も）は出さない
export function renderPotSwitcher(nav, pots) {
  nav.hidden = !pots || pots.length < 2;
  if (nav.hidden) return;
  nav.replaceChildren(...pots.map((pot) => {
    const link = document.createElement("a");
    link.className = "pot-switcher__item";
    // ?demo や ?debug は残し、鉢だけを替える
    const params = new URLSearchParams(location.search);
    params.set("pot", pot.slug);
    link.href = `${location.pathname}?${params}`;
    link.textContent = pot.name;
    if (pot.slug === POT) {
      link.classList.add("is-active");
      link.setAttribute("aria-current", "page");
    }
    return link;
  }));
}
