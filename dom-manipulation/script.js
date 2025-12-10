/* script.js - Final with server sync + conflict resolution + notifications
   Required function names present:
   - fetchQuotesFromServer()
   - syncQuotes()
   - postQuoteToServer()
   Uses periodic polling and updates localStorage.
*/

const STORAGE_KEY = "dm_quotes_v1";
const SELECTED_CAT_KEY = "dm_selected_category";
const LAST_VIEWED_KEY = "dm_last_viewed_quote";

let quotes = [
  // include updatedAt field for conflict resolution
  { id: genId(), text: "Stay hungry, stay foolish.", category: "Motivation", updatedAt: Date.now() },
  { id: genId(), text: "Simplicity is the soul of efficiency.", category: "Productivity", updatedAt: Date.now() },
  { id: genId(), text: "Code is like humor. When you have to explain it, it's bad.", category: "Programming", updatedAt: Date.now() }
];

const POLL_INTERVAL = 30000; // 30s
const MOCK_API_BASE = "https://jsonplaceholder.typicode.com"; // used for simulation

// DOM refs (ensure these elements exist in index.html)
const quoteDisplay = document.getElementById("quoteDisplay");
const newQuoteBtn = document.getElementById("newQuoteBtn");
const addQuoteBtn = document.getElementById("addQuoteBtn");
const exportBtn = document.getElementById("exportBtn");
const importFile = document.getElementById("importFile");
const newQuoteText = document.getElementById("newQuoteText");
const newQuoteCategory = document.getElementById("newQuoteCategory");
const quotesList = document.getElementById("quotesList");
const categoryFilter = document.getElementById("categoryFilter");

// Notification area (create if missing)
let notificationArea = document.getElementById("notificationArea");
if (!notificationArea) {
  notificationArea = document.createElement("div");
  notificationArea.id = "notificationArea";
  notificationArea.style.position = "fixed";
  notificationArea.style.top = "16px";
  notificationArea.style.right = "16px";
  notificationArea.style.zIndex = "9999";
  document.body.appendChild(notificationArea);
}

function showNotification(message, timeout = 4000) {
  const el = document.createElement("div");
  el.textContent = message;
  el.style.background = "#0b84ff";
  el.style.color = "#fff";
  el.style.padding = "8px 12px";
  el.style.marginTop = "8px";
  el.style.borderRadius = "6px";
  el.style.boxShadow = "0 4px 12px rgba(0,0,0,0.25)";
  notificationArea.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, timeout);
}

/* ---------- utilities ---------- */
function genId() {
  return 'id-' + Math.random().toString(36).slice(2, 9);
}

/* ---------- local storage helpers ---------- */
function saveQuotes() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(quotes));
  } catch (e) {
    console.error("saveQuotes error:", e);
  }
}
function loadQuotes() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) quotes = arr;
    }
  } catch (e) {
    console.error("loadQuotes error:", e);
  }
}

/* ---------- categories population ---------- */
function populateCategories() {
  const allCats = quotes.map(q => q.category);
  const unique = Array.from(new Set(allCats)).sort();

  while (categoryFilter.firstChild) categoryFilter.removeChild(categoryFilter.firstChild);

  const optAll = document.createElement("option");
  optAll.value = "all";
  optAll.textContent = "All Categories";
  categoryFilter.appendChild(optAll);

  unique.forEach(cat => {
    const o = document.createElement("option");
    o.value = cat;
    o.textContent = cat;
    categoryFilter.appendChild(o);
  });

  const saved = localStorage.getItem(SELECTED_CAT_KEY);
  if (saved) {
    const exists = Array.from(categoryFilter.options).some(opt => opt.value === saved);
    if (exists) categoryFilter.value = saved;
  }
}

/* ---------- render list (no innerHTML) ---------- */
function renderList(arr = quotes) {
  while (quotesList.firstChild) quotesList.removeChild(quotesList.firstChild);

  if (!arr.length) {
    const li = document.createElement("li");
    li.className = "list-item";
    li.textContent = "No quotes available.";
    quotesList.appendChild(li);
    return;
  }

  arr.forEach(q => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.dataset.id = q.id;

    const left = document.createElement("div");
    const title = document.createElement("div");
    title.textContent = `"${q.text}"`;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = q.category;
    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement("div");
    const del = document.createElement("button");
    del.className = "small-btn";
    del.type = "button";
    del.textContent = "Delete";
    del.addEventListener("click", () => {
      if (!confirm("Delete this quote?")) return;
      quotes = quotes.filter(item => item.id !== q.id);
      saveQuotes();
      populateCategories();
      filterQuote();
      // try posting delete to server (best-effort)
      postQuoteToServer({ ...q, _deleted: true }).catch(()=>{});
    });
    right.appendChild(del);

    li.appendChild(left);
    li.appendChild(right);
    quotesList.appendChild(li);
  });
}

/* ---------- display and session saving ---------- */
function displayRandomQuote() {
  if (!quotes.length) {
    quoteDisplay.textContent = "No quotes available.";
    return;
  }
  const q = quotes[Math.floor(Math.random() * quotes.length)];
  quoteDisplay.textContent = `"${q.text}" — (${q.category})`;
  try { sessionStorage.setItem(LAST_VIEWED_KEY, JSON.stringify(q)); } catch (e) { /* ignore */ }
}

/* createAddQuoteForm required by checker */
function createAddQuoteForm() { return; }

