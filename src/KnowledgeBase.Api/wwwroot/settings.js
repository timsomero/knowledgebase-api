// The Settings screen (#settings): the work categories offered when adding a task in Work mode.
// Uses $, api, showError, renderMode and settings from app.js, and setStatus from workouts.js.

async function loadSettings() {
  try {
    settings = await api('/settings');
  } catch { /* keep the last ones; the Tasks screen still works */ }
}

async function showSettings() {
  setStatus($('settings-status'), '');
  try {
    settings = await api('/settings');
  } catch (err) {
    return showError(err);
  }
  renderSettings();
}

// Saves after each change; on failure the screen goes back to what is saved.
async function saveWorkCategories(workCategories, message) {
  const status = $('settings-status');
  try {
    settings = await api('/settings', { method: 'PUT', body: JSON.stringify({ workCategories }) });
    setStatus(status, message);
    renderSettings();
    return true;
  } catch (err) {
    setStatus(status, err.message, true);
    renderSettings();
    return false;
  }
}

function renderSettings() {
  $('work-categories').replaceChildren(...settings.workCategories.map((name) => {
    const li = document.createElement('li');
    li.append(name);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${name}`);
    remove.addEventListener('click', () => {
      if (!confirm(`Remove the ${name} category? Tasks already in it keep it.`)) return;
      saveWorkCategories(settings.workCategories.filter((c) => c !== name), `Removed ${name}.`);
    });
    li.append(remove);
    return li;
  }));
}

$('add-work-category').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.target.elements.name;
  const name = input.value.trim();
  if (!name) return;
  if (settings.workCategories.some((c) => c.toLowerCase() === name.toLowerCase()))
    return setStatus($('settings-status'), `${name} is already a category.`, true);
  if (await saveWorkCategories([...settings.workCategories, name], `Added ${name}.`)) input.value = '';
});

// ---------- appearance ----------

// Light, Dark or Match device, kept on this device. index.html applies it before the page first draws;
// this changes it from Settings and follows the device when it's "Match device".
const THEME_KEY = 'kb_theme';
const themeChoice = () => {
  try { return localStorage.getItem(THEME_KEY) ?? 'system'; } catch { return 'system'; }
};
const deviceDark = matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const choice = themeChoice();
  const dark = choice === 'dark' || (choice === 'system' && deviceDark.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#0a0a0a' : '#ffffff';
  for (const b of $('theme-choice').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.themeChoice === choice));
}

$('theme-choice').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  try {
    if (b.dataset.themeChoice === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, b.dataset.themeChoice);
  } catch { /* storage unavailable: still switch for now */ }
  applyTheme();
});
deviceDark.addEventListener('change', applyTheme);
applyTheme();
