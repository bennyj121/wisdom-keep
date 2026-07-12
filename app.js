/* Wisdom Keep — Rooted daily etymology game */
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

let session = null;
let profile = null;
let puzzle = null;          // today's puzzle payload from the API
let cluesRevealed = 1;      // Origin clue is free
let solvedToday = false;
let archiveMode = null;     // date string when playing an archive puzzle

/* ---------- local state for anonymous players ---------- */
const LS_KEY = "wk_state";
function localState() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || { plays: {}, lore: 0, streak: 0, lastPlayed: null }; }
  catch { return { plays: {}, lore: 0, streak: 0, lastPlayed: null }; }
}
function saveLocal(s) { localStorage.setItem(LS_KEY, JSON.stringify(s)); }

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
function esc(s) { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML; }

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (session) headers["Authorization"] = `Bearer ${session.access_token}`;
  const res = await fetch(`${CONFIG.FUNCTIONS_URL}/${path}`, { ...opts, headers });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/* ---------- views ---------- */
function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  $(`view-${name}`).classList.remove("hidden");
  document.querySelectorAll("nav button[data-view]").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === name));
  if (name === "kingdom") renderKingdom();
  if (name === "archive") renderArchive();
  window.scrollTo(0, 0);
}

/* ---------- auth ---------- */
function onAuthClick() {
  if (session) showView("account"), renderAccount();
  else $("authModal").classList.remove("hidden");
}
function closeAuth() { $("authModal").classList.add("hidden"); }

async function sendMagicLink(e) {
  e.preventDefault();
  const email = $("emailInput").value.trim();
  $("authMsg").textContent = "Sending…";
  const { error } = await sb.auth.signInWithOtp({
    email, options: { emailRedirectTo: CONFIG.SITE_URL },
  });
  $("authMsg").textContent = error ? error.message : "Sent! Check your inbox.";
  if (!error) $("otpStep").classList.remove("hidden");
  return false;
}
async function verifyCode(e) {
  e.preventDefault();
  const email = $("emailInput").value.trim();
  const token = $("codeInput").value.trim();
  const { error } = await sb.auth.verifyOtp({ email, token, type: "email" });
  $("authMsg").textContent = error ? error.message : "Signed in!";
  if (!error) closeAuth();
  return false;
}
async function signOut() { await sb.auth.signOut(); location.reload(); }

async function loadProfile() {
  if (!session) { profile = null; updateStatusBar(); return; }
  const { data } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  profile = data;
  updateStatusBar();
}
function isPremium() {
  return !!profile?.is_premium && (!profile.premium_until || new Date(profile.premium_until) > new Date());
}
function updateStatusBar() {
  const bar = $("statusBar");
  const s = session && profile ? profile : localState();
  bar.classList.remove("hidden");
  $("loreVal").textContent = s.lore ?? 0;
  $("streakVal").textContent = s.streak ?? 0;
  $("premiumBadge").classList.toggle("hidden", !isPremium());
  $("authBtn").textContent = session ? "Account" : "Sign in";
}

