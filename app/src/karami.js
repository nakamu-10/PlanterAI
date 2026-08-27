import { gsap } from 'gsap'
import { Draggable } from 'gsap/Draggable'
import { fetchDashboard } from './api.js'

gsap.registerPlugin(Draggable)

const REACTIONS = {
  '満足': {
    poke: ['わっ、なに？', 'ふふ、くすぐったいよ', 'げんきだよ〜'],
    pet: ['気持ちいい…もっとして', 'ふにゃ〜', 'ありがとう、うれしいな'],
  },
  '軽い不満': {
    poke: ['んー、ちょっとかまってほしい気分', 'つんつんしないでよ、もう'],
    pet: ['……まあ、悪くないけど', 'ちょっとだけ、元気出た'],
  },
  '不満': {
    poke: ['もう、いい加減にして', 'それより早く助けてよ'],
    pet: ['……少し落ち着いた、かも', 'なでなで、ありがとう'],
  },
  '不安': {
    poke: ['どうしよう、大丈夫かな……', 'ねえ、そばにいて'],
    pet: ['ちょっと安心した……', 'そばにいてくれると心強いよ'],
  },
  '苛立ち': {
    poke: ['もう限界かも……早くなんとかして', 'つらいよ、ほんとに'],
    pet: ['……ありがとう、少し楽になった', 'お願い、早く様子見てね'],
  },
}

const img = document.getElementById('karamiImg')
const bubble = document.getElementById('karamiBubble')
const stateLabel = document.getElementById('karamiState')

let currentEmotion = '満足'
let idleTween = null
let bubbleTimeout = null

function startIdle() {
  idleTween = gsap.to(img, {
    y: -10,
    rotate: 1.5,
    duration: 2.6,
    ease: 'sine.inOut',
    repeat: -1,
    yoyo: true,
  })
}

function showReaction(kind) {
  const pool = REACTIONS[currentEmotion]?.[kind] ?? REACTIONS['満足'][kind]
  const line = pool[Math.floor(Math.random() * pool.length)]
  bubble.textContent = line
  bubble.classList.add('is-visible')
  clearTimeout(bubbleTimeout)
  bubbleTimeout = setTimeout(() => bubble.classList.remove('is-visible'), 2200)
}

function poke() {
  gsap.timeline()
    .to(img, { scaleY: 0.85, scaleX: 1.08, duration: 0.12, ease: 'power2.out' })
    .to(img, { scaleY: 1.15, scaleX: 0.94, duration: 0.14, ease: 'power2.out' })
    .to(img, { scaleY: 1, scaleX: 1, duration: 0.3, ease: 'back.out(3)' })
  showReaction('poke')
}

function pet() {
  gsap.timeline()
    .to(img, { rotate: -6, duration: 0.18, ease: 'sine.inOut' })
    .to(img, { rotate: 6, duration: 0.32, ease: 'sine.inOut', repeat: 2, yoyo: true })
    .to(img, { rotate: 1.5, duration: 0.2, ease: 'sine.inOut' })
  showReaction('pet')
}

Draggable.create(img, {
  type: 'x,y',
  bounds: { minX: -50, maxX: 50, minY: -50, maxY: 50 },
  onPress() {
    idleTween?.pause()
  },
  onDragEnd() {
    const distance = Math.hypot(this.x, this.y)
    gsap.to(img, { x: 0, y: 0, duration: 0.5, ease: 'elastic.out(1, 0.5)' })
    if (distance > 10) {
      pet()
    } else {
      poke()
    }
    idleTween?.resume()
  },
  onClick() {
    poke()
    idleTween?.resume()
  },
})

async function refreshState() {
  try {
    const data = await fetchDashboard()
    const latest = data.emotion_history?.[0]
    currentEmotion = latest?.emotion ?? '満足'
    stateLabel.textContent = latest?.complaint
      ? `いまの気分：${currentEmotion}（${latest.complaint}）`
      : `いまの気分：${currentEmotion}`
  } catch (err) {
    console.error(err)
    stateLabel.textContent = '状態を取得できませんでした'
  }
}

startIdle()
refreshState()
setInterval(refreshState, 60_000)
