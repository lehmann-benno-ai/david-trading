/* David Autopilot (owner only): David manages a separate demo fund funded from the demo broker's cash. */
const $ = (id) => document.getElementById(id);
const MAIN_KEY = "davidDemoBroker", AP_KEY = "davidAutopilot", RUN_EVERY = 30 * 60 * 1000;
const usd = (n) => n == null || isNaN(n) ? "—" : (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (n, d = 2) => n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null || isNaN(n) ? "—" : Math.abs(n) < 0.005 ? "0.00%" : (n > 0 ? "+" : "") + n.toFixed(2) + "%";
const shr = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 4 });
const cls = (n) => n == null ? "" : n >= 0 ? "up" : "down";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const vcls = (v) => v.includes("BUY") ? "b-buy" : v.includes("SELL") ? "b-sell" : "b-hold";

const load = (k) => JSON.parse(localStorage.getItem(k) || "null");
let ap = load(AP_KEY) || { cash: 0, funded: 0, positions: {}, history: [], runs: [], snapshots: [], risk: "balanced", auto: false, lastRun: 0, verdicts: {} };
let quotes = {}, running = false;
let chain = Promise.resolve();
function pushState(obj) {
  chain = chain.then(() => fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj), keepalive: true })
    .then((r) => { if (r.status === 401) location.href = "/login.html?next=/david"; else if (!r.ok) throw new Error(r.status); })
    .catch(() => toast("Couldn't save to your account. Check your connection.", true)));
}
const save = () => { localStorage.setItem(AP_KEY, JSON.stringify(ap)); pushState({ autopilot: ap }); };

function toast(msg, bad = false) {
  const t = $("toast"); t.textContent = msg; t.style.borderLeftColor = bad ? "var(--down)" : "var(--up)";
  t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 4000);
}
function showErr(msg) { $("ap-err").textContent = msg || ""; }