/* ---------- game ---------- */
async function loadPuzzle() {
  const { body } = await api("game?action=today");
  puzzle = body;
  $("puzzleNum").textContent = `#${body.number}`;
  const prior = playRecord(body.date);
  if (prior) { renderAlreadyPlayed(prior); return; }
  cluesRevealed = 1;
  renderClues();
}
function playRecord(date) {
  if (session && profile) return null; // server refuses duplicates; simple client check below via localStorage too
  return localState().plays[date] || null;
}
function renderClues() {
  const list = $("clueList");
  list.innerHTML = "";
  puzzle.clues.slice(0, cluesRevealed).forEach((c) => {
    list.insertAdjacentHTML("beforeend",
      `<div class="clue-card"><div class="k">${esc(c.k)}</div><div class="v">${esc(c.v)}</div></div>`);
  });
  const left = puzzle.clues.length - cluesRevealed;
  if (left > 0) {
    list.insertAdjacentHTML("beforeend",
      `<div class="clue-card clue-locked">${left} more clue${left > 1 ? "s" : ""} available — each reveal lowers your Lore reward</div>`);
    $("revealBtn").classList.remove("hidden");
  } else {
    $("revealBtn").classList.add("hidden");
    $("giveUpBtn").classList.remove("hidden");
  }
  $("guessInput").placeholder = `${puzzle.wordLength}-letter word…`;
}
function revealClue() {
  if (cluesRevealed < puzzle.clues.length) { cluesRevealed++; renderClues(); }
}
async function submitGuess(e) {
  e.preventDefault();
  const guess = $("guessInput").value.trim();
  if (!guess || solvedToday) return false;
  const { body } = await api("game", {
    method: "POST",
    body: JSON.stringify({
      action: "guess", guess, cluesUsed: cluesRevealed,
      date: archiveMode || undefined,
    }),
  });
  if (body.error) { alert(body.error); return false; }
  if (body.correct) finishGame(body, true);
  else {
    $("guessLog").insertAdjacentHTML("beforeend", `<span class="wrong-guess">${esc(guess)}</span>`);
    $("guessInput").value = "";
    if (cluesRevealed >= puzzle.clues.length) $("giveUpBtn").classList.remove("hidden");
  }
  return false;
}
async function giveUp() {
  const { body } = await api("game", {
    method: "POST",
    body: JSON.stringify({ action: "giveup", cluesUsed: cluesRevealed, date: archiveMode || undefined }),
  });
  if (body.word) finishGame(body, false);
}
function finishGame(result, solved) {
  solvedToday = true;
  $("guessForm").classList.add("hidden");
  $("revealBtn").classList.add("hidden");
  $("giveUpBtn").classList.add("hidden");

  // record locally for anonymous players (server records for signed-in)
  if (!session && !archiveMode) {
    const s = localState();
    const today = puzzle.date;
    if (!s.plays[today]) {
      const yest = new Date(Date.parse(today) - 864e5).toISOString().slice(0, 10);
      s.streak = solved ? (s.lastPlayed === yest ? s.streak + 1 : 1) : 0;
      s.lastPlayed = today;
      const base = [50, 40, 30, 20, 12][cluesRevealed - 1];
      s.plays[today] = { solved, clues: cluesRevealed, lore: solved ? base : 0 };
      s.lore += solved ? base : 0;
      saveLocal(s);
    }
  }
  loadProfile().then(updateStatusBar);
  updateStatusBar();

  const grid = solved ? "🌱".repeat(Math.max(cluesRevealed - 1, 0)) + "🌳" : "🥀";
  const shareText = `Rooted #${puzzle.number} ${grid} (${cluesRevealed}/5 clues)\n${CONFIG.SITE_URL}`;
  $("resultCard").classList.remove("hidden");
  $("resultCard").innerHTML = `
    <div>${solved ? "🎉 Rooted out!" : "The word escapes you today…"}</div>
    <div class="big-word">${esc(result.word)}</div>
    <div class="fact">${esc(result.fact)}</div>
    ${result.lore ? `<div class="lore-earned">+${result.lore} Lore ${result.streak > 1 ? `· 🔥 ${result.streak}-day streak` : ""}</div>` : ""}
    ${!session ? `<p class="sub">📖 <a href="#" onclick="onAuthClick();return false;">Sign in</a> to bank your Lore and build your Kingdom.</p>` : ""}
    <button class="gold-btn" onclick="share(\`${shareText.replace(/`/g, "")}\`)">Share result</button>
    ${archiveMode ? `<button class="ghost-btn" onclick="location.reload()">Back to today's puzzle</button>` : ""}
  `;
}
function renderAlreadyPlayed(rec) {
  $("clueList").innerHTML = "";
  $("guessForm").classList.add("hidden");
  $("revealBtn").classList.add("hidden");
  $("resultCard").classList.remove("hidden");
  $("resultCard").innerHTML = `
    <div>You've already played today — ${rec.solved ? "and solved it! 🌳" : "better luck tomorrow 🥀"}</div>
    <p class="sub" style="margin-top:12px">A new word takes root at midnight UTC.</p>
    ${!session ? `<p class="sub">📖 <a href="#" onclick="onAuthClick();return false;">Sign in</a> to bank your Lore and build your Kingdom.</p>` : ""}
  `;
}
function share(text) {
  if (navigator.share) navigator.share({ text }).catch(() => {});
  else navigator.clipboard.writeText(text).then(() => alert("Result copied — paste it anywhere!"));
}

/* ---------- kingdom ---------- */
async function renderKingdom() {
  const map = $("kingdomMap");
  const shop = $("buildingShop");
  const { data: catalog } = await sb.from("buildings").select("*").order("sort");
  let owned = new Set();
  if (session) {
    const { data } = await sb.from("user_buildings").select("building_id").eq("user_id", session.user.id);
    owned = new Set((data || []).map((x) => x.building_id));
  }
  map.innerHTML = owned.size
    ? [...(catalog || [])].filter((b) => owned.has(b.id))
        .map((b) => `<div class="map-building">${b.emoji}<small>${esc(b.name)}</small></div>`).join("")
    : `<span class="empty-note">🌄 Empty hills await. Solve puzzles, earn Lore, and raise your first building.</span>`;

  if (!session) {
    shop.innerHTML = `<p class="sub">✨ <a href="#" onclick="onAuthClick();return false;">Sign in</a> to start building — your progress will be saved forever.</p>`;
    return;
  }
  const lore = profile?.lore ?? 0;
  shop.innerHTML = (catalog || []).map((b) => {
    const own = owned.has(b.id);
    const lockPremium = b.premium_only && !isPremium();
    const lockStreak = (profile?.best_streak ?? 0) < b.streak_required;
    const locked = lockPremium || lockStreak;
    let btn;
    if (own) btn = `<span style="color:var(--green)">Built ✓</span>`;
    else if (lockPremium) btn = `<button class="build-btn" onclick="showView('pass')">👑 Pass</button>`;
    else if (lockStreak) btn = `<button class="build-btn" disabled>🔥 ${b.streak_required}-day streak</button>`;
    else btn = `<button class="build-btn" ${lore < b.cost ? "disabled" : ""} onclick="build('${b.id}')">Build · ${b.cost} 📖</button>`;
    return `<div class="building-row ${own ? "owned" : locked ? "locked" : ""}">
      <div><div class="name">${b.emoji} ${esc(b.name)}</div><div class="desc">${esc(b.description)}</div></div>
      ${btn}</div>`;
  }).join("");
}
async function build(id) {
  const { data, error } = await sb.rpc("build_structure", { bid: id });
  if (error) return alert(error.message);
  if (data.error) return alert(data.error);
  await loadProfile();
  renderKingdom();
}

/* ---------- archive ---------- */
async function renderArchive() {
  const el = $("archiveBody");
  if (!session) {
    el.innerHTML = `<p class="sub">The archive of every past puzzle is a <a href="#" onclick="showView('pass');return false;">Kingdom Pass</a> perk. <a href="#" onclick="onAuthClick();return false;">Sign in</a> first.</p>`;
    return;
  }
  const { status, body } = await api("game?action=archive");
  if (status === 402) {
    el.innerHTML = `<p class="sub">🗝️ Unlock every past puzzle with the <a href="#" onclick="showView('pass');return false;">Kingdom Pass</a> — $4/month.</p>`;
    return;
  }
  if (!body.puzzles?.length) { el.innerHTML = `<p class="sub">No past puzzles yet — Rooted is brand new! Come back tomorrow.</p>`; return; }
  el.innerHTML = `<div class="archive-grid">` + body.puzzles.map((p) =>
    `<div class="archive-row" onclick="playArchive('${p.date}')">
       <span>#${p.number} · ${p.date} <small style="color:var(--ink-dim)">(${esc(p.language)})</small></span>
       <span>${p.played ? (p.solved ? "🌳" : "🥀") : "▶️ Play"}</span>
     </div>`).join("") + `</div>`;
}
async function playArchive(date) {
  const { body } = await api("game", {
    method: "POST", body: JSON.stringify({ action: "archive_puzzle", date }),
  });
  if (body.error) return alert(body.error);
  puzzle = body;
  archiveMode = date;
  solvedToday = false;
  cluesRevealed = 1;
  $("puzzleNum").textContent = `#${body.number} (archive)`;
  $("resultCard").classList.add("hidden");
  $("guessForm").classList.remove("hidden");
  $("guessLog").innerHTML = "";
  showView("play");
  renderClues();
}

