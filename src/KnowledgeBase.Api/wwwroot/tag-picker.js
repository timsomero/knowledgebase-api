// The Tags field on the add form (More options) and in each task's edit form: picked tags show as
// labels in the box; tapping it drops down every tag you use, to tick any, plus a box for a new one.
// The picked tags are kept in a hidden input as "a, b", so the forms read them as before.
// Uses app.js's tasks.

// Every tag on any task, once each (first spelling wins), alphabetical.
function knownTags() {
  const byKey = new Map();
  for (const tag of tasks.flatMap((t) => t.tags)) if (!byKey.has(tag.toLowerCase())) byKey.set(tag.toLowerCase(), tag);
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

let openPicker = null; // the picker whose list is showing, so only one is open at a time

function attachTagPicker(input) {
  const picker = document.createElement('div');
  picker.className = 'tag-picker';
  const field = document.createElement('div');
  field.className = 'tag-field';
  const menu = document.createElement('div');
  menu.className = 'tag-menu';
  menu.hidden = true;
  picker.append(field, menu);
  input.after(picker);

  let picked = parse(input.value);

  function parse(value) {
    const seen = new Set();
    return value.split(',').map((t) => t.trim().replace(/^#/, '')).filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
  }

  function set(tags) {
    picked = tags;
    input.value = picked.join(', ');
    renderField();
    if (!menu.hidden) renderMenu();
  }

  function has(tag) {
    return picked.some((t) => t.toLowerCase() === tag.toLowerCase());
  }

  function toggle(tag) {
    set(has(tag) ? picked.filter((t) => t.toLowerCase() !== tag.toLowerCase()) : [...picked, tag]);
  }

  function renderField() {
    const labels = picked.map((tag) => {
      const label = document.createElement('span');
      label.className = 'tag-label';
      label.textContent = `#${tag}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${tag}`);
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        toggle(tag);
      });
      label.append(remove);
      return label;
    });
    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'tag-toggle';
    toggleButton.setAttribute('aria-expanded', String(!menu.hidden));
    toggleButton.innerHTML = `${picked.length ? '' : '<span>Choose tags</span>'}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${menu.hidden ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6'}"/></svg>`;
    if (picked.length) toggleButton.setAttribute('aria-label', menu.hidden ? 'Choose tags' : 'Close tags');
    field.replaceChildren(...labels, toggleButton);
    field.classList.toggle('is-open', !menu.hidden);
  }

  function renderMenu() {
    // The tags you use, plus any picked here that no task has yet.
    const all = [...knownTags()];
    for (const tag of picked) if (!all.some((t) => t.toLowerCase() === tag.toLowerCase())) all.push(tag);

    const options = all.map((tag) => {
      const option = document.createElement('label');
      option.className = 'tag-option';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = has(tag);
      box.addEventListener('change', () => toggle(tag));
      option.append(box, `#${tag}`);
      return option;
    });

    const row = document.createElement('div');
    row.className = 'tag-new';
    const name = document.createElement('input');
    name.placeholder = 'New tag…';
    name.setAttribute('aria-label', 'New tag');
    name.autocomplete = 'off';
    const add = document.createElement('button');
    add.type = 'button';
    add.textContent = 'Add';
    const addNew = () => {
      const tag = name.value.trim().replace(/^#/, '');
      if (!tag) return;
      // Reuse the spelling of a tag you already have.
      const existing = all.find((t) => t.toLowerCase() === tag.toLowerCase()) ?? tag;
      if (!has(existing)) set([...picked, existing]);
      renderMenu();
      menu.querySelector('.tag-new input').focus();
    };
    add.addEventListener('click', addNew);
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault(); // don't submit the task form
        addNew();
      }
    });
    row.append(name, add);

    const empty = document.createElement('p');
    empty.className = 'tag-empty';
    empty.textContent = 'No tags yet. Add one below.';
    menu.replaceChildren(...(options.length ? options : [empty]), row);
  }

  function open() {
    if (openPicker && openPicker !== api) openPicker.close();
    openPicker = api;
    menu.hidden = false;
    renderMenu();
    renderField();
  }

  function close() {
    if (openPicker === api) openPicker = null;
    menu.hidden = true;
    renderField();
  }

  field.addEventListener('click', () => (menu.hidden ? open() : close()));

  const api = { set, close, contains: (node) => picker.contains(node) };
  input.tagPicker = api;
  renderField();
  return api;
}

// Tapping anywhere else, or Escape, closes the open list.
document.addEventListener('pointerdown', (e) => {
  if (openPicker && !openPicker.contains(e.target)) openPicker.close();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openPicker) openPicker.close();
});

attachTagPicker(document.getElementById('add-tags'));
