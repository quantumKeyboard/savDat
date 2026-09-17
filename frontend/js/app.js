/* ═══════════════════════════════════════════
   saveDat Archives — Main App
═══════════════════════════════════════════ */

const API = "http://localhost:8000/api";

// ── State ──────────────────────────────────────────────────────────

const state = {
  collections: [],
  activeCollection: null,
  items: [],
  activeType: "all",   // all | movies | tv | anime
  activeStatus: "all",
  genreFilter: "all",
  watchFilter: "all",
  ratingFilter: "all",
  sortBy: "added-desc",
  viewMode: "grid",    // grid | list
  page: 1,
  perPage: 30,
  searchQuery: "",
  theme: localStorage.getItem("sd_theme") || "1",
};

// ── Theme ──────────────────────────────────────────────────────────

function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  document.querySelectorAll(".theme-dot").forEach(d => {
    d.classList.toggle("active", d.dataset.t === t);
  });
  state.theme = t;
  localStorage.setItem("sd_theme", t);
}

function googleFontUrl(family) {
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family.trim()).replace(/%20/g, "+")}&display=swap`;
}

function applyCustomFont(family) {
  const previous = document.getElementById("custom-font-stylesheet");
  if (previous) previous.remove();
  const normalizedFamily = (family || "").trim();
  if (normalizedFamily) {
    const link = document.createElement("link");
    link.id = "custom-font-stylesheet";
    link.rel = "stylesheet";
    link.href = googleFontUrl(normalizedFamily);
    document.head.appendChild(link);
    const stack = `'${normalizedFamily.replace(/'/g, "\\'")}', sans-serif`;
    document.documentElement.style.setProperty("--font-head", stack);
    document.documentElement.style.setProperty("--font-body", stack);
  } else {
    document.documentElement.style.removeProperty("--font-head");
    document.documentElement.style.removeProperty("--font-body");
  }
}

// ── Toast ──────────────────────────────────────────────────────────

function toast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  const icon = type === "success" ? "✓" : type === "error" ? "✗" : "ℹ";
  el.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  document.getElementById("toast-container").appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ── API helpers ────────────────────────────────────────────────────

async function apiFetch(path, opts = {}) {
  const r = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: r.statusText }));
    throw new Error(err.detail || r.statusText);
  }
  return r.json();
}

// ── Collections ────────────────────────────────────────────────────

async function loadCollections() {
  try {
    state.collections = await apiFetch("/collections");
    renderSidebarCollections();
    updateTypeCounts();
  } catch (e) {
    toast("Could not load collections: " + e.message, "error");
  }
}

function renderSidebarCollections() {
  const list = document.getElementById("collections-list");
  if (!list) return;

  const filtered = state.activeType === "all"
    ? state.collections
    : state.collections.filter(c => c.type === state.activeType);

  if (filtered.length === 0) {
    list.innerHTML = `<div style="font-size:0.75rem;opacity:0.4;padding:8px 4px;">No collections yet.</div>`;
    return;
  }

  list.innerHTML = filtered.map(c => `
    <button class="collection-item ${state.activeCollection?.id === c.id ? 'active' : ''}"
            data-id="${c.id}" onclick="selectCollection(${c.id})">
      <span class="collection-dot" style="background:${c.color}"></span>
      <span class="collection-name">${esc(c.name)}</span>
      <span class="collection-count">${c.count}</span>
    </button>
  `).join("");
}

function updateTypeCounts() {
  const counts = { all: 0, movies: 0, tv: 0, anime: 0 };
  state.collections.forEach(c => {
    counts.all += c.count;
    if (counts[c.type] !== undefined) counts[c.type] += c.count;
  });

  ["all", "movies", "tv", "anime"].forEach(t => {
    const el = document.getElementById(`count-${t}`);
    if (el) el.textContent = counts[t];
  });
}

