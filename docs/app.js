/* X-Bookmark-Memory site — loads ../data/bookmarks.json, renders filterable cards */
(async function () {
  const grid = document.getElementById('grid');
  const chips = document.getElementById('chips');
  const search = document.getElementById('search');
  const stats = document.getElementById('stats');
  const empty = document.getElementById('empty');

  let items = [];
  try {
    const res = await fetch('data/bookmarks.json');
    items = await res.json();
  } catch (e) {
    grid.innerHTML = '';
    empty.hidden = false;
    empty.querySelector('p').textContent = 'Could not load bookmarks.json.';
    return;
  }

  // newest first
  items.sort((a, b) => (b.synced_at || '').localeCompare(a.synced_at || ''));

  const cats = ['All', ...new Set(items.map(i => i.category || 'Uncategorized'))];
  let activeCat = 'All';
  let query = '';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function renderChips() {
    chips.innerHTML = '';
    cats.forEach(c => {
      const b = document.createElement('button');
      b.className = 'chip' + (c === activeCat ? ' active' : '');
      b.textContent = c;
      b.onclick = () => { activeCat = c; renderChips(); render(); };
      chips.appendChild(b);
    });
  }

  function cardHTML(it) {
    const d = (it.tweet_created_at || '').slice(0, 10);
    const urls = (it.expanded_urls || []).map(u =>
      `<a href="${esc(u)}" target="_blank" rel="noopener">📎 ${esc(u)}</a>`).join('');
    const metrics = (it.likes != null)
      ? `❤️ ${it.likes.toLocaleString()} · 🔁 ${(it.reposts || 0).toLocaleString()}` : '';
    return `<article class="card">
      <div class="card-top">
        <span class="badge">${esc(it.category || 'Uncategorized')}</span>
        <span class="date">${esc(d)}</span>
      </div>
      <div class="author">${esc(it.author_name || '')} <span>@${esc(it.author_handle || '')}</span></div>
      <div class="text">${esc(it.text || '')}</div>
      <div class="links">
        <a href="${esc(it.url)}" target="_blank" rel="noopener">🔗 View on X</a>
        ${urls}
      </div>
      <div class="meta">${metrics}</div>
    </article>`;
  }

  function render() {
    const q = query.trim().toLowerCase();
    const filtered = items.filter(it => {
      if (activeCat !== 'All' && (it.category || 'Uncategorized') !== activeCat) return false;
      if (!q) return true;
      return [it.text, it.author_name, it.author_handle, it.category,
              ...(it.expanded_urls || [])].join(' ').toLowerCase().includes(q);
    });
    grid.innerHTML = filtered.map(cardHTML).join('');
    empty.hidden = filtered.length > 0;
    stats.innerHTML =
      `<span><strong>${items.length}</strong> bookmarks</span>` +
      `<span><strong>${cats.length - 1}</strong> categories</span>` +
      (filtered.length !== items.length ? `<span>showing <strong>${filtered.length}</strong></span>` : '');
  }

  search.addEventListener('input', e => { query = e.target.value; render(); });

  renderChips();
  render();
})();
