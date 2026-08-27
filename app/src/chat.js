import { sendChatMessage } from './api.js'

const list = document.getElementById('chatList')
const form = document.getElementById('chatForm')
const input = document.getElementById('chatInput')

function addBubble(role, text) {
  const li = document.createElement('li')
  li.className = `chat-bubble chat-bubble--${role}`
  li.textContent = text
  list.appendChild(li)
  list.scrollTop = list.scrollHeight
  return li
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const message = input.value.trim()
  if (!message) return

  input.value = ''
  addBubble('user', message)
  const pending = addBubble('plant', '……')

  try {
    const data = await sendChatMessage(message)
    pending.textContent = data.reply
  } catch (err) {
    pending.textContent = '返事を受け取れませんでした'
    console.error(err)
  }
})