async function selectCollection(id) {
  state.activeCollection = state.collections.find(c => c.id === id) || null;
  if (state.activeCollection) {
    state.activeType = state.activeCollection.type;
    document.querySelectorAll(".type-tab").forEach(el => {
      el.classList.toggle("active", el.dataset.type === state.activeType);
    });
  }
  state.page = 1;
  state.searchQuery = "";
  document.getElementById("main-search")?.value && (document.getElementById("main-search").value = "");
  document.getElementById("edit-collection-btn").style.display = state.activeCollection ? "inline-flex" : "none";
  document.getElementById("delete-collection-btn").style.display = state.activeCollection ? "inline-flex" : "none";
  document.getElementById("add-item-btn").style.display = state.activeCollection ? "inline-flex" : "none";
  renderSidebarCollections();
  await loadItems();
  renderViewHeader();
}

async function loadItems() {
  try {
    const raw = state.activeCollection
      ? await apiFetch(`/collections/${state.activeCollection.id}/items`)
      : await apiFetch(`/items?type=${state.activeType}`);
    state.items = raw;
    populateGenreFilter();
    renderItems();
  } catch (e) {
    toast("Could not load items: " + e.message, "error");
  }
}

// ── Item Rendering ─────────────────────────────────────────────────

function filteredItems() {
  let items = [...state.items];
  if (state.activeStatus !== "all")
    items = items.filter(i => i.status === state.activeStatus);
  if (state.searchQuery)
    items = items.filter(i => i.title.toLowerCase().includes(state.searchQuery.toLowerCase()));
  if (state.genreFilter !== "all")
    items = items.filter(i => parseJSON(i.genres).some(g => (g.name || g).toLowerCase() === state.genreFilter.toLowerCase()));
  if (state.watchFilter === "watched") items = items.filter(i => i.status === "completed");
  if (state.watchFilter === "unwatched") items = items.filter(i => i.status !== "completed");
  if (state.ratingFilter !== "all") items = items.filter(i => Number(i.rating || 0) >= Number(state.ratingFilter));
  const sorters = {
    "title-asc": (a, b) => a.title.localeCompare(b.title),
    "year-desc": (a, b) => Number(b.year || 0) - Number(a.year || 0),
    "rating-desc": (a, b) => Number(b.rating || 0) - Number(a.rating || 0),
    "rating-asc": (a, b) => Number(a.rating || 0) - Number(b.rating || 0),
    "added-desc": (a, b) => String(b.added || "").localeCompare(String(a.added || "")),
  };
  items.sort(sorters[state.sortBy] || sorters["added-desc"]);
  return items;
}

function populateGenreFilter() {
  const select = document.getElementById("genre-filter");
  if (!select) return;
  const genres = [...new Set(state.items.flatMap(i => parseJSON(i.genres).map(g => g.name || g)).filter(Boolean))].sort();
  if (state.genreFilter !== "all" && !genres.includes(state.genreFilter)) state.genreFilter = "all";
  select.innerHTML = `<option value="all">All genres</option>${genres.map(g => `<option value="${esc(g)}" ${g === state.genreFilter ? "selected" : ""}>${esc(g)}</option>`).join("")}`;
}

function paginatedItems() {
  const all = filteredItems();
  const start = (state.page - 1) * state.perPage;
  return { items: all.slice(start, start + state.perPage), total: all.length };
}

function renderItems() {
  const container = document.getElementById("items-container");
  if (!container) return;

  const { items, total } = paginatedItems();
  const pages = Math.ceil(total / state.perPage);

  if (!state.activeCollection && state.activeType === "collections") {
    container.innerHTML = `<div class="collections-page" id="collections-page-list"></div>`;
    renderCollectionsPage();
    renderPagination(0, 0);
    return;
  }

  if (!state.activeCollection && !state.items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎬</div>
        <div class="empty-title">Nothing saved yet</div>
        <div class="empty-desc">Create a collection, then add something to it.</div>
      </div>`;
    renderPagination(0, 0);
    return;
  }

  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <div class="empty-title">Nothing here</div>
        <div class="empty-desc">${state.searchQuery ? "No results for your search." : "Add something to this collection."}</div>
      </div>`;
    renderPagination(0, 0);
    return;
  }

  if (state.viewMode === "grid") {
    container.innerHTML = `<div class="items-grid">${items.map(renderCardGrid).join("")}</div>`;
  } else {
    container.innerHTML = `<div class="items-list">${items.map(renderCardList).join("")}</div>`;
  }

  renderPagination(state.page, pages);
}

