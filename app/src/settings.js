import { fetchDashboard, isPublicView, updateSettings } from "./api.js";
import { CHARACTER_LABELS } from "./characters.js";
import { keepQueryOnLinks } from "./potSwitcher.js";

const form = document.getElementById("settingsForm");
const saveButton = document.getElementById("saveButton");
const formStatus = document.getElementById("formStatus");
const nameField = form.elements.plant_name;
const characterField = form.elements.character_id;

async function load() {
  const { device } = await fetchDashboard();
  const title = `${device.plant_name}の設定`;
  document.getElementById("pageTitle").textContent = title;
  document.title = `${title}｜PlanterAIアプリ`;
  nameField.value = device.plant_name;
  characterField.value = device.character_id;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formStatus.textContent = "保存中…";
  saveButton.disabled = true;
  try {
    await updateSettings({
      plant_name: nameField.value,
      character_id: characterField.value,
    });
  } catch (err) {
    formStatus.textContent = `保存に失敗しました: ${err.message}`;
    saveButton.disabled = false;
    return;
  }
  // 保存はできている。読み直しだけ失敗したときに「保存に失敗」と出すと、もう一度保存させてしまう
  try {
    await load();
    formStatus.textContent = "保存しました";
  } catch (err) {
    console.error(err);
    formStatus.textContent =
      "保存しました。表示を読み直せなかったので、ページを開き直してください。";
  }
  saveButton.disabled = false;
});

keepQueryOnLinks();
for (const [id, label] of Object.entries(CHARACTER_LABELS)) {
  characterField.add(new Option(label, id));
}
// 鍵なしの app-public は読み取りだけ。展示でも、名前と性格があることは見せる（#36）
if (isPublicView) {
  nameField.disabled = true;
  characterField.disabled = true;
  saveButton.hidden = true;
  formStatus.textContent = "展示用のページなので、変更できません。";
}
try {
  await load();
  // 読めるまでは保存させない。読めないまま保存すると、性格が一覧の先頭に変わってしまう
  saveButton.disabled = false;
} catch (err) {
  console.error(err);
  formStatus.textContent = "設定を読み込めませんでした。";
}
