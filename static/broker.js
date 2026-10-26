/* Demo broker: paper trading with play money, stored in localStorage. */
const KEY = "davidDemoBroker";
const usd = (n) => n == null || isNaN(n) ? "—" : (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shr = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 4 });
const AP_KEY = "davidAutopilot";
const account = { user: null, chain: Promise.resolve() };
/* logged-in users: every change is also saved to their account on the server, in order */
function pushState(obj) {
  if (!account.user) return;
  account.chain = account.chain.then(() => fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj), keepalive: true })
    .then((r) => { if (!r.ok) throw new Error(r.status); }).catch(() => toast("Couldn't save to your account. Check your connection.", true)));
}
const broker = {
  acct: JSON.parse(localStorage.getItem(KEY) || "null"),
  quotes: {},
  save() { localStorage.setItem(KEY, JSON.stringify(this.acct)); pushState({ broker: this.acct }); },
};

function toast(msg, bad = false) {
  const t = $("toast");
  t.textContent = msg; t.style.borderLeftColor = bad ? "var(--down)" : "var(--up)";
  t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 3500);
}

async function fetchQuotes(symbols) {
  if (!symbols.length) return {};
  const q = await api(`/api/quote?symbols=${encodeURIComponent(symbols.join(","))}`);
  Object.assign(broker.quotes, q);
  return q;
}

function davidFund() {
  const ap = JSON.parse(localStorage.getItem("davidAutopilot") || "null");
  if (!ap) return { value: 0, syms: [] };
  let value = ap.cash;
  for (const [s, p] of Object.entries(ap.positions)) value += broker.quotes[s] ? p.shares * broker.quotes[s].priceUsd : p.cost;
  return { value, syms: Object.keys(ap.positions) };
}

function portfolioTotals() {
  const a = broker.acct;
  let value = 0, cost = 0;
  for (const [s, p] of Object.entries(a.positions)) {
    const q = broker.quotes[s];
    value += q ? p.shares * q.priceUsd : p.cost;
    cost += p.cost;
  }
  const fund = davidFund().value;
  const total = a.cash + value + fund;
  return { value, cost, fund, total, pl: total - a.startCash, plPct: (total / a.startCash - 1) * 100 };
}

async function refreshAccountButton() {
  if (!broker.acct) { $("acct-value").textContent = "Start demo trading"; renderHoldbar(); return; }
  try { await fetchQuotes([...Object.keys(broker.acct.positions), ...davidFund().syms]); } catch {}
  updatePositionLines();
  const t = portfolioTotals();
  $("acct-value").innerHTML = `${usd(t.total)} <span class="${cls(t.pl)}">${fmtPct(t.plPct)}</span>`;
  renderHoldbar();
}

/* second row under the ticker: the user's own positions, foldable */
function renderHoldbar() {
  const bar = $("holdbar"), pos = broker.acct ? Object.entries(broker.acct.positions) : [];
  bar.hidden = !pos.length;
  if (pos.length) {
    let value = 0, cost = 0;
    $("hb-track").innerHTML = pos.map(([s, p]) => {
      const q = broker.quotes[s], v = q ? p.shares * q.priceUsd : p.cost, pl = v - p.cost;
      value += v; cost += p.cost;
      return `<button class="hb-item${s === state.symbol ? " active" : ""}" data-s="${esc(s)}" title="${esc(shr(p.shares))} shares, bought for ${usd(p.cost)}"><span class="s">${esc(label(s))}</span><span class="v">${usd(v)}</span><span class="${cls(pl)}">${fmtPct((v / p.cost - 1) * 100)}</span><span class="${cls(pl)} hb-pl">${pl >= 0 ? "+" : ""}${usd(pl)}</span></button>`;
    }).join("");
    const pl = value - cost;
    $("hb-sum").innerHTML = `<span class="hb-n">${pos.length}</span><span class="${cls(pl)}">${pl >= 0 ? "+" : ""}${usd(pl)} · ${fmtPct((value / cost - 1) * 100)}</span>`;
    const folded = localStorage.getItem("holdbarFolded") === "1";
    bar.classList.toggle("folded", folded);
    $("hb-tab").setAttribute("aria-expanded", String(!folded));
  }
  document.documentElement.style.setProperty("--hb", (bar.hidden ? 0 : bar.offsetHeight) + "px");
}
$("hb-tab").addEventListener("click", () => {
  localStorage.setItem("holdbarFolded", $("holdbar").classList.contains("folded") ? "0" : "1");
  renderHoldbar();
});
$("hb-track").addEventListener("click", (e) => { const b = e.target.closest(".hb-item"); if (b) selectSymbol(b.dataset.s); });
document.addEventListener("chartloaded", () => { if (!$("holdbar").hidden) renderHoldbar(); });

