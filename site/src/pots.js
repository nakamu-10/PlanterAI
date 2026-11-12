// app-public の答えから、公開している鉢の名前（public_slug）を取り出す
export function publicSlugs(body) {
  if (!Array.isArray(body?.pots)) return new Set();
  return new Set(
    body.pots
      .map((pot) => pot?.slug)
      .filter((slug) => typeof slug === "string" && slug !== ""),
  );
}

// 公開していない鉢へ飛ぶと、アプリが「見つからない」になる。
// 公開中の鉢を app-public に聞き、無い鉢はリンクにせず「準備中」にする。
// 一覧だけを返す入口は無いので、いつも公開しているカラ美の答えから一覧を読む
export async function setupPotChooser(functionsUrl) {
  const cards = document.querySelectorAll(".pot-card[data-pot]");
  if (cards.length === 0 || !functionsUrl) return;
  let open;
  try {
    const response = await fetch(`${functionsUrl}/app-public?pot=karami`);
    if (!response.ok) return;
    open = publicSlugs(await response.json());
  } catch {
    // 読めなければ、HTML に書いたまま（カラ美だけ開いている）にする
    return;
  }
  for (const card of cards) {
    const slug = card.dataset.pot;
    const isOpen = open.has(slug);
    card.classList.toggle("is-soon", !isOpen);
    if (isOpen) card.setAttribute("href", `/app/?pot=${slug}`);
    else card.removeAttribute("href");
    card.querySelector(".pot-card__status").textContent = isOpen
      ? "様子を見る"
      : "準備中";
  }
}
