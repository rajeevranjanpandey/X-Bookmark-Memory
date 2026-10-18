/* X-Bookmark-Memory site — loads data/bookmarks.json, renders filterable cards.
   Features: category chips (LLM/AI pinned first), year filter + yearly
   separators, sort control, search, hashtag pills, media indicators.
   Edit mode: re-tag categories and hide bookmarks. Overrides live in
   localStorage; "Export JSON" downloads a bookmarks.json with overrides
   baked in, ready to commit so changes apply for every visitor. */
(async function () {
  const grid = document.getElementById('grid');
  const chips = document.getElementById('chips');
  const ychips = document.getElementById('ychips');
  const search = document.getElementById('search');
  const sortSel = document.getElementById('sortSel');
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
  const PINNED_CATS = ['LLM', 'AI'];
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

  const tweetTime = it => {
    const d = Date.parse(it.tweet_created_at || '');
    return isNaN(d) ? 0 : d;
  };
  const tweetYear = it => {
    const t = tweetTime(it);
    return t ? String(new Date(t).getFullYear()) : 'Unknown';
  };

  function processedItems() {
    const all = base.map(eff);
    return editMode ? all : all.filter(i => !i.hidden);
  }

  let activeCat = 'All';
  let activeYear = 'All';
  let query = '';
  let sortMode = 'tweet_desc';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function chipOrder(cats) {
    const pinned = PINNED_CATS.filter(c => cats.includes(c));
    const rest = cats.filter(c => !PINNED_CATS.includes(c) && c !== 'Uncategorized').sort();
    if (cats.includes('Uncategorized')) rest.push('Uncategorized');
    return ['All', ...pinned, ...rest];
  }

  function renderChips() {
    const cats = [...new Set(processedItems().map(i => i.category))];
    const list = chipOrder(cats);
    if (!list.includes(activeCat)) activeCat = 'All';
    chips.innerHTML = '';
    list.forEach(c => {
      const b = document.createElement('button');
      b.className = 'chip' + (c === activeCat ? ' active' : '');
      b.textContent = c;
      b.onclick = () => { activeCat = c; renderChips(); render(); };
      chips.appendChild(b);
    });
  }

  function renderYChips() {
    const years = [...new Set(processedItems().map(tweetYear))]
      .sort((a, b) => (a === 'Unknown' ? 1 : b === 'Unknown' ? -1 : b - a));
    if (!['All', ...years].includes(activeYear)) activeYear = 'All';
    ychips.innerHTML = '';
    ['All years', ...years].forEach(y => {
      const val = y === 'All years' ? 'All' : y;
      const b = document.createElement('button');
      b.className = 'ychip' + (val === activeYear ? ' active' : '');
      b.textContent = y;
      b.onclick = () => { activeYear = val; renderYChips(); render(); };
      ychips.appendChild(b);
    });
  }

  function filteredItems() {
    const q = query.trim().toLowerCase();
    return processedItems().filter(it => {
      if (activeCat !== 'All' && it.category !== activeCat) return false;
      if (activeYear !== 'All' && tweetYear(it) !== activeYear) return false;
      if (!q) return true;
      const hay = [it.text, it.author_name, it.author_handle, it.category,
        ...(it.expanded_urls || []),
        ...((it.hashtags || []).map(h => '#' + h))].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function sortedItems(items) {
    const arr = items.slice();
    if (sortMode === 'tweet_asc') arr.sort((a, b) => tweetTime(a) - tweetTime(b));
    else if (sortMode === 'saved_desc') arr.sort((a, b) => (b.synced_at || '').localeCompare(a.synced_at || ''));
    else arr.sort((a, b) => tweetTime(b) - tweetTime(a)); // tweet_desc
    return arr;
  }

  function editControls(it) {
    if (!editMode) return '';
    const cats = [...new Set(base.map(i => i.category || 'Uncategorized'))];
    const opts = chipOrder(cats).filter(c => c !== 'All').map(c =>
      `<option value="${esc(c)}"${c === it.category ? ' selected' : ''}>${esc(c)}</option>`).join('');
    const allOpts = opts.includes(`value="${esc(ADULT)}"`) ? opts :
      opts + `<option value="${esc(ADULT)}"${it.category === ADULT ? ' selected' : ''}>${esc(ADULT)}</option>`;
    const hideLabel = it.hidden ? '👁️ Unhide' : '🙈 Hide';
    return `<div class="editrow">
      <select data-act="cat" data-id="${esc(it.tweet_id)}" title="Change category">${allOpts}</select>
      <button data-act="hide" data-id="${esc(it.tweet_id)}" title="Hide from public view">${hideLabel}</button>
    </div>`;
  }

  const fmtNum = n => (n == null ? null : Number(n).toLocaleString());

  function cardHTML(it) {
    const t = tweetTime(it);
    const d = t ? new Date(t).toISOString().slice(0, 10) : '';
    const urls = (it.expanded_urls || []).map(u =>
      `<a href="${esc(u)}" target="_blank" rel="noopener">📎 ${esc(u)}</a>`).join('');
    const tags = (it.hashtags || []).slice(0, 8).map(h =>
      `<button class="tag" data-tag="${esc(h)}">#${esc(h)}</button>`).join('');
    const m = [];
    if (fmtNum(it.likes) != null) m.push(`❤️ ${fmtNum(it.likes)}`);
    if (fmtNum(it.reposts) != null) m.push(`🔁 ${fmtNum(it.reposts)}`);
    if (fmtNum(it.replies) != null) m.push(`💬 ${fmtNum(it.replies)}`);
    if (fmtNum(it.views) != null && it.views > 0) m.push(`👁️ ${fmtNum(it.views)}`);
    const mediaBadge = it.has_media ? `<span class="mediabadge" title="Contains media">📷</span>` : '';
    const hiddenBadge = (editMode && it.hidden) ? `<span class="hiddenbadge">HIDDEN</span>` : '';
    return `<article class="card${editMode && it.hidden ? ' is-hidden' : ''}" data-id="${esc(it.tweet_id)}">
      <div class="card-top">
        <span class="badge">${esc(it.category || 'Uncategorized')}</span>${hiddenBadge}
        <span class="date">${mediaBadge}${esc(d)}</span>
      </div>
      <div class="author">${esc(it.author_name || '')} <span>@${esc(it.author_handle || '')}</span></div>
      <div class="text">${esc(it.text || '')}</div>
      ${tags ? `<div class="tags">${tags}</div>` : ''}
      <div class="links">
        <a href="${esc(it.url)}" target="_blank" rel="noopener">🔗 View on X</a>
        ${urls}
      </div>
      ${m.length ? `<div class="meta">${m.join(' · ')}</div>` : ''}
      ${editControls(it)}
    </article>`;
  }

  let lastShown = [];
  function render() {
    const items = sortedItems(filteredItems());
    lastShown = items;
    const groupByYear = sortMode !== 'saved_desc' && activeYear === 'All' && !query.trim();
    if (groupByYear) {
      const groups = {};
      items.forEach(it => { const y = tweetYear(it); (groups[y] = groups[y] || []).push(it); });
      const years = Object.keys(groups).sort((a, b) =>
        sortMode === 'tweet_asc'
          ? (a === 'Unknown' ? 1 : b === 'Unknown' ? -1 : a - b)
          : (a === 'Unknown' ? 1 : b === 'Unknown' ? -1 : b - a));
      grid.innerHTML = years.map(y =>
        `<div class="year-sep"><span>${esc(y)}</span><span class="year-count">${groups[y].length}</span></div>` +
        `<div class="grid">${groups[y].map(cardHTML).join('')}</div>`
      ).join('');
    } else {
      grid.innerHTML = `<div class="grid">${items.map(cardHTML).join('')}</div>`;
    }
    empty.hidden = items.length > 0;
    const total = processedItems().length;
    const hiddenCount = base.map(eff).filter(i => i.hidden).length;
    stats.innerHTML =
      `<span><strong>${total}</strong> bookmarks</span>` +
      `<span><strong>${new Set(processedItems().map(i => i.category)).size}</strong> categories</span>` +
      (activeYear !== 'All' ? `<span>📅 <strong>${esc(activeYear)}</strong></span>` : '') +
      (items.length !== total ? `<span>showing <strong>${items.length}</strong></span>` : '') +
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
      renderChips(); renderYChips(); render();
    }
  });
  grid.addEventListener('click', e => {
    const tag = e.target.closest('[data-tag]');
    if (tag) {
      search.value = '#' + tag.dataset.tag;
      query = search.value;
      render();
      return;
    }
    const el = e.target.closest('[data-act="hide"]');
    if (!el) return;
    const id = el.dataset.id;
    const cur = eff(base.find(x => x.tweet_id === id) || {});
    setOverride(id, { hidden: !cur.hidden });
    renderYChips(); render();
  });

  editToggle.onclick = () => {
    editMode = !editMode;
    editToggle.classList.toggle('active', editMode);
    editToggle.textContent = editMode ? '✅ Done' : '✏️ Edit';
    editTools.hidden = !editMode;
    editHint.hidden = !editMode;
    renderChips(); renderYChips(); render();
  };

  hideShownBtn.onclick = () => {
    if (!lastShown.length) return;
    if (!confirm(`Hide ${lastShown.length} bookmarks currently shown from the public site?`)) return;
    lastShown.forEach(it => setOverride(it.tweet_id, { hidden: true }));
    renderYChips(); render();
  };

  resetBtn.onclick = () => {
    if (!confirm('Discard all unsynced edits in this browser?')) return;
    overrides = {};
    saveOverrides();
    renderChips(); renderYChips(); render();
  };

  exportBtn.onclick = () => {
    const out = base.map(it => {
      const e = eff(it);
      const rec = Object.assign({}, it, { category: e.category, hidden: e.hidden });
      // mark manually re-tagged records so future imports keep them
      if (overrides[it.tweet_id] && overrides[it.tweet_id].category !== undefined) rec.manual = true;
      return rec;
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
  sortSel.addEventListener('change', e => { sortMode = e.target.value; render(); });

  renderChips();
  renderYChips();
  render();
})();
