// The "Delegated to" field on the add form (More options) and in each task's edit form: one person,
// picked from everyone you have delegated to before, or a new name. Looks and closes like the tag
// picker (tag-picker.js, which loads first). The name is kept in a hidden input, empty for nobody.
// Uses app.js's tasks.

// Everyone any task is delegated to, once each (first spelling wins), alphabetical.
function knownPeople() {
  const byKey = new Map();
  for (const name of tasks.map((t) => t.delegatedTo).filter(Boolean)) if (!byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), name);
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function attachPersonPicker(input) {
  const picker = document.createElement('div');
  picker.className = 'tag-picker';
  const field = document.createElement('div');
  field.className = 'tag-field';
  const menu = document.createElement('div');
  menu.className = 'tag-menu';
  menu.setAttribute('role', 'radiogroup');
  menu.setAttribute('aria-label', 'Delegated to');
  menu.hidden = true;
  picker.append(field, menu);
  input.after(picker);

  // Each picker's radio buttons are their own group.
  const radioName = `who-${Math.random().toString(36).slice(2)}`;

  function set(name) {
    input.value = name.trim();
    renderField();
    if (!menu.hidden) renderMenu();
  }

  function pick(name) {
    set(name);
    close();
  }

  function renderField() {
    const parts = [];
    if (input.value) {
      const label = document.createElement('span');
      label.className = 'tag-label who';
      label.textContent = `→ ${input.value}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${input.value}`);
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        set('');
      });
      label.append(remove);
      parts.push(label);
    }
    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'tag-toggle';
    toggleButton.setAttribute('aria-expanded', String(!menu.hidden));
    toggleButton.innerHTML = `${input.value ? '' : '<span>Nobody</span>'}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${menu.hidden ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6'}"/></svg>`;
    if (input.value) toggleButton.setAttribute('aria-label', menu.hidden ? 'Choose who' : 'Close');
    field.replaceChildren(...parts, toggleButton);
    field.classList.toggle('is-open', !menu.hidden);
  }

  function option(text, name) {
    const label = document.createElement('label');
    label.className = 'tag-option';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = radioName;
    radio.checked = input.value.toLowerCase() === name.toLowerCase();
    radio.addEventListener('change', () => pick(name));
    label.append(radio, text);
    return label;
  }

  function renderMenu() {
    const all = knownPeople();
    if (input.value && !all.some((p) => p.toLowerCase() === input.value.toLowerCase())) all.push(input.value);

    const nobody = option("Nobody (it's mine)", '');
    nobody.classList.add('muted');

    const row = document.createElement('div');
    row.className = 'tag-new';
    const name = document.createElement('input');
    name.placeholder = 'New person…';
    name.setAttribute('aria-label', 'New person');
    name.autocomplete = 'off';
    const add = document.createElement('button');
    add.type = 'button';
    add.textContent = 'Add';
    const addNew = () => {
      const typed = name.value.trim();
      if (!typed) return;
      // Reuse the spelling of someone you already have.
      pick(all.find((p) => p.toLowerCase() === typed.toLowerCase()) ?? typed);
    };
    add.addEventListener('click', addNew);
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault(); // don't submit the task form
        addNew();
      }
    });
    row.append(name, add);

    menu.replaceChildren(nobody, ...all.map((p) => option(p, p)), row);
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
  input.personPicker = api;
  renderField();
  return api;
}

attachPersonPicker(document.getElementById('add-delegated'));
