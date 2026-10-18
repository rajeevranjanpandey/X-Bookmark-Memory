/* X-Bookmark-Memory site — loads data/bookmarks.json, renders filterable cards.
   Edit mode: re-tag categories and hide bookmarks. Overrides live in
   localStorage; "Export JSON" downloads a bookmarks.json with overrides
   baked in, ready to commit so changes apply for every visitor. */
(async function () {
  const grid = document.getElementById('grid');
  const chips = document.getElementById('chips');
  const search = document.getElementById('search');
  const stats = document.getElementById('stats');
  const empty = document.getElementById('empty');
  const editToggle = document.getElementById('editToggle');
  const editTools = document.getElementById('editTools');
  const editHint = document.getElementById('editHint');
  const exportBtn = document.getElementById('exportBtn');
  const hideShownBtn = document.getElementById('hideShownBtn');
  const resetBtn = document.getElementById('resetBtn');

  const OV_KEY = 'xbm_overrides_v1';
  const ADULT = 'Adult';
  let editMode = false;
  let overrides = loadOverrides();

  function loadOverrides() {
    try { return JSON.parse(localStorage.getItem(OV_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveOverrides() {
    try { localStorage.setItem(OV_KEY, JSON.stringify(overrides)); } catch (e) {}
  }

  let base = [];
  try {
    // cache-buster: bookmarks.json changes on every sync, and browsers
    // otherwise keep serving a stale copy
    const res = await fetch('data/bookmarks.json?v=' + Date.now());
    base = await res.json();
  } catch (e) {
    grid.innerHTML = '';
    empty.hidden = false;
    empty.querySelector('p').textContent = 'Could not load bookmarks.json.';
    return;
  }

  // Effective record = base + local override. "Adult" category implies hidden.
  function eff(it) {
    const o = overrides[it.tweet_id] || {};
    const category = o.category !== undefined ? o.category : (it.category || 'Uncategorized');
    let hidden = o.hidden !== undefined ? o.hidden : !!it.hidden;
    if (category === ADULT) hidden = true;
    return Object.assign({}, it, { category, hidden });
  }

  function visibleItems() {
    const all = base.map(eff);
    // newest first
    all.sort((a, b) => (b.synced_at || '').localeCompare(a.synced_at || ''));
    return editMode ? all : all.filter(i => !i.hidden);
  }

  const catOptions = () => {
    const s = new Set(base.map(i => i.category || 'Uncategorized'));
    s.add(ADULT); s.add('Uncategorized');
    return [...s].sort();
  };

  let activeCat = 'All';
  let query = '';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function renderChips() {
    const list = ['All', ...new Set(visibleItems().map(i => i.category))];
    chips.innerHTML = '';
    list.forEach(c => {
      const b = document.createElement('button');
      b.className = 'chip' + (c === activeCat ? ' active' : '');
      b.textContent = c;
      b.onclick = () => { activeCat = c; renderChips(); render(); };
      chips.appendChild(b);
    });
  }

  function editControls(it) {
    if (!editMode) return '';
    const opts = catOptions().map(c =>
      `<option value="${esc(c)}"${c === it.category ? ' selected' : ''}>${esc(c)}</option>`).join('');
    const hideLabel = it.hidden ? '👁️ Unhide' : '🙈 Hide';
    return `<div class="editrow">
      <select data-act="cat" data-id="${esc(it.tweet_id)}" title="Change category">${opts}</select>
      <button data-act="hide" data-id="${esc(it.tweet_id)}" title="Hide from public view">${hideLabel}</button>
    </div>`;
  }

  function cardHTML(it) {
    const d = (it.tweet_created_at || '').slice(0, 10);
    const urls = (it.expanded_urls || []).map(u =>
      `<a href="${esc(u)}" target="_blank" rel="noopener">📎 ${esc(u)}</a>`).join('');
    const metrics = (it.likes != null)
      ? `❤️ ${it.likes.toLocaleString()} · 🔁 ${(it.reposts || 0).toLocaleString()}` : '';
    const hiddenBadge = (editMode && it.hidden) ? `<span class="hiddenbadge">HIDDEN</span>` : '';
    return `<article class="card${editMode && it.hidden ? ' is-hidden' : ''}" data-id="${esc(it.tweet_id)}">
      <div class="card-top">
        <span class="badge">${esc(it.category || 'Uncategorized')}</span>${hiddenBadge}
        <span class="date">${esc(d)}</span>
      </div>
      <div class="author">${esc(it.author_name || '')} <span>@${esc(it.author_handle || '')}</span></div>
      <div class="text">${esc(it.text || '')}</div>
      <div class="links">
        <a href="${esc(it.url)}" target="_blank" rel="noopener">🔗 View on X</a>
        ${urls}
      </div>
      <div class="meta">${metrics}</div>
      ${editControls(it)}
    </article>`;
  }

  let lastShown = [];
  function render() {
    const q = query.trim().toLowerCase();
    const items = visibleItems();
    const filtered = items.filter(it => {
      if (activeCat !== 'All' && it.category !== activeCat) return false;
      if (!q) return true;
      return [it.text, it.author_name, it.author_handle, it.category,
              ...(it.expanded_urls || [])].join(' ').toLowerCase().includes(q);
    });
    lastShown = filtered;
    grid.innerHTML = filtered.map(cardHTML).join('');
    empty.hidden = filtered.length > 0;
    const hiddenCount = base.map(eff).filter(i => i.hidden).length;
    stats.innerHTML =
      `<span><strong>${items.length}</strong> bookmarks</span>` +
      `<span><strong>${new Set(items.map(i => i.category)).size}</strong> categories</span>` +
      (filtered.length !== items.length ? `<span>showing <strong>${filtered.length}</strong></span>` : '') +
      (editMode && hiddenCount ? `<span>🙈 <strong>${hiddenCount}</strong> hidden</span>` : '');
  }

  function setOverride(id, patch) {
    overrides[id] = Object.assign({}, overrides[id], patch);
    // drop no-op overrides to keep storage small
    const b = base.find(x => x.tweet_id === id) || {};
    const o = overrides[id];
    const baseCat = b.category || 'Uncategorized';
    const baseHidden = !!b.hidden;
    const effCat = o.category !== undefined ? o.category : baseCat;
    let effHidden = o.hidden !== undefined ? o.hidden : baseHidden;
    if (effCat === ADULT) effHidden = true;
    if (effCat === baseCat && effHidden === baseHidden && baseCat !== ADULT) delete overrides[id];
    saveOverrides();
  }

  grid.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset && el.dataset.act === 'cat') {
      const id = el.dataset.id;
      const patch = { category: el.value };
      // "Adult" implies hidden from the public site
      if (el.value === ADULT) patch.hidden = true;
      setOverride(id, patch);
      renderChips(); render();
    }
  });
  grid.addEventListener('click', e => {
    const el = e.target.closest('[data-act="hide"]');
    if (!el) return;
    const id = el.dataset.id;
    const cur = eff(base.find(x => x.tweet_id === id) || {});
    setOverride(id, { hidden: !cur.hidden });
    render();
  });

  editToggle.onclick = () => {
    editMode = !editMode;
    editToggle.classList.toggle('active', editMode);
    editToggle.textContent = editMode ? '✅ Done' : '✏️ Edit';
    editTools.hidden = !editMode;
    editHint.hidden = !editMode;
    if (!editMode && !['All', ...new Set(visibleItems().map(i => i.category))].includes(activeCat)) {
      activeCat = 'All';
    }
    renderChips(); render();
  };

  hideShownBtn.onclick = () => {
    if (!lastShown.length) return;
    if (!confirm(`Hide ${lastShown.length} bookmarks currently shown from the public site?`)) return;
    lastShown.forEach(it => setOverride(it.tweet_id, { hidden: true }));
    render();
  };

  resetBtn.onclick = () => {
    if (!confirm('Discard all unsynced edits in this browser?')) return;
    overrides = {};
    saveOverrides();
    renderChips(); render();
  };

  exportBtn.onclick = () => {
    const out = base.map(it => {
      const e = eff(it);
      return Object.assign({}, it, { category: e.category, hidden: e.hidden });
    });
    const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bookmarks.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  search.addEventListener('input', e => { query = e.target.value; render(); });

  renderChips();
  render();
})();