function typeLabel(t) {
  return t === "movie" ? "Movie" : t === "tv" ? "TV" : "Anime";
}

function renderCardGrid(item) {
  const poster = item.poster
    ? `<img src="${esc(item.poster)}" alt="${esc(item.title)}" loading="lazy">`
    : `<div class="no-poster"><span>🎬</span></div>`;

  return `
    <div class="media-card" onclick="openDetail(${item.id})">
      <div class="media-card-poster">
        ${poster}
        <span class="media-card-badge">${typeLabel(item.type)}</span>
        ${item.rating ? `<span class="media-card-rating">⭐ ${item.rating}</span>` : ""}
      </div>
      <div class="media-card-body">
        <div class="media-card-title">${esc(item.title)}</div>
        <div class="media-card-meta">${item.year || "—"}</div>
        <span class="media-card-status status-${item.status}">${statusLabel(item.status)}</span>
      </div>
    </div>`;
}

function renderCardList(item) {
  const genres = parseJSON(item.genres).map(g => g.name || g).join(", ");
  return `
    <div class="media-list-item" onclick="openDetail(${item.id})">
      ${item.poster
        ? `<img class="media-list-poster" src="${esc(item.poster)}" alt="" loading="lazy">`
        : `<div class="media-list-poster" style="display:flex;align-items:center;justify-content:center;opacity:0.2;font-size:1.5rem">🎬</div>`}
      <div class="media-list-body">
        <div class="media-list-title">${esc(item.title)}</div>
        <div class="media-list-meta">${item.year || "—"} · ${typeLabel(item.type)}${genres ? " · " + esc(genres) : ""}</div>
        <div class="media-list-overview">${esc(item.overview || "")}</div>
      </div>
      <div class="media-list-actions">
        <span class="media-card-status status-${item.status}">${statusLabel(item.status)}</span>
        ${item.rating ? `<span style="font-size:0.75rem;opacity:0.6">⭐ ${item.rating}</span>` : ""}
        <button class="btn btn-sm btn-danger btn-icon" onclick="event.stopPropagation();deleteItem(${item.id})" title="Remove">✕</button>
      </div>
    </div>`;
}

function statusLabel(s) {
  const map = {
    watching: "Watching",
    completed: "Completed",
    plan_to_watch: "Plan to Watch",
    dropped: "Dropped",
    on_hold: "On Hold",
  };
  return map[s] || s;
}

function renderPagination(page, pages) {
  const el = document.getElementById("pagination");
  if (!el) return;
  if (pages <= 1) { el.innerHTML = ""; return; }

  let html = `<button class="page-btn" onclick="goPage(${page-1})" ${page===1?"disabled":""}>← Prev</button>`;

  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) {
      html += `<button class="page-btn ${i===page?"active":""}" onclick="goPage(${i})">${i}</button>`;
    } else if (Math.abs(i - page) === 2) {
      html += `<span style="opacity:0.4;padding:0 4px">…</span>`;
    }
  }

  html += `<button class="page-btn" onclick="goPage(${page+1})" ${page===pages?"disabled":""}>Next →</button>`;
  el.innerHTML = html;
}

function goPage(p) {
  state.page = p;
  renderItems();
  document.getElementById("items-container")?.scrollIntoView({ behavior: "smooth" });
}

