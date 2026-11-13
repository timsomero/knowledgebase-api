// Rich text for notes: the note box (#note-editor) with its toolbar (bold, italic, underline, heading,
// bulleted and numbered lists, and a checklist you tick by tapping its box). Only a short list of tags is
// kept: everything typed, pasted, loaded or written by the tidy-up goes through cleanHtml, which rebuilds it
// from those tags alone (no styles, scripts or other attributes). Used by notes.js.

const RICH_KEEP = new Set(['DIV', 'P', 'BR', 'B', 'I', 'U', 'H2', 'H3', 'UL', 'OL', 'LI', 'A']);
const RICH_RENAME = { STRONG: 'B', EM: 'I', H1: 'H2', H4: 'H3', H5: 'H3', H6: 'H3' };
const RICH_BLOCKS = new Set(['SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'BLOCKQUOTE', 'PRE', 'TABLE', 'TR', 'FIGURE', 'ASIDE', 'MAIN', 'NAV', 'DL', 'DT', 'DD']);
const RICH_DROP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'NOSCRIPT', 'HEAD', 'TITLE', 'META', 'LINK', 'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'FORM']);

// Safe HTML for the note: allowed tags only, with only a checklist's class, a ticked item's data-checked and
// a link's http(s) or mailto address. Parsing with DOMParser runs nothing.
function cleanHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html ?? ''}</body>`, 'text/html');
  const out = document.createElement('div');
  const copy = (from, to) => {
    for (const node of from.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) { to.append(node.textContent); continue; }
      if (node.nodeType !== Node.ELEMENT_NODE || RICH_DROP.has(node.tagName)) continue;
      const tag = RICH_RENAME[node.tagName] ?? (RICH_BLOCKS.has(node.tagName) ? 'DIV' : node.tagName);
      if (!RICH_KEEP.has(tag)) { copy(node, to); continue; } // spans, fonts and the like: keep the words
      const el = document.createElement(tag);
      if (tag === 'A') {
        const href = node.getAttribute('href') ?? '';
        if (!/^(https?:|mailto:)/i.test(href)) { copy(node, to); continue; }
        el.href = href;
        el.target = '_blank';
        el.rel = 'noopener noreferrer';
      }
      if (tag === 'UL' && node.classList.contains('checklist')) el.className = 'checklist';
      if (tag === 'LI' && node.getAttribute('data-checked') === 'true') el.dataset.checked = 'true';
      copy(node, el);
      to.append(el);
    }
  };
  copy(doc.body, out);
  return out.innerHTML;
}

// A note written before rich text: each line becomes a line of the editor.
function htmlFromText(text) {
  return (text ?? '').split('\n').map((line) => {
    const div = document.createElement('div');
    if (line) div.textContent = line;
    else div.append(document.createElement('br'));
    return div.outerHTML;
  }).join('');
}

// The note as plain text, a line per block, for its title, the list, search and links. Checklist items get
// ☐ or ☑ so the plain version still shows them.
function textFromHtml(html) {
  const root = document.createElement('div');
  root.innerHTML = cleanHtml(html);
  const lines = [''];
  const BLOCK = new Set(['DIV', 'P', 'H2', 'H3', 'LI', 'UL', 'OL']);
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) { lines[lines.length - 1] += child.textContent; continue; }
      if (child.tagName === 'BR') { lines.push(''); continue; }
      const block = BLOCK.has(child.tagName);
      if (block && lines.at(-1) !== '') lines.push('');
      if (child.tagName === 'LI') {
        const list = child.parentElement;
        lines[lines.length - 1] += list?.classList.contains('checklist') ? (child.dataset.checked === 'true' ? '☑ ' : '☐ ')
          : list?.tagName === 'OL' ? `${[...list.children].indexOf(child) + 1}. ` : '• ';
      }
      walk(child);
      if (block && lines.at(-1) !== '') lines.push('');
    }
  };
  walk(root);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- the editor ----------

const editor = $('note-editor');
const editorHtml = () => cleanHtml(editor.innerHTML);
const editorText = () => textFromHtml(editor.innerHTML);
function setEditorHtml(html) {
  editor.innerHTML = cleanHtml(html);
  updateToolbar();
}

try { document.execCommand('defaultParagraphSeparator', false, 'div'); } catch { /* older browsers */ }

// The list (ul or ol) and block the cursor is in, if any.
function selectionElement() {
  const node = getSelection()?.anchorNode;
  const el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  return el && editor.contains(el) ? el : null;
}
const closestIn = (selector) => selectionElement()?.closest(selector);

function runCommand(cmd) {
  editor.focus();
  if (cmd === 'heading') {
    document.execCommand('formatBlock', false, closestIn('h2') ? 'div' : 'h2');
  } else if (cmd === 'bullets' || cmd === 'checklist') {
    const list = closestIn('ul, ol');
    const isChecklist = list?.classList.contains('checklist');
    if (list?.tagName === 'UL' && isChecklist !== (cmd === 'checklist')) {
      list.classList.toggle('checklist', cmd === 'checklist'); // switch between bullets and checklist
      if (cmd === 'bullets') list.querySelectorAll('li[data-checked]').forEach((li) => li.removeAttribute('data-checked'));
    } else {
      document.execCommand('insertUnorderedList');
      if (cmd === 'checklist') closestIn('ul')?.classList.add('checklist');
    }
  } else if (cmd === 'numbers') {
    document.execCommand('insertOrderedList');
  } else {
    document.execCommand(cmd);
  }
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  updateToolbar();
}

// The buttons show what the cursor is in (bold, a heading, a list...).
function updateToolbar() {
  const state = (cmd) => {
    try {
      if (cmd === 'heading') return !!closestIn('h2');
      if (cmd === 'bullets') return !!closestIn('ul:not(.checklist)');
      if (cmd === 'checklist') return !!closestIn('ul.checklist');
      if (cmd === 'numbers') return !!closestIn('ol');
      return selectionElement() ? document.queryCommandState(cmd) : false;
    } catch { return false; }
  };
  for (const b of $('note-toolbar').querySelectorAll('button')) b.setAttribute('aria-pressed', String(state(b.dataset.cmd)));
}

// mousedown/touch keeps the selection in the note while a button is pressed.
$('note-toolbar').addEventListener('mousedown', (e) => e.preventDefault());
$('note-toolbar').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) runCommand(b.dataset.cmd);
});
document.addEventListener('selectionchange', () => { if (document.activeElement === editor) updateToolbar(); });

// Tapping a checklist item's box ticks it.
editor.addEventListener('click', (e) => {
  const li = e.target.closest?.('ul.checklist > li');
  if (!li || e.clientX - li.getBoundingClientRect().left > 28) return;
  if (li.dataset.checked === 'true') li.removeAttribute('data-checked');
  else li.dataset.checked = 'true';
  editor.dispatchEvent(new Event('input', { bubbles: true }));
});

// A new checklist item starts unticked (the browser copies the item it was split from).
editor.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  setTimeout(() => closestIn('ul.checklist > li')?.removeAttribute('data-checked'));
});

// Pasting keeps the words and the allowed formatting only.
editor.addEventListener('paste', (e) => {
  const html = e.clipboardData?.getData('text/html');
  const text = e.clipboardData?.getData('text/plain') ?? '';
  e.preventDefault();
  document.execCommand('insertHTML', false, html ? cleanHtml(html) : htmlFromText(text));
});
