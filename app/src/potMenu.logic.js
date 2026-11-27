// 名前の横の「∨」で開く、鉢の一覧（ADR 0020）。鉢が1つだけなら一覧は出さない
export function potMenuItems(pots, currentSlug, pathname, search) {
  if (!pots || pots.length < 2) return [];
  return pots.map((pot) => {
    // ?demo や ?debug は残し、鉢だけを替える
    const params = new URLSearchParams(search);
    params.set("pot", pot.slug);
    return {
      name: pot.name,
      href: `${pathname}?${params}`,
      current: pot.slug === currentSlug,
    };
  });
}

export function potCountLabel(pots) {
  return pots && pots.length >= 2 ? `${pots.length}鉢` : "";
}
