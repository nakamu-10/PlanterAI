import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const MODEL_URL = `${import.meta.env.BASE_URL}models/karami.glb`

// 気分ごとのしおれ具合（0=元気、1=ぐったり）。土の水分と連動させるまでの仮の対応
const WILT_BY_EMOTION = {
  '満足': 0,
  '軽い不満': 0.25,
  '不満': 0.5,
  '不安': 0.7,
  '苛立ち': 0.85,
}

const MAX_DROOP = 1.3 // 葉が最大で垂れる角度（rad）

export async function createKarami(container) {
  // 読み込みに失敗したら、画面に何も足さずに投げる（呼び出し側が 2D 版に切り替える）
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL)

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20)
  camera.position.set(0, 0.55, 2.3)
  camera.lookAt(0, 0.47, 0)

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8d8a8, 2.2))
  const sun = new THREE.DirectionalLight(0xffffff, 1.6)
  sun.position.set(1, 2, 2)
  scene.add(sun)

  const model = gltf.scene
  const pivot = new THREE.Group() // 全体の揺れやつつきは、ここを動かす
  pivot.add(model)
  scene.add(pivot)

  const head = model.getObjectByName('Head')
  const mouth = model.getObjectByName('Mouth')
  const eyes = ['Eye_L', 'Eye_R'].map((n) => model.getObjectByName(n))
  const leaves = [...collectLeaves(model, 'Leaves'), ...collectLeaves(model, 'Cape')]

  let wilt = 0
  let targetWilt = 0
  const clock = new THREE.Clock()

  function resize() {
    const { clientWidth: w, clientHeight: h } = container
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  new ResizeObserver(resize).observe(container)
  resize()

  function applyWilt(w) {
    for (const leaf of leaves) {
      leaf.node.quaternion
        .setFromAxisAngle(leaf.axis, w * MAX_DROOP * leaf.weight)
        .multiply(leaf.rest)
    }
    // 元気なほど笑顔、しおれるほど「へ」の字と半目
    mouth.scale.y = 1 - 2 * THREE.MathUtils.clamp((w - 0.3) / 0.4, 0, 1)
    for (const eye of eyes) eye.scale.y = eye.userData.restY * (1 - 0.35 * w)
    head.rotation.x = 0.18 * w
  }
  for (const eye of eyes) eye.userData.restY = eye.scale.y

  renderer.setAnimationLoop(() => {
    // 描画の間隔が端末によって違うので、経過時間で近づける（約1秒で8割）
    const dt = Math.min(clock.getDelta(), 0.5)
    const t = clock.elapsedTime
    wilt += (targetWilt - wilt) * (1 - Math.exp(-dt * 1.6))
    applyWilt(wilt)
    // しおれているほど、ゆっくり小さく揺れる
    const energy = 1 - 0.7 * wilt
    pivot.position.y = Math.sin(t * 1.4 * energy) * 0.012 * energy
    pivot.rotation.z = Math.sin(t * 0.9) * 0.025 * energy
    renderer.render(scene, camera)
  })

  return {
    canvas: renderer.domElement,
    setEmotion(emotion) {
      targetWilt = WILT_BY_EMOTION[emotion] ?? 0
    },
    poke() {
      bounce(model.scale, [
        [1.08, 0.85, 1.08],
        [0.94, 1.15, 0.94],
        [1, 1, 1],
      ])
    },
    pet() {
      bounce(model.rotation, [[0, -0.5, 0], [0, 0.5, 0], [0, -0.3, 0], [0, 0, 0]])
    },
  }
}

// 親ノードの下の葉ごとに、元の向きと「垂れる」回転軸を求めておく
function collectLeaves(model, parentName) {
  const parent = model.getObjectByName(parentName)
  const down = new THREE.Vector3(0, -1, 0)
  return parent.children.map((node) => {
    const tip = farthestPoint(node.geometry).applyQuaternion(node.quaternion).normalize()
    const axis = new THREE.Vector3().crossVectors(tip, down)
    // 真上・真下を向いた葉は、前に倒す
    if (axis.lengthSq() < 1e-4) axis.set(1, 0, 0)
    axis.normalize()
    // 上を向いた葉ほど大きく垂れる。マントは控えめに
    const weight = parentName === 'Cape' ? 0.25 : 0.6 + 0.4 * Math.max(tip.y, 0)
    return { node, rest: node.quaternion.clone(), axis, weight }
  })
}

function farthestPoint(geometry) {
  const pos = geometry.attributes.position
  const p = new THREE.Vector3()
  const best = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i)
    if (p.lengthSq() > best.lengthSq()) best.copy(p)
  }
  return best
}

// [x, y, z] の列を順にたどる短いアニメーション
function bounce(target, steps, stepMs = 140) {
  const from = target.clone()
  let i = 0
  let start = performance.now()
  function frame(now) {
    const k = Math.min((now - start) / stepMs, 1)
    const e = 1 - (1 - k) ** 3
    const [x, y, z] = steps[i]
    target.set(from.x + (x - from.x) * e, from.y + (y - from.y) * e, from.z + (z - from.z) * e)
    if (k < 1) return requestAnimationFrame(frame)
    from.copy(target)
    i += 1
    start = now
    if (i < steps.length) requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