document.querySelectorAll("dialog [data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

/* ---------- setup ---------- */
let afterSetup = null;
function openSetup(next) {
  afterSetup = next || null;
  $("setup-dlg").showModal();
}
$("amounts").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  $("amounts").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
  $("setup-amount").value = b.dataset.amt;
});
$("setup-amount").addEventListener("input", () => $("amounts").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x.dataset.amt === $("setup-amount").value)));
$("setup-form").addEventListener("submit", () => {
  const amt = Math.round(Number($("setup-amount").value) * 100) / 100;
  broker.acct = { startCash: amt, cash: amt, positions: {}, history: [], createdAt: Date.now() };
  broker.save();
  refreshAccountButton();
  toast(`Demo account opened with ${usd(amt)} play money`);
  const next = afterSetup; afterSetup = null;
  if (next) setTimeout(next, 50);
});

/* ---------- order ticket ---------- */
const order = { symbol: null, side: "buy", mode: "usd", quote: null };

async function openOrder(side, symbol = state.symbol) {
  if (symbol.startsWith("^")) {
    toast("Indices can't be bought directly. Try an index ETF like SPY (S&P 500) or QQQ (Nasdaq).", true);
    return;
  }
  if (!broker.acct) return openSetup(() => openOrder(side, symbol));
  Object.assign(order, { symbol, side, quote: null });
  $("order-title").textContent = label(symbol);
  $("order-sub").textContent = "Loading price…";
  $("order-price").textContent = "—";
  $("order-qty").value = "";
  $("order-err").textContent = "";
  $("order-david").innerHTML = "";
  setSide(side); setMode(order.mode);
  $("order-dlg").showModal();
  $("order-qty").focus();
  try {
    const q = (await fetchQuotes([symbol]))[symbol];
    if (!q) throw new Error("No price available");
    order.quote = q;
    $("order-sub").textContent = q.name + (q.currency !== "USD" ? ` · priced in ${q.currency}, settled in USD` : "");
    $("order-price").textContent = (q.currency === "USD" ? "$" : "") + fmt(q.price) + (q.currency !== "USD" ? " " + q.currency : "");
    updateOrderSummary();
  } catch (e) { $("order-sub").textContent = ""; $("order-err").textContent = "Couldn't load a live price: " + e.message; }
  api(`/api/analysis?symbol=${encodeURIComponent(symbol)}`).then((a) => {
    if (order.symbol !== symbol) return;
    $("order-david").innerHTML = `<b>David says:</b> <span class="badge sm ${verdictClass(a.verdict)}">${a.verdict}</span> ${esc(SUMMARY_SHORT[a.verdict])}`;
  }).catch(() => {});
}
const SUMMARY_SHORT = { "STRONG BUY": "Signals are clearly positive.", BUY: "More signals point up than down.", HOLD: "Signals are mixed; no clear edge.", SELL: "More signals point down than up.", "STRONG SELL": "Signals are clearly negative." };