/* ---------- payments ---------- */
async function checkout(plan) {
  if (!session) { onAuthClick(); return; }
  $("payMsg").textContent = "Opening checkout…";
  const { status, body } = await api("stripe-checkout", {
    method: "POST", body: JSON.stringify({ plan }),
  });
  if (status === 503) { $("payMsg").textContent = "⚒️ Payments are being forged — the Kingdom Pass launches very soon!"; return; }
  if (body.url) location.href = body.url;
  else $("payMsg").textContent = body.error || "Something went wrong.";
}

/* ---------- account ---------- */
function renderAccount() {
  $("accountBody").innerHTML = `
    <div class="stat-line">✉️ ${esc(session.user.email)}</div>
    <div class="stat-line">📖 Lore: <b>${profile?.lore ?? 0}</b></div>
    <div class="stat-line">🔥 Streak: <b>${profile?.streak ?? 0}</b> (best ${profile?.best_streak ?? 0})</div>
    <div class="stat-line">👑 Kingdom Pass: <b>${isPremium() ? "Active" : "Not active"}</b></div>
    <br><button class="ghost-btn" onclick="signOut()">Sign out</button>`;
}

/* ---------- init ---------- */
(async function init() {
  const { data } = await sb.auth.getSession();
  session = data.session;
  sb.auth.onAuthStateChange((_e, s) => { session = s; loadProfile(); });
  await loadProfile();
  await loadPuzzle();
  if (new URLSearchParams(location.search).get("upgraded")) {
    alert("👑 Welcome to the Kingdom Pass! Your archive and golden buildings are unlocked.");
    history.replaceState({}, "", location.pathname);
  }
})();