// ── View Header ────────────────────────────────────────────────────

function renderViewHeader() {
  const title = document.getElementById("view-title");
  const subtitle = document.getElementById("view-subtitle");
  if (!title) return;

  if (!state.activeCollection) {
    if (state.activeType === "collections") {
      title.textContent = "Collections";
      if (subtitle) subtitle.textContent = `${state.collections.length} collections`;
    } else {
      title.textContent = state.activeType === "all" ? "Your Library" : typeLabel(state.activeType === "movies" ? "movie" : state.activeType);
      if (subtitle) subtitle.textContent = `${state.items.length} saved item${state.items.length === 1 ? "" : "s"}`;
    }
  } else {
    title.textContent = state.activeCollection.name;
    if (subtitle) subtitle.textContent = `${state.activeCollection.count} items · ${state.activeCollection.type}`;
  }
}

// ── Modals ─────────────────────────────────────────────────────────

function openModal(id) {
  document.getElementById(id)?.classList.add("open");
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove("open");
}

// close on backdrop click
document.addEventListener("click", e => {
  if (e.target.classList.contains("modal-backdrop")) {
    e.target.classList.remove("open");
  }
});

// ── Create Collection Modal ────────────────────────────────────────

function openCreateCollection() {
  document.getElementById("cc-name").value = "";
  document.getElementById("cc-type").value = ["movies", "tv", "anime"].includes(state.activeType) ? state.activeType : "movies";
  openModal("modal-create-collection");
  document.getElementById("cc-name").focus();
}

let selectedColor = "#FF6669";

function selectColor(el, color) {
  document.querySelectorAll("#modal-create-collection .color-swatch").forEach(s => s.classList.remove("selected"));
  el.classList.add("selected");
  selectedColor = color;
}

let editSelectedColor = "#FF6669";

function selectEditColor(el, color) {
  document.querySelectorAll("#modal-edit-collection .color-swatch").forEach(s => s.classList.remove("selected"));
  el.classList.add("selected");
  editSelectedColor = color;
}

function openEditCollection() {
  const collection = state.activeCollection;
  if (!collection) return;
  document.getElementById("ec-name").value = collection.name;
  document.getElementById("ec-type").value = collection.type;
  editSelectedColor = collection.color;
  document.querySelectorAll("#modal-edit-collection .color-swatch").forEach(s => {
    s.classList.toggle("selected", s.style.background.toLowerCase() === collection.color.toLowerCase());
  });
  openModal("modal-edit-collection");
  document.getElementById("ec-name").focus();
}