function setSide(side) {
  order.side = side;
  document.querySelectorAll(".side-toggle button").forEach((b) => b.classList.toggle("active", b.dataset.side === side));
  $("order-submit").textContent = side === "buy" ? "Buy (demo)" : "Sell (demo)";
  $("order-submit").style.background = side === "buy" ? "var(--up)" : "var(--down)";
  updateOrderSummary();
}
function setMode(mode) {
  order.mode = mode;
  document.querySelectorAll(".mode-toggle button").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  $("order-qty-label").textContent = mode === "usd" ? "Amount in USD" : "Number of shares (fractions allowed)";
  $("order-qty").value = "";
  updateOrderSummary();
}
document.querySelector(".side-toggle").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setSide(b.dataset.side); });
document.querySelector(".mode-toggle").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setMode(b.dataset.mode); });
$("order-qty").addEventListener("input", updateOrderSummary);
$("order-quick").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b || !order.quote) return;
  const f = Number(b.dataset.frac), owned = broker.acct.positions[order.symbol]?.shares || 0;
  const maxShares = order.side === "buy" ? broker.acct.cash / order.quote.priceUsd : owned;
  const v = order.mode === "usd" ? Math.floor(maxShares * f * order.quote.priceUsd * 100) / 100 : Math.floor(maxShares * f * 10000) / 10000;
  $("order-qty").value = v; updateOrderSummary();
});

function orderShares() {
  const v = Number($("order-qty").value);
  if (!order.quote || !(v > 0)) return 0;
  return order.mode === "usd" ? v / order.quote.priceUsd : v;
}

function updateOrderSummary() {
  if (!broker.acct) return;
  const owned = broker.acct.positions[order.symbol]?.shares || 0;
  const sh = orderShares(), total = order.quote ? sh * order.quote.priceUsd : 0;
  let err = "";
  if (order.side === "buy" && total > broker.acct.cash + 0.005) err = "Not enough demo cash for this order.";
  if (order.side === "sell" && sh > owned + 1e-9) err = owned ? `You only own ${shr(owned)} shares.` : "You don't own this stock yet.";
  $("order-err").textContent = order.quote ? err : $("order-err").textContent;
  $("order-submit").disabled = !order.quote || !sh || !!err;
  $("order-sum").innerHTML = `
    <dt>Shares</dt><dd>${sh ? shr(sh) : "—"}</dd>
    <dt>Estimated ${order.side === "buy" ? "cost" : "proceeds"}</dt><dd>${sh ? usd(total) : "—"}</dd>
    <dt>Demo cash available</dt><dd>${usd(broker.acct.cash)}</dd>
    <dt>You own</dt><dd>${shr(owned)} shares</dd>`;
}

/* executes a demo order at the latest price; returns the filled shares and USD total */
async function trade(side, symbol, shares, fallbackQuote) {
  const q = (await fetchQuotes([symbol]))[symbol] || fallbackQuote;
  if (!q) throw new Error("No price available right now. Try again.");
  const sh = Math.round(shares * 1e6) / 1e6, total = sh * q.priceUsd;
  const a = broker.acct, pos = a.positions[symbol];
  if (!(sh > 0)) throw new Error("Enter an amount.");
  if (side === "buy") {
    if (total > a.cash + 0.005) throw new Error("Not enough demo cash.");
    a.cash = Math.max(0, a.cash - total);
    const p = pos || { shares: 0, cost: 0, costNative: 0, opened: Date.now(), name: q.name };
    if (p.costNative != null) p.costNative += sh * q.price;
    p.shares += sh; p.cost += total; p.name = q.name;
    a.positions[symbol] = p;
    a.history.unshift({ t: Date.now(), side: "buy", symbol, shares: sh, price: q.price, currency: q.currency, total });
  } else {
    if (!pos || sh > pos.shares + 1e-9) throw new Error("You don't own that many shares.");
    const frac = Math.min(1, sh / pos.shares), costPart = pos.cost * frac;
    a.cash += total;
    if (pos.costNative != null) pos.costNative -= pos.costNative * frac;
    pos.shares -= sh; pos.cost -= costPart;
    if (pos.shares < 1e-6) delete a.positions[symbol];
    a.history.unshift({ t: Date.now(), side: "sell", symbol, shares: sh, price: q.price, currency: q.currency, total, pl: total - costPart });
  }
  broker.save();
  refreshAccountButton();
  updatePositionLines();
  if ($("pf-dlg").open) renderPortfolio();
  return { sh, total };
}