async function api(path, body) {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  if (r.status === 401) { location.href = "/login.html?next=/david"; throw new Error("Login required"); }
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

function totals() {
  let invested = 0;
  for (const [s, p] of Object.entries(ap.positions)) invested += quotes[s] ? p.shares * quotes[s].priceUsd : p.cost;
  const total = ap.cash + invested;
  return { invested, total, pl: total - ap.funded, plPct: ap.funded ? (total / ap.funded - 1) * 100 : 0 };
}

async function refreshQuotes() {
  const syms = Object.keys(ap.positions);
  if (syms.length) { try { Object.assign(quotes, await api(`/api/quote?symbols=${encodeURIComponent(syms.join(","))}`)); } catch {} }
  const t = totals();
  const last = ap.snapshots[ap.snapshots.length - 1];
  if (ap.funded > 0 && (!last || Date.now() - last.t > 5 * 60 * 1000)) { ap.snapshots.push({ t: Date.now(), v: t.total }); ap.snapshots = ap.snapshots.slice(-2000); save(); }
  render();
}

/* ---------- money in / out ---------- */
function moveMoney(amount, toDavid) {
  const main = load(MAIN_KEY);
  if (!main) throw new Error("You don't have a demo account yet. Open one on the Markets page first (yellow DEMO button).");
  if (!(amount > 0)) throw new Error("Enter an amount first.");
  if (toDavid) {
    if (amount > main.cash + 0.005) throw new Error(`Your demo account only has ${usd(main.cash)} cash.`);
    main.cash -= amount; ap.cash += amount; ap.funded += amount;
  } else {
    if (amount > ap.cash + 0.005) throw new Error(`David's fund only has ${usd(ap.cash)} in cash. Sell positions first.`);
    ap.cash -= amount; ap.funded = Math.max(0, ap.funded - amount); main.cash += amount;
  }
  localStorage.setItem(MAIN_KEY, JSON.stringify(main));
  localStorage.setItem(AP_KEY, JSON.stringify(ap));
  pushState({ broker: main, autopilot: ap });
}
$("ap-give").addEventListener("click", () => {
  showErr();
  try { const a = Number($("ap-amount").value); moveMoney(a, true); toast(`Gave ${usd(a)} demo money to David`); $("ap-amount").value = ""; refreshQuotes(); if (ap.auto) runDavid(); }
  catch (e) { showErr(e.message); }
});
$("ap-take").addEventListener("click", () => {
  showErr();
  try { const a = Number($("ap-amount").value); moveMoney(a, false); toast(`Moved ${usd(a)} back to your demo account`); $("ap-amount").value = ""; render(); }
  catch (e) { showErr(e.message); }
});
$("ap-close").addEventListener("click", async () => {
  showErr();
  if (!confirm("Sell all of David's positions and move all the money back to your demo account?")) return;
  try {
    const syms = Object.keys(ap.positions);
    if (syms.length) {
      const q = await api(`/api/quote?symbols=${encodeURIComponent(syms.join(","))}`);
      const trades = syms.filter((s) => q[s]).map((s) => ({ side: "sell", symbol: s, name: q[s].name, shares: ap.positions[s].shares, price: q[s].price, currency: q[s].currency, priceUsd: q[s].priceUsd, total: ap.positions[s].shares * q[s].priceUsd, reason: "You asked David to close the fund." }));
      applyTrades(trades, "Closed the fund on your request.");
    }
    const back = ap.cash;
    if (back > 0) moveMoney(back, false);
    ap.funded = 0; ap.auto = false; save();
    toast(`Returned ${usd(back)} to your demo account`); refreshQuotes();
  } catch (e) { showErr(e.message); }
});

/* ---------- David's runs ---------- */
function applyTrades(trades, note) {
  const done = [];
  for (const t of trades) {
    const p = ap.positions[t.symbol];
    if (t.side === "buy") {
      if (t.total > ap.cash + 0.01) continue;
      ap.cash = Math.max(0, ap.cash - t.total);
      const np = p || { shares: 0, cost: 0, name: t.name };
      np.shares += t.shares; np.cost += t.total; np.name = t.name; ap.positions[t.symbol] = np;
    } else {
      if (!p) continue;
      const sh = Math.min(t.shares, p.shares), total = sh * t.priceUsd, costPart = p.cost * (sh / p.shares);
      ap.cash += total; p.shares -= sh; p.cost -= costPart;
      if (p.shares < 1e-6) delete ap.positions[t.symbol];
      t.shares = sh; t.total = total; t.pl = total - costPart;
    }
    quotes[t.symbol] = Object.assign(quotes[t.symbol] || {}, { priceUsd: t.priceUsd, price: t.price, currency: t.currency, name: t.name });
    done.push(t);
  }
  const now = Date.now();
  done.forEach((t) => ap.history.unshift({ ...t, t: now }));
  ap.runs.unshift({ t: now, note, trades: done });
  ap.runs = ap.runs.slice(0, 200); ap.history = ap.history.slice(0, 1000);
  save();
}

async function runDavid() {
  if (running) return;
  showErr();
  if (ap.cash + Object.keys(ap.positions).length === 0) { showErr("Give David some demo money first."); return; }
  running = true; $("ap-run").disabled = true; $("ap-run").textContent = "David is analysing the market…";
  try {
    const positions = Object.fromEntries(Object.entries(ap.positions).map(([s, p]) => [s, { shares: p.shares, cost: p.cost }]));
    const plan = await api("/api/autopilot/plan", { cash: ap.cash, positions, risk: ap.risk });
    Object.assign(quotes, plan.quotes); ap.verdicts = plan.verdicts;
    applyTrades(plan.trades, plan.note);
    ap.lastRun = Date.now(); save();
    toast(plan.trades.length ? `David made ${plan.trades.length} trade(s)` : "David checked the market: no changes needed");
    refreshQuotes();
  } catch (e) { showErr("David couldn't finish: " + e.message); }
  finally { running = false; $("ap-run").disabled = false; $("ap-run").textContent = "Let David invest now"; }
}
$("ap-run").addEventListener("click", runDavid);
$("ap-auto").addEventListener("change", (e) => { ap.auto = e.target.checked; save(); render(); if (ap.auto && Date.now() - ap.lastRun > RUN_EVERY) runDavid(); });
$("ap-risk").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; ap.risk = b.dataset.risk; save(); render(); toast(`Risk level set to ${b.querySelector("b").textContent}. David uses it on his next check.`); });
$("logout").addEventListener("click", async () => {
  await chain;
  await fetch("/api/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  localStorage.removeItem(MAIN_KEY); localStorage.removeItem(AP_KEY); location.href = "/";
});

/* ---------- rendering ---------- */
const chart = LightweightCharts.createChart($("ap-chart"), {
  autoSize: true, layout: { background: { color: "#131722" }, textColor: "#d1d4dc" },
  grid: { vertLines: { color: "#1e222d" }, horzLines: { color: "#1e222d" } },
  rightPriceScale: { borderColor: "#2a2e39" }, timeScale: { borderColor: "#2a2e39", timeVisible: true },
});
const valueS = chart.addAreaSeries({ lineColor: "#26a69a", topColor: "#26a69a44", bottomColor: "#26a69a00", lineWidth: 2 });

function render() {
  const t = totals(), main = load(MAIN_KEY);
  $("ap-summary").innerHTML = [
    ["Fund value", usd(t.total)],
    ["Profit / loss", `<span class="${cls(t.pl)}">${usd(t.pl)} (${fmtPct(t.plPct)})</span>`],
    ["Cash in fund", usd(ap.cash)],
    ["Invested", usd(t.invested)],
    ["Money given to David", usd(ap.funded)],
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
  $("ap-main-cash").textContent = main ? `Cash in your demo account: ${usd(main.cash)}` : "No demo account yet. Open one on the Markets page first.";

  const pts = []; let lastT = 0;
  for (const s of ap.snapshots) { const tt = Math.floor(s.t / 1000); if (tt > lastT) { pts.push({ time: tt, value: s.v }); lastT = tt; } }
  valueS.setData(pts); $("ap-chart-empty").hidden = pts.length > 1; if (pts.length > 1) chart.timeScale().fitContent();

  const syms = Object.keys(ap.positions);
  $("ap-positions").innerHTML = `<tr><th>Stock</th><th class="num">Shares</th><th class="num">Avg cost</th><th class="num">Price</th><th class="num">Value</th><th class="num">Profit / loss</th><th>David's view</th></tr>` +
    (syms.length ? syms.map((s) => {
      const p = ap.positions[s], q = quotes[s], val = q ? p.shares * q.priceUsd : p.cost, pl = val - p.cost, v = ap.verdicts[s];
      return `<tr><td><a class="sym" href="/#${encodeURIComponent(s)}">${esc(s)}</a><div class="muted">${esc(p.name || "")}</div></td><td class="num">${shr(p.shares)}</td><td class="num">${usd(p.cost / p.shares)}</td>
        <td class="num">${q ? usd(q.priceUsd) : "—"}</td><td class="num">${usd(val)}</td><td class="num ${cls(pl)}">${usd(pl)}<br><small>${fmtPct((val / p.cost - 1) * 100)}</small></td>
        <td>${v ? `<span class="badge sm ${vcls(v.verdict)}">${v.verdict}</span>` : ""}</td></tr>`;
    }).join("") : `<tr><td colspan="7" class="empty">David doesn't hold anything yet. Give him demo money and press <b>Let David invest now</b>, or switch the autopilot on.</td></tr>`);

  $("ap-log").innerHTML = ap.runs.length ? ap.runs.slice(0, 30).map((r) => `<div class="run"><div class="run-head"><b>${new Date(r.t).toLocaleString()}</b><span>${esc(r.note)}</span></div>
    ${r.trades.length ? `<ul>${r.trades.map((x) => `<li><span class="side ${x.side === "buy" ? "up" : "down"}">${x.side.toUpperCase()}</span>${shr(x.shares)} ${esc(x.symbol)} for ${usd(x.total)}${x.pl != null ? ` <span class="${cls(x.pl)}">(${x.pl >= 0 ? "profit" : "loss"} ${usd(Math.abs(x.pl))})</span>` : ""}<span class="why">${esc(x.reason)}</span></li>`).join("")}</ul>` : ""}</div>`).join("")
    : '<p class="muted">Nothing yet.</p>';

  $("ap-auto").checked = ap.auto;
  $("ap-auto-label").textContent = ap.auto ? "On: David is in charge" : "Off";
  const nextIn = Math.max(0, RUN_EVERY - (Date.now() - ap.lastRun));
  $("ap-next").textContent = ap.auto ? (running ? "Checking now…" : `Next check in ${Math.ceil(nextIn / 60000)} min (only while this page is open).`) : ap.lastRun ? `Last check: ${new Date(ap.lastRun).toLocaleString()}` : "Switch on to let David trade automatically.";
  document.querySelectorAll("#ap-risk button").forEach((b) => b.classList.toggle("active", b.dataset.risk === ap.risk));
}

(async () => {
  try {
    const [me, st] = await Promise.all([api("/api/me"), api("/api/state")]);
    $("user-email").textContent = me.user ? me.user.email : "";
    if (st.broker) localStorage.setItem(MAIN_KEY, JSON.stringify(st.broker));
    else if (load(MAIN_KEY)) pushState({ broker: load(MAIN_KEY) });
    if (st.autopilot) ap = st.autopilot; else if (load(AP_KEY)) save();
    localStorage.setItem(AP_KEY, JSON.stringify(ap));
  } catch (e) { showErr("Couldn't load your account: " + e.message); }
  render();
  await refreshQuotes();
  if (ap.auto && Date.now() - ap.lastRun > RUN_EVERY) runDavid();
})();
setInterval(() => { refreshQuotes(); if (ap.auto && !running && Date.now() - ap.lastRun > RUN_EVERY) runDavid(); }, 60000);
