/* Demo broker: paper trading with play money, stored in localStorage. */
const KEY = "davidDemoBroker";
const usd = (n) => n == null || isNaN(n) ? "—" : (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shr = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 4 });
const broker = {
  acct: JSON.parse(localStorage.getItem(KEY) || "null"),
  quotes: {},
  save() { localStorage.setItem(KEY, JSON.stringify(this.acct)); },
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

function portfolioTotals() {
  const a = broker.acct;
  let value = 0, cost = 0;
  for (const [s, p] of Object.entries(a.positions)) {
    const q = broker.quotes[s];
    value += q ? p.shares * q.priceUsd : p.cost;
    cost += p.cost;
  }
  const total = a.cash + value;
  return { value, cost, total, pl: total - a.startCash, plPct: (total / a.startCash - 1) * 100 };
}

async function refreshAccountButton() {
  if (!broker.acct) { $("acct-value").textContent = "Start demo trading"; return; }
  try { await fetchQuotes(Object.keys(broker.acct.positions)); } catch {}
  const t = portfolioTotals();
  $("acct-value").innerHTML = `${usd(t.total)} <span class="${cls(t.pl)}">${fmtPct(t.plPct)}</span>`;
}

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

$("order-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("order-submit"); btn.disabled = true;
  try {
    const q = (await fetchQuotes([order.symbol]))[order.symbol] || order.quote;
    order.quote = q;
    const sh = Math.round(orderShares() * 1e6) / 1e6, total = sh * q.priceUsd;
    const a = broker.acct, pos = a.positions[order.symbol];
    if (order.side === "buy") {
      if (total > a.cash + 0.005) throw new Error("Not enough demo cash.");
      a.cash = Math.max(0, a.cash - total);
      const p = pos || { shares: 0, cost: 0, name: q.name };
      p.shares += sh; p.cost += total; p.name = q.name;
      a.positions[order.symbol] = p;
    } else {
      if (!pos || sh > pos.shares + 1e-9) throw new Error("You don't own that many shares.");
      const costPart = pos.cost * (sh / pos.shares);
      a.cash += total;
      pos.shares -= sh; pos.cost -= costPart;
      if (pos.shares < 1e-6) delete a.positions[order.symbol];
      a.history.unshift({ t: Date.now(), side: "sell", symbol: order.symbol, shares: sh, price: q.price, currency: q.currency, total, pl: total - costPart });
    }
    if (order.side === "buy") a.history.unshift({ t: Date.now(), side: "buy", symbol: order.symbol, shares: sh, price: q.price, currency: q.currency, total });
    broker.save();
    $("order-dlg").close();
    toast(`${order.side === "buy" ? "Bought" : "Sold"} ${shr(sh)} ${label(order.symbol)} for ${usd(total)} (demo)`);
    refreshAccountButton();
    if ($("pf-dlg").open) renderPortfolio();
  } catch (err) { $("order-err").textContent = err.message; btn.disabled = false; }
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
  try { await fetchQuotes(syms); } catch {}
  const t = portfolioTotals();
  $("pf-summary").innerHTML = [
    ["Total value", usd(t.total)],
    ["Total profit / loss", `<span class="${cls(t.pl)}">${usd(t.pl)} (${fmtPct(t.plPct)})</span>`],
    ["Demo cash", usd(a.cash)],
    ["Invested (market value)", usd(t.value)],
    ["Starting money", usd(a.startCash)],
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
  broker.acct = null; localStorage.removeItem(KEY);
  $("pf-dlg").close(); refreshAccountButton();
  openSetup(() => { $("pf-dlg").showModal(); renderPortfolio(); });
});

refreshAccountButton();
setInterval(() => { refreshAccountButton(); if ($("pf-dlg").open) renderPortfolio(); }, 30000);