$("order-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("order-submit"); btn.disabled = true;
  try {
    const { sh, total } = await trade(order.side, order.symbol, orderShares(), order.quote);
    $("order-dlg").close();
    toast(`${order.side === "buy" ? "Bought" : "Sold"} ${shr(sh)} ${label(order.symbol)} for ${usd(total)} (demo)`);
  } catch (err) { $("order-err").textContent = err.message; btn.disabled = false; }
});

/* ---------- position lines on the chart: live P/L at the buy price (with close X) + yellow buy-date line ---------- */
const posLayer = document.createElement("div");
posLayer.className = "pos-layer";
posLayer.innerHTML = `<div class="buy-vline" hidden><span></span></div>
  <div class="pl-line" hidden><div class="pl-tag"><span class="pl-val"></span><span class="pl-qty"></span><button type="button" class="pl-x" title="Close position (sell everything, demo)" aria-label="Close position">×</button></div></div>`;
$("chart").appendChild(posLayer);
const plLine = posLayer.querySelector(".pl-line"), buyLine = posLayer.querySelector(".buy-vline");
let posView = null;

/* when the current position was opened; older positions without `opened` are rebuilt from the trade history */
function openedAt(sym, p) {
  if (p.opened) return p.opened;
  let net = p.shares, t = null;
  for (const h of broker.acct.history) {
    if (h.symbol !== sym) continue;
    if (h.side === "buy") { net -= h.shares; t = h.t; } else net += h.shares;
    if (net <= 1e-6) break;
  }
  return t;
}