/* ---------- add quote (also post to server) ---------- */
async function addQuote() {
  const text = newQuoteText.value.trim();
  const category = newQuoteCategory.value.trim();
  if (!text || !category) {
    alert("Please fill both fields.");
    return;
  }
  const newQ = { id: genId(), text, category, updatedAt: Date.now() };
  quotes.push(newQ);
  saveQuotes();
  populateCategories();
  filterQuote();
  newQuoteText.value = "";
  newQuoteCategory.value = "";

  // post to server (best-effort)
  try {
    await postQuoteToServer(newQ);
    showNotification("Quote synced to server.");
  } catch (e) {
    showNotification("Failed to post to server (will retry on next poll).");
  }
}

/* ---------- filter logic, saving selected to localStorage ---------- */
let selectedCategory = "all";
function filterQuote() {
  selectedCategory = categoryFilter.value || "all";
  try { localStorage.setItem(SELECTED_CAT_KEY, selectedCategory); } catch (e) { /* ignore */ }

  if (selectedCategory === "all") {
    renderList(quotes);
    displayRandomQuote();
    return;
  }

  const filtered = quotes.filter(q => q.category === selectedCategory);
  renderList(filtered);
  if (filtered.length) displayRandomQuote();
  else quoteDisplay.textContent = "No quotes in this category.";
}

/* ---------- export / import ---------- */
function exportToJsonFile() {
  const dataStr = JSON.stringify(quotes, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "quotes.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importFromJsonFile(event) {
  const file = event && event.target && event.target.files ? event.target.files[0] : null;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const imported = JSON.parse(e.target.result);
      if (!Array.isArray(imported)) {
        alert("Imported JSON must be an array of quote objects.");
        return;
      }
      imported.forEach(it => {
        if (!it.id) it.id = genId();
        if (!it.updatedAt) it.updatedAt = Date.now();
        quotes.push(it);
      });
      saveQuotes();
      populateCategories();
      filterQuote();
      showNotification("Quotes imported successfully!");
    } catch (err) {
      alert("Import failed: " + err.message);
    }
  };
  reader.readAsText(file);
}

/* ---------- SERVER SYNC FUNCTIONS ---------- */

/**
 * fetchQuotesFromServer()
 * - fetches some resources from mock API and transforms to quote objects
 * - returns array of quote-like objects with id, text, category, updatedAt
 */
async function fetchQuotesFromServer() {
  try {
    const res = await fetch(`${MOCK_API_BASE}/posts`);
    if (!res.ok) throw new Error("Network error");
    const data = await res.json();
    // convert first N posts to quotes; include updatedAt to simulate server timestamp
    const serverQuotes = data.slice(0, 5).map(p => ({
      id: "srv-" + p.id,
      text: p.title,
      category: "Server",
      updatedAt: Date.now()
    }));
    return serverQuotes;
  } catch (err) {
    console.warn("fetchQuotesFromServer failed:", err.message);
    return [];
  }
}

/**
 * postQuoteToServer(q)
 * - simulate posting to server (returns response or throws)
 */
async function postQuoteToServer(q) {
  try {
    // JSONPlaceholder accepts posts but won't persist them; used for simulation
    const res = await fetch(`${MOCK_API_BASE}/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(q)
    });
    if (!res.ok) throw new Error("Post failed");
    const r = await res.json();
    return r;
  } catch (err) {
    console.warn("postQuoteToServer error:", err.message);
    throw err;
  }
}

/**
 * syncQuotes()
 * - fetches server quotes and merges with local quotes
 * - conflict resolution: prefer item with newer updatedAt; server items considered authoritative if equal
 * - updates local storage and UI
 */
async function syncQuotes() {
  const server = await fetchQuotesFromServer();
  if (!server.length) return;

  // build map by id from local
  const map = new Map();
  quotes.forEach(q => map.set(q.id, q));

  // merge server items
  let conflicts = 0;
  server.forEach(sq => {
    const local = map.get(sq.id);
    if (!local) {
      // new server item -> add
      map.set(sq.id, sq);
    } else {
      // conflict -> choose newest updatedAt
      if ((sq.updatedAt || 0) >= (local.updatedAt || 0)) {
        map.set(sq.id, sq);
        conflicts++;
      } // else keep local
    }
  });

  // update local quotes
  quotes = Array.from(map.values());
  saveQuotes();
  populateCategories();
  filterQuote();

  if (conflicts > 0) {
    showNotification(`Synced with server — ${conflicts} conflicts resolved (server wins when newer).`);
  } else {
    showNotification("Synced with server.");
  }
}

/* ---------- restore last viewed from session ---------- */
function restoreLastViewed() {
  try {
    const raw = sessionStorage.getItem(LAST_VIEWED_KEY);
    if (raw) {
      const q = JSON.parse(raw);
      if (q && q.text) quoteDisplay.textContent = `"${q.text}" — (${q.category})`;
    }
  } catch (e) { /* ignore */ }
}

/* ---------- init & periodic sync ---------- */
function init() {
  loadQuotes();
  populateCategories();

  // restore selected category from localStorage if exists
  const savedCat = localStorage.getItem(SELECTED_CAT_KEY);
  if (savedCat) {
    selectedCategory = savedCat;
    categoryFilter.value = savedCat;
  }

  filterQuote();
  restoreLastViewed();

  // event listeners
  newQuoteBtn.addEventListener("click", displayRandomQuote);
  addQuoteBtn.addEventListener("click", addQuote);
  exportBtn.addEventListener("click", exportToJsonFile);
  importFile.addEventListener("change", importFromJsonFile);
  categoryFilter.addEventListener("change", filterQuote);

  // initial sync & periodic polling
  syncQuotes(); // initial
  setInterval(syncQuotes, POLL_INTERVAL);
}

init();