async function submitEditCollection() {
  const collection = state.activeCollection;
  const name = document.getElementById("ec-name").value.trim();
  if (!collection || !name) { toast("Name is required", "error"); return; }
  try {
    const updated = await apiFetch(`/collections/${collection.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name, type: document.getElementById("ec-type").value, color: editSelectedColor }),
    });
    const index = state.collections.findIndex(c => c.id === updated.id);
    state.collections[index] = { ...updated, count: collection.count };
    state.activeCollection = state.collections[index];
    closeModal("modal-edit-collection");
    renderSidebarCollections();
    renderViewHeader();
    toast("Collection updated", "success");
  } catch (e) { toast(e.message, "error"); }
}

async function submitCreateCollection() {
  const name = document.getElementById("cc-name").value.trim();
  const type = document.getElementById("cc-type").value;
  if (!name) { toast("Name is required", "error"); return; }

  try {
    const c = await apiFetch("/collections", {
      method: "POST",
      body: JSON.stringify({ name, type, color: selectedColor }),
    });
    state.collections.unshift({ ...c, count: 0 });
    renderSidebarCollections();
    updateTypeCounts();
    closeModal("modal-create-collection");
    selectCollection(c.id);
    toast(`"${name}" created`, "success");
  } catch (e) {
    toast(e.message, "error");
  }
}

// ── Add Item Modal ─────────────────────────────────────────────────

let searchTimer = null;
let searchType = "movie";

function openAddItem() {
  if (!state.activeCollection) { toast("Select a collection first", "error"); return; }
  searchType = state.activeCollection.type === "tv" ? "tv"
             : state.activeCollection.type === "anime" ? "anime"
             : "movie";
  document.getElementById("add-search").value = "";
  document.getElementById("search-results").innerHTML = "";
  setSearchType(searchType);
  openModal("modal-add-item");
  document.getElementById("add-search").focus();
}

function setSearchType(t) {
  searchType = t;
  document.querySelectorAll(".search-type-tab").forEach(el => {
    el.classList.toggle("active", el.dataset.type === t);
  });
  document.getElementById("search-results").innerHTML = "";
  const q = document.getElementById("add-search").value.trim();
  if (q) doSearch(q);
}

function onSearchInput(val) {
  clearTimeout(searchTimer);
  if (!val.trim()) { document.getElementById("search-results").innerHTML = ""; return; }
  searchTimer = setTimeout(() => doSearch(val.trim()), 420);
}

async function doSearch(q) {
  const el = document.getElementById("search-results");
  el.innerHTML = `<div style="opacity:0.5;text-align:center;padding:20px;font-size:0.8rem">Searching…</div>`;
  try {
    const data = await apiFetch(`/search?q=${encodeURIComponent(q)}&type=${searchType}`);
    renderSearchResults(data.results);
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><div class="empty-desc">${e.message}</div></div>`;
  }
}

function renderSearchResults(results) {
  const el = document.getElementById("search-results");
  if (!results.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-desc">No results found.</div></div>`;
    return;
  }
  el.innerHTML = `<div class="search-result-list">${results.map(r => `
    <div class="search-result">
      ${r.poster
        ? `<img class="search-result-poster" src="${esc(r.poster)}" loading="lazy">`
        : `<div class="search-result-poster" style="display:flex;align-items:center;justify-content:center;opacity:0.2">🎬</div>`}
      <div class="search-result-info">
        <div class="search-result-title">${esc(r.title)}</div>
        <div class="search-result-meta">${r.year || "—"}${r.rating ? ` · ⭐ ${r.rating}` : ""}</div>
        <div class="search-result-overview">${esc(r.overview || "")}</div>
      </div>
      <button class="search-result-add" onclick="addItem(${r.tmdb_id}, '${r.type}', this)">+ Add</button>
    </div>`).join("")}</div>`;
}

async function addItem(tmdbId, type, btn) {
  btn.disabled = true;
  btn.textContent = "Adding…";
  try {
    await apiFetch("/items", {
      method: "POST",
      body: JSON.stringify({ collection_id: state.activeCollection.id, tmdb_id: tmdbId, type }),
    });
    btn.textContent = "✓ Added";
    btn.style.background = "var(--chart-4)";
    // Refresh
    await loadCollections();
    await loadItems();
    renderViewHeader();
    toast("Added to collection", "success");
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "+ Add";
    if (e.message.includes("409") || e.message.toLowerCase().includes("already")) {
      toast("Already in collection", "info");
    } else {
      toast(e.message, "error");
    }
  }
}

// ── Item Detail Modal ──────────────────────────────────────────────

let activeDetailItem = null;

async function openDetail(itemId) {
  const item = state.items.find(i => i.id === itemId);
  if (!item) return;
  activeDetailItem = item;
  renderDetailModal(item);
  openModal("modal-detail");
}

function renderDetailModal(item) {
  const genres = parseJSON(item.genres);
  const cast   = parseJSON(item.cast);
  const crew   = parseJSON(item.crew);
  const directors = crew.filter(c => c.job === "Director" || c.job === "Series Director");

  const modal = document.getElementById("modal-detail-inner");
  modal.innerHTML = `
    ${item.backdrop
      ? `<img class="detail-backdrop-img" src="${esc(item.backdrop)}" alt="">`
      : ""}
    <div class="detail-body">
      ${item.poster
        ? `<img class="detail-poster" src="${esc(item.poster)}" alt="${esc(item.title)}">`
        : `<div class="detail-poster" style="aspect-ratio:2/3;display:flex;align-items:center;justify-content:center;background:var(--surface);opacity:0.3;font-size:3rem">🎬</div>`}
      <div class="detail-info">
        <div class="detail-title">${esc(item.title)}</div>
        <div class="detail-meta">
          <span>${item.year || "—"}</span>
          <span>${typeLabel(item.type)}</span>
          ${item.rating ? `<span>⭐ ${item.rating}/10</span>` : ""}
          ${directors.length ? `<span>Dir. ${esc(directors.map(d=>d.name).join(", "))}</span>` : ""}
        </div>
        ${genres.length ? `<div class="detail-genres">${genres.map(g => `<span class="genre-chip">${esc(g.name || g)}</span>`).join("")}</div>` : ""}
        <div class="detail-overview">${esc(item.overview || "")}</div>

        <div class="detail-section-title">Status</div>
        <div class="status-select-group">
          ${["watching","completed","plan_to_watch","dropped","on_hold"].map(s => `
            <button class="status-btn ${item.status === s ? 'active' : ''}"
                    onclick="setItemStatus(${item.id}, '${s}', this)">${statusLabel(s)}</button>
          `).join("")}
        </div>

        <div class="detail-section-title">Your Rating</div>
        <div class="rating-stars">
          ${[1,2,3,4,5,6,7,8,9,10].map(n => `
            <button class="star-btn ${(item.user_rating || 0) >= n ? 'on' : ''}"
                    onclick="setItemRating(${item.id}, ${n})">★</button>
          `).join("")}
        </div>

        <div class="detail-section-title">Notes</div>
        <textarea class="form-input" rows="3" placeholder="Your thoughts…"
                  id="detail-notes" onblur="saveNotes(${item.id})">${esc(item.user_notes || "")}</textarea>
      </div>
    </div>

    ${cast.length ? `
      <div style="padding:0 20px 20px">
        <div class="detail-section-title">Cast</div>
        <div class="cast-grid">
          ${cast.slice(0,12).map(c => `
            <div class="cast-chip">
              <div class="cast-name">${esc(c.name)}</div>
              <div class="cast-char">${esc(c.character || "")}</div>
            </div>`).join("")}
        </div>
      </div>` : ""}

    <div style="padding:0 20px 20px;display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-danger btn-sm" onclick="deleteItem(${item.id});closeModal('modal-detail')">Remove from Collection</button>
      ${item.md_path ? `<button class="btn btn-sm" onclick="toast('Obsidian file: '+${JSON.stringify(item.md_path || '')},'info')">📁 Obsidian File</button>` : ""}
    </div>`;
}

async function setItemStatus(itemId, status, btn) {
  try {
    const updated = await apiFetch(`/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ status }) });
    // Update local state
    const idx = state.items.findIndex(i => i.id === itemId);
    if (idx !== -1) state.items[idx] = updated;
    if (activeDetailItem?.id === itemId) activeDetailItem = updated;
    // Re-render status buttons
    document.querySelectorAll(".status-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    renderItems();
    toast("Status updated", "success");
  } catch (e) { toast(e.message, "error"); }
}

async function setItemRating(itemId, rating) {
  try {
    const updated = await apiFetch(`/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ user_rating: rating }) });
    const idx = state.items.findIndex(i => i.id === itemId);
    if (idx !== -1) state.items[idx] = updated;
    if (activeDetailItem?.id === itemId) activeDetailItem = updated;
    // Update stars UI
    document.querySelectorAll(".star-btn").forEach((btn, i) => {
      btn.classList.toggle("on", i < rating);
    });
    toast("Rating saved", "success");
  } catch (e) { toast(e.message, "error"); }
}