function updatePositionLines() {
  const sym = state.symbol, p = broker.acct?.positions[sym], q = broker.quotes[sym];
  if (!p || !q || !state.candles.length) { posView = null; plLine.hidden = buyLine.hidden = true; return; }
  const entry = p.costNative ? p.costNative / p.shares : (p.cost / p.shares) * (q.price / q.priceUsd);
  const pl = p.shares * q.priceUsd - p.cost, plPct = (p.shares * q.priceUsd / p.cost - 1) * 100;
  const opened = openedAt(sym, p), ts = opened / 1000, c = state.candles;
  let barTime = null;
  if (opened) for (let i = c.length - 1; i >= 0; i--) if (c[i].time <= ts) { barTime = c[i].time; break; }
  posView = { entry, barTime };
  plLine.classList.toggle("loss", pl < 0);
  posLayer.querySelector(".pl-val").textContent = `${pl >= 0 ? "+" : ""}${usd(pl)}  ${fmtPct(plPct)}`;
  posLayer.querySelector(".pl-qty").textContent = `${shr(p.shares)} @ ${fmt(entry)}`;
  buyLine.querySelector("span").textContent = opened ? `Bought ${new Date(opened).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : "";
  placePositionLines();
}

function placePositionLines() {
  if (!posView) return;
  const el = $("chart"), right = chart.priceScale("right").width(), h = el.clientHeight - chart.timeScale().height(), w = el.clientWidth - right;
  const y = candleS.priceToCoordinate(posView.entry);
  plLine.hidden = y == null;
  if (!plLine.hidden) {
    // buy price outside the visible range: pin the P/L tag to the top/bottom edge
    const off = y < 14 ? "above" : y > h - 14 ? "below" : "";
    plLine.dataset.off = off;
    plLine.style.top = `${off === "above" ? 14 : off === "below" ? h - 14 : y}px`;
    plLine.style.right = `${right}px`;
  }
  const x = posView.barTime == null ? null : chart.timeScale().timeToCoordinate(posView.barTime);
  buyLine.hidden = x == null || x < 0 || x > w;
  if (!buyLine.hidden) { buyLine.style.left = `${x}px`; buyLine.style.height = `${h}px`; buyLine.classList.toggle("flip", x > w - 130); }
}
(function follow() { placePositionLines(); requestAnimationFrame(follow); })();

document.addEventListener("chartloaded", async () => {
  const sym = state.symbol;
  if (broker.acct?.positions[sym] && !broker.quotes[sym]) { try { await fetchQuotes([sym]); } catch {} }
  updatePositionLines();
});

posLayer.querySelector(".pl-x").addEventListener("click", async () => {
  const sym = state.symbol, p = broker.acct?.positions[sym];
  if (!p || !confirm(`Close your ${label(sym)} position?\n\nThis sells all ${shr(p.shares)} shares at the current price (demo money).`)) return;
  try {
    const { sh, total } = await trade("sell", sym, p.shares);
    toast(`Closed: sold ${shr(sh)} ${label(sym)} for ${usd(total)} (demo)`);
  } catch (err) { toast(err.message, true); }
});

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-trade]"); if (!b) return;
  openOrder(b.dataset.trade, b.dataset.sym || state.symbol);
});

/* ---------- portfolio ---------- */
const verdictCache = {};
async function renderPortfolio() {
  const a = broker.acct;
  const syms = Object.keys(a.positions);
  try { await fetchQuotes([...syms, ...davidFund().syms]); } catch {}
  const t = portfolioTotals();
  $("pf-summary").innerHTML = [
    ["Total value", usd(t.total)],
    ["Total profit / loss", `<span class="${cls(t.pl)}">${usd(t.pl)} (${fmtPct(t.plPct)})</span>`],
    ["Demo cash", usd(a.cash)],
    ["Invested (market value)", usd(t.value)],
    ["Starting money", usd(a.startCash)],
    ...(t.fund > 0 ? [["Managed by David", usd(t.fund)]] : []),
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");

  $("pf-positions").innerHTML = `<tr><th>Stock</th><th class="num">Shares</th><th class="num">Avg cost</th><th class="num">Price</th><th class="num">Value</th><th class="num">Profit / loss</th><th>David</th><th></th></tr>` +
    (syms.length ? syms.map((s) => {
      const p = a.positions[s], q = broker.quotes[s];
      const val = q ? p.shares * q.priceUsd : p.cost, pl = val - p.cost, plPct = (val / p.cost - 1) * 100;
      const v = verdictCache[s];
      return `<tr><td><button class="sym" data-s="${esc(s)}" data-close-pf>${esc(label(s))}</button><div class="muted">${esc(p.name || "")}</div></td>
        <td class="num">${shr(p.shares)}</td><td class="num">${usd(p.cost / p.shares)}</td><td class="num">${q ? usd(q.priceUsd) : "—"}</td><td class="num">${usd(val)}</td>
        <td class="num ${cls(pl)}">${usd(pl)}<br><small>${fmtPct(plPct)}</small></td>
        <td data-verdict="${esc(s)}">${v ? `<span class="badge sm ${verdictClass(v)}">${v}</span>` : '<span class="muted">…</span>'}</td>
        <td><div class="row-btns"><button class="btn-buy" data-trade="buy" data-sym="${esc(s)}">Buy</button><button class="btn-sell" data-trade="sell" data-sym="${esc(s)}">Sell</button></div></td></tr>`;
    }).join("") : `<tr><td colspan="8" class="empty">No positions yet. Open any stock and press <b>Buy</b> to invest your demo money.</td></tr>`);

  $("pf-history").innerHTML = `<tr><th>Date</th><th>Side</th><th>Stock</th><th class="num">Shares</th><th class="num">Price</th><th class="num">Total</th><th class="num">Realised P/L</th></tr>` +
    (a.history.length ? a.history.slice(0, 100).map((h) => `<tr><td>${new Date(h.t).toLocaleString()}</td><td class="${h.side === "buy" ? "up" : "down"}">${h.side.toUpperCase()}</td><td>${esc(label(h.symbol))}</td>
      <td class="num">${shr(h.shares)}</td><td class="num">${fmt(h.price)} ${esc(h.currency)}</td><td class="num">${usd(h.total)}</td><td class="num ${h.pl != null ? cls(h.pl) : ""}">${h.pl != null ? usd(h.pl) : ""}</td></tr>`).join("")
      : `<tr><td colspan="7" class="empty">No trades yet.</td></tr>`);

  syms.filter((s) => !verdictCache[s]).forEach((s) => api(`/api/analysis?symbol=${encodeURIComponent(s)}`).then((r) => {
    verdictCache[s] = r.verdict;
    const cell = document.querySelector(`[data-verdict="${CSS.escape(s)}"]`);
    if (cell) cell.innerHTML = `<span class="badge sm ${verdictClass(r.verdict)}">${r.verdict}</span>`;
  }).catch(() => {}));
  refreshAccountButton();
}

$("acct-btn").addEventListener("click", () => {
  if (!broker.acct) return openSetup(() => { $("pf-dlg").showModal(); renderPortfolio(); });
  $("pf-dlg").showModal(); renderPortfolio();
});
$("pf-dlg").addEventListener("click", (e) => { if (e.target.closest("[data-close-pf]")) $("pf-dlg").close(); });
$("pf-reset").addEventListener("click", () => {
  if (!confirm("Reset your demo account? All demo positions and history will be deleted.")) return;
  broker.acct = null; broker.save();
  $("pf-dlg").close(); refreshAccountButton();
  openSetup(() => { $("pf-dlg").showModal(); renderPortfolio(); });
});

refreshAccountButton();
setInterval(() => { refreshAccountButton(); if ($("pf-dlg").open) renderPortfolio(); }, 30000);

/* accounts: load the logged-in user's saved demo money, show login / user menu */
async function logout() {
  await fetch("/api/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  localStorage.removeItem(KEY); localStorage.removeItem(AP_KEY);
  location.reload();
}

function renderUserArea(user) {
  const area = document.createElement("div");
  area.className = "user-area";
  if (!user) {
    area.innerHTML = '<a class="btn-ghost login-link" href="/login.html">Log in / Sign up</a>';
  } else {
    area.innerHTML = `<a href="/david" class="ap-link"><span class="ap-dot" aria-hidden="true"></span>David Autopilot</a>
      <div class="user-menu"><button class="user-btn" id="user-btn" aria-haspopup="true" aria-expanded="false" title="${esc(user.email)}">${esc(user.email[0].toUpperCase())}</button>
      <div class="user-pop" id="user-pop" hidden><div class="muted">Logged in as</div><b>${esc(user.email)}</b><a class="btn-ghost" href="/david">David Autopilot</a><button class="btn-ghost" id="logout-btn">Log out</button></div></div>`;
  }
  $("acct-btn").before(area);
  if (user) {
    const pop = $("user-pop"), btn = $("user-btn");
    btn.addEventListener("click", (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; btn.setAttribute("aria-expanded", String(!pop.hidden)); });
    document.addEventListener("click", (e) => { if (!pop.contains(e.target)) { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); } });
    $("logout-btn").addEventListener("click", logout);
  }
}

(async () => {
  let me;
  try { me = await api("/api/me"); } catch { return; }
  if (me.user) {
    try {
      const st = await api("/api/state");
      account.user = me.user;
      if (st.broker) { broker.acct = st.broker; localStorage.setItem(KEY, JSON.stringify(st.broker)); }
      else if (broker.acct) pushState({ broker: broker.acct });
      const localAp = JSON.parse(localStorage.getItem(AP_KEY) || "null");
      if (st.autopilot) localStorage.setItem(AP_KEY, JSON.stringify(st.autopilot));
      else if (localAp) pushState({ autopilot: localAp });
      refreshAccountButton();
    } catch { toast("Couldn't load your account. Your demo money is shown from this browser only.", true); }
  }
  renderUserArea(me.user);
})();
