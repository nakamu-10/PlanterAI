import { fetchDashboard, updateSettings } from './api.js'

const CHARACTER_LABELS = { amaenbo: '甘えん坊', tsundere: 'ツンデレ', keigo: '執事風' }
const SCORE_LABELS = { moisture: '土の水分', temp: '気温', light: '日照', humidity: '空気の湿度' }

const els = {
  plantName: document.getElementById('plantName'),
  characterName: document.getElementById('characterName'),
  scores: document.getElementById('scores'),
  emotionList: document.getElementById('emotionList'),
  form: document.getElementById('settingsForm'),
  formStatus: document.getElementById('formStatus'),
}

function renderScores(scores) {
  els.scores.innerHTML = ''
  if (!scores) {
    els.scores.textContent = 'まだセンサーデータがありません'
    return
  }
  for (const [key, label] of Object.entries(SCORE_LABELS)) {
    const value = scores[key]
    if (value === undefined) continue
    const clamped = Math.max(0, Math.min(100, value))
    const row = document.createElement('div')
    row.className = 'score-row'
    row.innerHTML = `
      <div class="score-row__top"><span>${label}</span><span>${Math.round(value)}</span></div>
      <div class="score-track"><div class="score-fill" style="width:${clamped}%"></div></div>
    `
    els.scores.appendChild(row)
  }
}

function renderEmotionHistory(history) {
  els.emotionList.innerHTML = ''
  if (!history?.length) {
    els.emotionList.textContent = '記録がありません'
    return
  }
  for (const entry of history.slice(0, 10)) {
    const item = document.createElement('li')
    const time = new Date(entry.created_at).toLocaleString('ja-JP')
    item.textContent = `${time}　${entry.emotion}${entry.complaint ? `（${entry.complaint}）` : ''}`
    els.emotionList.appendChild(item)
  }
}

async function load() {
  try {
    const data = await fetchDashboard()
    els.plantName.textContent = data.device.plant_name
    els.characterName.textContent =
      CHARACTER_LABELS[data.device.character_id] ?? data.device.character_id

    renderScores(data.latest_sensor?.scores)
    renderEmotionHistory(data.emotion_history)

    els.form.elements.plant_name.value = data.device.plant_name
    els.form.elements.plant_profile.value = data.device.plant_profile
    els.form.elements.character_id.value = data.device.character_id
  } catch (err) {
    console.error(err)
    els.formStatus.textContent = `データの取得に失敗しました: ${err.message}`
  }
}

els.form.addEventListener('submit', async (event) => {
  event.preventDefault()
  els.formStatus.textContent = '保存中…'
  try {
    const formData = new FormData(els.form)
    await updateSettings({
      plant_name: formData.get('plant_name'),
      plant_profile: formData.get('plant_profile'),
      character_id: formData.get('character_id'),
    })
    els.formStatus.textContent = '保存しました'
    await load()
  } catch (err) {
    els.formStatus.textContent = `保存に失敗しました: ${err.message}`
  }
})

load()
