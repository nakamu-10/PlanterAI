import './style.css'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'
import Lenis from 'lenis'

gsap.registerPlugin(ScrollTrigger, MotionPathPlugin)

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

function setupSmoothScroll() {
  if (reduceMotion) return null
  const lenis = new Lenis({ duration: 1.1, smoothWheel: true })
  gsap.ticker.add((time) => lenis.raf(time * 1000))
  gsap.ticker.lagSmoothing(0)
  lenis.on('scroll', ScrollTrigger.update)
  return lenis
}

function setupChrome() {
  const menu = document.getElementById('chromeMenu')
  const menuBtn = document.getElementById('menuBtn')
  if (!menu || !menuBtn) return

  let previousOverflow = ''

  const focusableElements = () => [
    menuBtn,
    ...menu.querySelectorAll('a[href], button:not([disabled])'),
  ]

  const openMenu = () => {
    previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    menu.classList.add('is-open')
    menu.setAttribute('aria-hidden', 'false')
    menuBtn.setAttribute('aria-expanded', 'true')
    menuBtn.setAttribute('aria-label', 'メニューを閉じる')
    const firstLink = menu.querySelector('a[href]')
    if (firstLink) firstLink.focus()
  }
  const closeMenu = (restoreFocus = true) => {
    document.documentElement.style.overflow = previousOverflow
    menu.classList.remove('is-open')
    menu.setAttribute('aria-hidden', 'true')
    menuBtn.setAttribute('aria-expanded', 'false')
    menuBtn.setAttribute('aria-label', 'メニューを開く')
    if (restoreFocus) menuBtn.focus()
  }
  menuBtn.addEventListener('click', () => {
    if (menu.classList.contains('is-open')) closeMenu()
    else openMenu()
  })
  menu.querySelectorAll('a[href]').forEach((link) => {
    link.addEventListener('click', () => closeMenu(false))
  })
  document.addEventListener('keydown', (event) => {
    if (!menu.classList.contains('is-open')) return
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
      return
    }
    if (event.key !== 'Tab') return

    const items = focusableElements()
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  })

  const here = location.pathname.split('/').pop() || 'index.html'
  menu.querySelectorAll('.chrome-menu__item').forEach((item) => {
    const href = item.getAttribute('href').split('/').pop() || 'index.html'
    if (href === here) {
      item.classList.add('is-current')
      item.setAttribute('aria-current', 'page')
    }
  })
}

function setupHero() {
  const planter = document.getElementById('heroPlanter')
  const signature = document.getElementById('heroSignature')
  const lead = document.getElementById('heroLead')
  if (!planter) return () => {}

  const titleLines = document.querySelectorAll('#heroTitle .hero__title-line span')
  const chat = document.getElementById('heroChat')
  const messages = chat ? chat.querySelectorAll('.msg, .typing') : []
  const entryDistance = Math.min(460, Math.max(320, window.innerWidth * 0.72))

  if (reduceMotion) return () => {}

  gsap.set([signature, lead].filter(Boolean), { opacity: 0, y: 16 })
  gsap.set(titleLines, { yPercent: 110 })
  gsap.set(planter, { opacity: 0, x: -entryDistance, y: 72, scale: 0.88, rotate: -14 })
  if (chat) gsap.set(chat, { opacity: 0, y: 24 })
  if (messages.length) gsap.set(messages, { opacity: 0, y: 10 })

  return () => {
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
    tl.to(titleLines, { yPercent: 0, duration: 0.9, stagger: 0.12 })
      .to(planter, {
        opacity: 1,
        scale: 1,
        rotate: 0,
        duration: 1.7,
        ease: 'power2.out',
        motionPath: {
          path: [
            { x: -entryDistance * 0.78, y: -12 },
            { x: -entryDistance * 0.48, y: -62 },
            { x: -entryDistance * 0.18, y: -44 },
            { x: 0, y: 0 },
          ],
          curviness: 1.7,
          autoRotate: false,
        },
      }, 0.24)
    if (signature) tl.to(signature, { opacity: 1, y: 0, duration: 0.6 }, 0.65)
    if (lead) tl.to(lead, { opacity: 1, y: 0, duration: 0.6 }, '-=0.5')
    if (chat) tl.to(chat, { opacity: 1, y: 0, duration: 0.7 }, '-=0.3')
    if (messages.length) tl.to(messages, { opacity: 1, y: 0, duration: 0.5, stagger: 0.25 }, '-=0.2')
    tl.call(() => {
      gsap.to(planter, { y: -8, rotate: 1.2, duration: 2.8, ease: 'sine.inOut', repeat: -1, yoyo: true })
    })
  }
}

