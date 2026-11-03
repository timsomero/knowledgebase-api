// The idea catcher: the glowing lightbulb on the Personal tasks screen opens a new idea (#idea/new), a
// title and a big box to type or dictate into, kept exactly as written. All ideas (#ideas) lists them,
// most recently changed first, to search, open (#idea/<id>), add to, or delete.
// Uses $, api, showError and showToast from app.js; formatWhen from projects.js; setStatus from workouts.js.

let ideas = [];
let ideaId = null; // the idea on screen; null for a new one
let ideaSaved = { title: '', text: '' }; // what is saved, to tell whether there are changes

// A new idea is kept on the device while you write it, so leaving the screen by accident loses nothing.
const IDEA_DRAFT_KEY = 'kb_idea_draft';
const readDraft = () => {
  try { return JSON.parse(localStorage.getItem(IDEA_DRAFT_KEY)) ?? null; } catch { return null; }
};
const writeDraft = (draft) => {
  try {
    if (draft) localStorage.setItem(IDEA_DRAFT_KEY, JSON.stringify(draft));
    else localStorage.removeItem(IDEA_DRAFT_KEY);
  } catch { /* storage unavailable */ }
};

async function loadIdeas() {
  ideas = await api('/ideas');
  $('ideas-count').textContent = ideas.length ? `· ${ideas.length}` : '';
}

// "Nov 3, 2026 at 8:14 AM"
function ideaMoment(iso) {
  const at = new Date(iso);
  return `${at.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} at ${at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

// ---------- all ideas ----------

async function showIdeas() {
  renderIdeas();
  try {
    await loadIdeas();
    renderIdeas();
  } catch (err) {
    showError(err);
  }
}

function renderIdeas() {
  const words = $('ideas-search').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = ideas.filter((idea) => {
    const haystack = `${idea.title}\n${idea.text}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
  $('ideas-list').replaceChildren(...shown.map((idea) => {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = `#idea/${idea.id}`;
    const title = document.createElement('span');
    title.className = 'idea-title';
    title.textContent = idea.title;
    const sub = document.createElement('span');
    sub.className = 'idea-sub';
    const firstLine = idea.text.split('\n').find((l) => l.trim()) ?? '';
    sub.textContent = [formatWhen(idea.updatedAt), firstLine].filter(Boolean).join(' · ');
    link.append(title, sub);
    li.append(link);
    return li;
  }));
  $('no-ideas').hidden = shown.length > 0;
  $('no-ideas').textContent = ideas.length ? 'No ideas match your search.' : 'No ideas yet. Tap New idea to catch your first one.';
}

$('ideas-search').addEventListener('input', renderIdeas);

// ---------- one idea ----------

async function showIdea(id) {
  const form = $('idea-form');
  const f = form.elements;
  ideaId = id === 'new' ? null : id;
  setStatus($('idea-status'), '');
  $('idea-delete').hidden = !ideaId;
  $('idea-stamp').hidden = true;
  $('open-ideas').hidden = !!ideaId;

  if (!ideaId) {
    const draft = readDraft();
    ideaSaved = { title: '', text: '' };
    f.title.value = draft?.title ?? '';
    f.text.value = draft?.text ?? '';
    $('idea-heading').textContent = 'New idea';
    markIdeaSaved();
    // Straight to the big box, ready to dictate (the phone may still want a tap to show the keyboard).
    if (!f.text.value) f.text.focus();
    loadIdeas().catch(() => {}); // for the "All ideas" count
    return;
  }

  form.classList.add('is-loading');
  let idea;
  try {
    idea = await api(`/ideas/${ideaId}`);
  } catch (err) {
    return showError(err);
  } finally {
    form.classList.remove('is-loading');
  }
  if (ideaId !== idea.id) return; // moved on meanwhile
  fillIdea(idea);
}

function fillIdea(idea) {
  const f = $('idea-form').elements;
  ideaSaved = { title: idea.title, text: idea.text };
  f.title.value = idea.title;
  f.text.value = idea.text;
  $('idea-heading').textContent = idea.title;
  const changed = idea.updatedAt !== idea.createdAt;
  $('idea-stamp').textContent = `Caught ${ideaMoment(idea.createdAt)}${changed ? ` · last changed ${formatWhen(idea.updatedAt)}` : ''}`;
  $('idea-stamp').hidden = false;
  markIdeaSaved();
}

// Save turns into "Saved" while nothing has changed since the last save.
function markIdeaSaved() {
  const f = $('idea-form').elements;
  const unchanged = f.title.value.trim() === ideaSaved.title && f.text.value.trimEnd() === ideaSaved.text;
  const save = $('idea-save');
  save.disabled = unchanged;
  save.textContent = !ideaId ? 'Save idea' : unchanged ? 'Saved ✓' : 'Save';
}

$('idea-form').addEventListener('input', () => {
  const f = $('idea-form').elements;
  setStatus($('idea-status'), '');
  if (!ideaId) writeDraft(f.title.value || f.text.value ? { title: f.title.value, text: f.text.value } : null);
  markIdeaSaved();
});

$('idea-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const body = { title: f.title.value.trim(), text: f.text.value };
  if (!body.title && !body.text.trim()) return setStatus($('idea-status'), 'Write your idea first.', true);
  const save = $('idea-save');
  save.disabled = true;
  try {
    if (ideaId) {
      fillIdea(await api(`/ideas/${ideaId}`, { method: 'PUT', body: JSON.stringify(body) }));
      showToast('Saved.');
    } else {
      const idea = await api('/ideas', { method: 'POST', body: JSON.stringify(body) });
      writeDraft(null);
      ideas = [idea, ...ideas];
      showToast('Idea saved.');
      // Replace #idea/new, so Back goes where you came from rather than to an empty form.
      location.replace(`#idea/${idea.id}`);
    }
  } catch (err) {
    setStatus($('idea-status'), err.message, true);
    markIdeaSaved();
  }
});

$('idea-delete').addEventListener('click', async () => {
  if (!ideaId || !confirm("Delete this idea? This can't be undone.")) return;
  try {
    await api(`/ideas/${ideaId}`, { method: 'DELETE' });
    ideas = ideas.filter((i) => i.id !== ideaId);
    location.replace('#ideas');
    showToast('Deleted the idea.');
  } catch (err) {
    showToast(err.message, 'warn');
  }
});
