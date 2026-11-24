// glb を作り直したら v を上げる。古い glb がキャッシュに残った端末で、
// 足した動きや部品が無くて 2D に落ちるため
const MODEL_VERSIONS = { karami: 3, cactus: 2, everfresh: 1, room: 1 };

export const modelUrl = (name) =>
  `${import.meta.env.BASE_URL}models/${name}.glb?v=${MODEL_VERSIONS[name]}`;