function setupPlanterScroll() {
  const hero = document.getElementById('hero')
  const track = document.getElementById('heroPlanterTrack')
  if (!hero || !track || reduceMotion) return

  const movement = gsap.timeline({
    scrollTrigger: {
      trigger: hero,
      start: 'top top',
      end: 'bottom top',
      scrub: 0.65,
      invalidateOnRefresh: true,
    },
  })

  movement.to(track, {
    x: () => Math.min(54, window.innerWidth * 0.11),
    y: () => hero.offsetHeight * 1.04,
    rotate: 24,
    scale: 0.78,
    ease: 'none',
    duration: 1,
  }, 0)

  movement.to(track, {
    opacity: 0,
    ease: 'none',
    duration: 1,
  }, 0)
}

function setupReveal() {
  if (reduceMotion) return

  gsap.utils.toArray('[data-section-reveal]').forEach((section) => {
    gsap.set(section, { opacity: 0, y: 54 })
    ScrollTrigger.create({
      trigger: section,
      start: 'top 65%',
      once: true,
      onEnter: () => gsap.to(section, {
        opacity: 1,
        y: 0,
        duration: 1,
        ease: 'power3.out',
      }),
    })
  })

  gsap.utils.toArray('[data-reveal]').forEach((el) => {
    gsap.set(el, { opacity: 0, y: 28 })
    ScrollTrigger.create({
      trigger: el,
      start: 'top 88%',
      once: true,
      onEnter: () => gsap.to(el, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out' }),
    })
  })

  gsap.utils.toArray('[data-reveal-group]').forEach((group) => {
    const items = group.querySelectorAll(':scope > [data-reveal-item]')
    if (!items.length) return
    gsap.set(items, { opacity: 0, y: 24 })
    ScrollTrigger.create({
      trigger: group,
      start: 'top 85%',
      once: true,
      onEnter: () => gsap.to(items, { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out', stagger: 0.09 }),
    })
  })

  gsap.utils.toArray('[data-bar-fill]').forEach((bar) => {
    const pct = bar.dataset.barFill
    gsap.set(bar, { width: '0%' })
    ScrollTrigger.create({
      trigger: bar,
      start: 'top 92%',
      once: true,
      onEnter: () => gsap.to(bar, { width: pct + '%', duration: 1.1, ease: 'power2.out' }),
    })
  })

  gsap.utils.toArray('.chart').forEach((chart) => {
    const cols = chart.querySelectorAll('[data-col-fill]')
    if (!cols.length) return
    gsap.set(cols, { height: 0 })
    ScrollTrigger.create({
      trigger: chart,
      start: 'top 90%',
      once: true,
      onEnter: () => gsap.to(cols, {
        height: (i, el) => el.dataset.colFill + 'px',
        duration: 0.9,
        ease: 'power3.out',
        stagger: 0.06,
      }),
    })
  })
}

function runPreloader(onComplete) {
  const preloader = document.getElementById('preloader')

  let alreadyPlayed = false
  try {
    alreadyPlayed = sessionStorage.getItem('planterai:preloader-played') === '1'
  } catch {
    // ストレージを使えない環境では通常どおり再生する。
  }

  if (!preloader) {
    onComplete()
    return
  }

  if (reduceMotion || alreadyPlayed) {
    preloader.remove()
    onComplete()
    return
  }

  const mark = document.getElementById('preloaderMark')
  const fill = document.getElementById('preloaderFill')
  const count = document.getElementById('preloaderCount')

  document.documentElement.style.overflow = 'hidden'

  let done = false
  const idleTweens = [
    gsap.to(mark, { y: -10, duration: 0.9, ease: 'sine.inOut', repeat: -1, yoyo: true }),
    gsap.to(mark, { rotate: 3, duration: 1.6, ease: 'sine.inOut', repeat: -1, yoyo: true }),
  ]

  const safety = setTimeout(finish, 4500)

  function finish() {
    if (done) return
    done = true
    clearTimeout(safety)
    idleTweens.forEach((t) => t.kill())
    document.documentElement.style.overflow = ''
    preloader.remove()
    try {
      sessionStorage.setItem('planterai:preloader-played', '1')
    } catch {
      // 保存できなくても表示には影響させない。
    }
    onComplete()
  }

  const counter = { val: 0 }
  const tl = gsap.timeline({ onComplete: finish })
  tl.to(counter, {
    val: 100,
    duration: 1.3,
    ease: 'power2.out',
    onUpdate: () => {
      const v = Math.round(counter.val)
      count.textContent = v
      fill.style.width = v + '%'
    },
  }).to(preloader, {
    yPercent: -100,
    duration: 0.8,
    ease: 'power4.inOut',
  }, '+=0.15')
}

const playHero = setupHero()

runPreloader(() => {
  setupSmoothScroll()
  setupReveal()
  setupChrome()
  setupPlanterScroll()
  playHero()

  window.addEventListener('load', () => ScrollTrigger.refresh())
  if (document.fonts) document.fonts.ready.then(() => ScrollTrigger.refresh())
})