async function saveNotes(itemId) {
  const notes = document.getElementById("detail-notes")?.value || "";
  try {
    const updated = await apiFetch(`/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ user_notes: notes }) });
    const idx = state.items.findIndex(i => i.id === itemId);
    if (idx !== -1) state.items[idx] = updated;
    toast("Notes saved", "success");
  } catch (e) { toast(e.message, "error"); }
}

async function deleteItem(itemId) {
  if (!confirm("Remove from collection?")) return;
  try {
    const removedItem = state.items.find(i => i.id === itemId);
    await apiFetch(`/items/${itemId}`, { method: "DELETE" });
    state.items = state.items.filter(i => i.id !== itemId);
    // Update count
    const collectionId = state.activeCollection?.id || removedItem?.collection_id;
    const collection = state.collections.find(c => c.id === collectionId);
    if (collection) {
      collection.count = Math.max(0, (collection.count || 0) - 1);
      if (state.activeCollection?.id === collection.id) state.activeCollection = collection;
    }
    renderItems();
    renderViewHeader();
    renderSidebarCollections();
    toast("Removed", "info");
  } catch (e) { toast(e.message, "error"); }
}

// ── Delete Collection ─────────────────────────────────────────────

async function deleteCollection() {
  if (!state.activeCollection) return;
  if (!confirm(`Delete "${state.activeCollection.name}" and all its items?`)) return;
  try {
    await apiFetch(`/collections/${state.activeCollection.id}`, { method: "DELETE" });
    state.collections = state.collections.filter(c => c.id !== state.activeCollection.id);
    state.activeCollection = null;
    state.items = [];
    renderSidebarCollections();
    updateTypeCounts();
    renderViewHeader();
    renderItems();
    document.getElementById("edit-collection-btn").style.display = "none";
    document.getElementById("delete-collection-btn").style.display = "none";
    document.getElementById("add-item-btn").style.display = "none";
    toast("Collection deleted", "info");
  } catch (e) { toast(e.message, "error"); }
}

// ── Type filter ───────────────────────────────────────────────────

function setActiveType(type) {
  state.activeType = type;
  document.querySelectorAll(".type-tab").forEach(el => {
    el.classList.toggle("active", el.dataset.type === type);
  });
  state.activeCollection = null;
  document.getElementById("edit-collection-btn").style.display = "none";
  document.getElementById("delete-collection-btn").style.display = "none";
  document.getElementById("add-item-btn").style.display = "none";
  renderSidebarCollections();
  loadItems().then(renderViewHeader);
}

// ── Status filter ─────────────────────────────────────────────────

function setActiveStatus(status) {
  state.activeStatus = status;
  state.page = 1;
  document.querySelectorAll(".status-chip").forEach(el => {
    el.classList.toggle("active", el.dataset.status === status);
  });
  updateActiveFilterCount();
  renderItems();
}

function setGenreFilter(value) { state.genreFilter = value; state.page = 1; updateActiveFilterCount(); renderItems(); }
function setWatchFilter(value) { state.watchFilter = value; state.page = 1; updateActiveFilterCount(); renderItems(); }
function setRatingFilter(value) { state.ratingFilter = value; state.page = 1; updateActiveFilterCount(); renderItems(); }
function setSortBy(value) { state.sortBy = value; state.page = 1; renderItems(); }

function toggleFilterMenu() {
  const menu = document.getElementById("filter-menu");
  const trigger = document.getElementById("filter-menu-trigger");
  if (!menu || !trigger) return;
  const opening = menu.hidden;
  menu.hidden = !opening;
  trigger.setAttribute("aria-expanded", String(opening));
}

function closeFilterMenu() {
  const menu = document.getElementById("filter-menu");
  const trigger = document.getElementById("filter-menu-trigger");
  if (menu) menu.hidden = true;
  if (trigger) trigger.setAttribute("aria-expanded", "false");
}

function updateActiveFilterCount() {
  const count = [state.activeStatus, state.genreFilter, state.watchFilter, state.ratingFilter]
    .filter(value => value !== "all").length;
  const badge = document.getElementById("active-filter-count");
  if (!badge) return;
  badge.textContent = count;
  badge.hidden = count === 0;
}

function openCollectionsPage() {
  state.activeCollection = null;
  state.activeType = "collections";
  state.items = [];
  document.querySelectorAll(".type-tab").forEach(el => el.classList.remove("active"));
  document.getElementById("edit-collection-btn").style.display = "none";
  document.getElementById("delete-collection-btn").style.display = "none";
  document.getElementById("add-item-btn").style.display = "none";
  renderSidebarCollections(); renderViewHeader(); renderItems();
}

function renderCollectionsPage() {
  const list = document.getElementById("collections-page-list");
  if (!list) return;
  list.innerHTML = state.collections.length ? state.collections.map(c => `
    <button class="collection-page-card" style="--collection-color:${esc(c.color)}" onclick="selectCollection(${c.id})">
      <span>${esc(c.name)}</span><small>${c.count} item${c.count === 1 ? "" : "s"} · ${esc(typeLabel(c.type === "movies" ? "movie" : c.type))}</small>
    </button>`).join("") : `<div class="empty-state"><div class="empty-title">No collections yet</div></div>`;
}

// ── View mode ─────────────────────────────────────────────────────

function setViewMode(mode) {
  state.viewMode = mode;
  document.querySelectorAll(".view-toggle-btn").forEach(el => {
    el.classList.toggle("active", el.dataset.mode === mode);
  });
  renderItems();
}

// ── Global search ─────────────────────────────────────────────────

function onMainSearch(val) {
  state.searchQuery = val;
  state.page = 1;
  renderItems();
}

// ── Settings Modal ────────────────────────────────────────────────

async function openSettings() {
  try {
    const cfg = await apiFetch("/config");
    document.getElementById("s-tmdb-key").value = cfg.has_key ? "••••••••••••••••" : "";
    document.getElementById("s-vault-path").value = cfg.vault_path || "./vault";
    document.getElementById("s-google-font").value = cfg.custom_font_family || "";
  } catch (e) { /* ignore */ }
  openModal("modal-settings");
}

async function saveSettings() {
  const key = document.getElementById("s-tmdb-key").value.trim();
  const vault = document.getElementById("s-vault-path").value.trim();
  const customFontFamily = document.getElementById("s-google-font").value.trim();

  const payload = { vault_path: vault, custom_font_family: customFontFamily, custom_font_url: customFontFamily ? googleFontUrl(customFontFamily) : "" };
  if (key && !key.startsWith("••")) payload.tmdb_api_key = key;

  try {
    await apiFetch("/config", { method: "POST", body: JSON.stringify(payload) });
    applyCustomFont(customFontFamily);
    toast("Settings saved", "success");
    closeModal("modal-settings");
  } catch (e) { toast(e.message, "error"); }
}

// ── Util ──────────────────────────────────────────────────────────

function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseJSON(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val); } catch { return []; }
}

// ── Boot ──────────────────────────────────────────────────────────

async function init() {
  applyTheme(state.theme);
  await loadCollections();
  renderViewHeader();
  renderItems();

  // Check config
  try {
    const cfg = await apiFetch("/config");
    applyCustomFont(cfg.custom_font_family);
    if (!cfg.has_key) {
      document.getElementById("config-warning").style.display = "flex";
    }
  } catch (e) { /* server might not be up */ }
}

document.addEventListener("DOMContentLoaded", init);
document.addEventListener("click", event => {
  const menuWrap = event.target.closest(".filter-menu-wrap");
  if (!menuWrap) closeFilterMenu();
});
document.addEventListener("keydown", event => { if (event.key === "Escape") closeFilterMenu(); });
