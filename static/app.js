const $ = (id) => document.getElementById(id);
const WATCH = ["^GSPC","^IXIC","^DJI","AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","BRK-B","JPM","V","LLY","AVGO","NFLX","COST","BTC-USD"];
const state = { symbol: "^GSPC", range: "1y", ticker: [], candles: [] };

const fmt = (n, d = 2) => n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null || isNaN(n) ? "—" : Math.abs(n) < 0.005 ? "0.00%" : (n > 0 ? "+" : "") + n.toFixed(2) + "%";
const cls = (n) => n == null ? "" : n >= 0 ? "up" : "down";
const fmtVol = (n) => !n ? "—" : n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : n;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const label = (s) => ({ "^GSPC": "SPX", "^IXIC": "NDX", "^DJI": "DJI" }[s] || s);

async function api(path) {
  const r = await fetch(path);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

function spark(canvas, data, up) {
  const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
  if (!data || data.length < 2) return;
  const min = Math.min(...data), max = Math.max(...data), rng = max - min || 1;
  const pts = data.map((v, i) => [i / (data.length - 1) * w, h - 2 - (v - min) / rng * (h - 4)]);
  const color = up ? "#26a69a" : "#ef5350";
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, color + "55"); g.addColorStop(1, color + "00");
  ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
}

/* ---------- ticker tape + watchlist ---------- */
async function loadTicker() {
  try { state.ticker = await api("/api/ticker"); } catch { return; }
  const spx = state.ticker.find((t) => t.symbol === "^GSPC");
  if (spx) {
    $("spx-price").textContent = fmt(spx.price);
    $("spx-chg").textContent = fmtPct(spx.changePercent);
    $("spx-chg").className = "chg " + cls(spx.changePercent);
    spark($("spx-spark"), spx.spark, spx.changePercent >= 0);
  }
  const items = state.ticker.filter((t) => t.symbol !== "^GSPC");
  const html = items.map((t) => `<button class="tick" data-s="${esc(t.symbol)}" title="${esc(t.name)}"><span class="s">${esc(label(t.symbol))}</span><span class="p">${fmt(t.price)}</span><span class="${cls(t.changePercent)}">${fmtPct(t.changePercent)}</span><canvas></canvas></button>`).join("");
  $("tape").innerHTML = html + html;
  $("tape").querySelectorAll(".tick").forEach((el, i) => {
    const t = items[i % items.length];
    spark(el.querySelector("canvas"), t.spark, t.changePercent >= 0);
    if (i >= items.length) el.setAttribute("aria-hidden", "true"), el.tabIndex = -1;
  });
  renderWatchlist();
}

function renderWatchlist() {
  const map = Object.fromEntries(state.ticker.map((t) => [t.symbol, t]));
  const list = [...WATCH, ...JSON.parse(localStorage.getItem("extraWatch") || "[]").filter((s) => !WATCH.includes(s))];
  $("watchlist").innerHTML = list.map((s) => {
    const t = map[s] || { name: "", price: null, changePercent: null };
    return `<li><button data-s="${esc(s)}" class="${s === state.symbol ? "active" : ""}"><span class="s">${esc(label(s))}</span><span class="p">${fmt(t.price)}</span><span class="n">${esc(t.name || s)}</span><span class="c ${cls(t.changePercent)}">${fmtPct(t.changePercent)}</span></button></li>`;
  }).join("");
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-s]");
  if (b) selectSymbol(b.dataset.s);
});
$("spx").addEventListener("click", () => selectSymbol("^GSPC"));

/* ---------- chart ---------- */
const chart = LightweightCharts.createChart($("chart"), {
  autoSize: true,
  layout: { background: { color: "#131722" }, textColor: "#d1d4dc", fontFamily: "inherit" },
  grid: { vertLines: { color: "#1e222d" }, horzLines: { color: "#1e222d" } },
  rightPriceScale: { borderColor: "#2a2e39" },
  timeScale: { borderColor: "#2a2e39" },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
});
const candleS = chart.addCandlestickSeries({ upColor: "#26a69a", downColor: "#ef5350", borderVisible: false, wickUpColor: "#26a69a", wickDownColor: "#ef5350" });
const lineS = chart.addAreaSeries({ lineColor: "#2962ff", topColor: "#2962ff44", bottomColor: "#2962ff00", lineWidth: 2, visible: false });
const volS = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol" });
chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
const sma50S = chart.addLineSeries({ color: "#ff9800", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
const sma200S = chart.addLineSeries({ color: "#e040fb", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });

function smaLine(c, n) {
  const out = []; let sum = 0;
  c.forEach((x, i) => { sum += x.close; if (i >= n) sum -= c[i - n].close; if (i >= n - 1) out.push({ time: x.time, value: sum / n }); });
  return out;
}

let chartReq = 0;
async function loadChart() {
  const id = ++chartReq;
  // fetch 2y extra so the 200-day average is available from the first visible bar
  const longRange = { "1mo": "2y", "3mo": "2y", "6mo": "2y", ytd: "2y", "1y": "2y", "2y": "5y", "5y": "10y", max: "max" }[state.range];
  let d, full;
  try {
    [d, full] = await Promise.all([api(`/api/chart?symbol=${encodeURIComponent(state.symbol)}&range=${state.range}`), api(`/api/chart?symbol=${encodeURIComponent(state.symbol)}&range=${longRange}`)]);
  } catch (e) { $("sym-name").textContent = "Could not load " + state.symbol; return; }
  if (id !== chartReq) return;
  const c = d.candles; state.candles = c;
  const first = c[0]?.time ?? 0;
  const sameInterval = d.interval === full.interval;
  candleS.setData(c);
  lineS.setData(c.map((x) => ({ time: x.time, value: x.close })));
  volS.setData(c.map((x) => ({ time: x.time, value: x.volume, color: x.close >= x.open ? "#26a69a55" : "#ef535055" })));
  const base = sameInterval ? full.candles : c;
  sma50S.setData(smaLine(base, 50).filter((p) => p.time >= first));
  sma200S.setData(smaLine(base, 200).filter((p) => p.time >= first));
  chart.timeScale().fitContent();

  const last = c[c.length - 1], startClose = c[0].close;
  const tick = state.ticker.find((t) => t.symbol === state.symbol);
  const price = d.price ?? last.close;
  const dayChg = tick?.changePercent ?? (c.length > 1 ? (last.close / c[c.length - 2].close - 1) * 100 : null);
  $("sym-name").textContent = d.name;
  $("sym-code").textContent = d.symbol;
  $("sym-exch").textContent = `${d.exchange || ""} · ${d.currency || ""}`;
  $("sym-price").textContent = fmt(price);
  $("sym-chg").innerHTML = `<span class="${cls(dayChg)}">${fmtPct(dayChg)} today</span>`;
  const rangeChg = (price / startClose - 1) * 100;
  const hi = Math.max(...c.map((x) => x.high)), lo = Math.min(...c.map((x) => x.low));
  const rangeLbl = document.querySelector(`#ranges [data-r="${state.range}"]`).textContent;
  $("stats").innerHTML = [
    [`${rangeLbl} change`, `<span class="${cls(rangeChg)}">${fmtPct(rangeChg)}</span>`],
    ["Day range", `${fmt(d.dayLow)} – ${fmt(d.dayHigh)}`],
    ["52W range", `${fmt(d.low52)} – ${fmt(d.high52)}`],
    [`${rangeLbl} high / low`, `${fmt(hi)} / ${fmt(lo)}`],
    ["Volume", fmtVol(d.volume)],
    ["History", `${new Date(first * 1000).toLocaleDateString("en-US", { month: "short", year: "numeric" })} →`],
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
  document.title = `${label(d.symbol)} ${fmt(price)} — David Trading`;
  document.dispatchEvent(new Event("chartloaded"));
}

$("ranges").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  state.range = b.dataset.r;
  $("ranges").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
  loadChart();
});
$("t-candle").addEventListener("change", (e) => { candleS.applyOptions({ visible: e.target.checked }); lineS.applyOptions({ visible: !e.target.checked }); });
$("t-sma50").addEventListener("change", (e) => sma50S.applyOptions({ visible: e.target.checked }));
$("t-sma200").addEventListener("change", (e) => sma200S.applyOptions({ visible: e.target.checked }));

/* ---------- David ---------- */
function verdictClass(v) { return v.includes("BUY") ? "b-buy" : v.includes("SELL") ? "b-sell" : "b-hold"; }

function renderVerdict(a) {
  const pos = Math.max(0, Math.min(100, (a.score + 8) / 16 * 100));
  const s = a.stats;
  $("verdict").innerHTML = `<div class="vcard">
    <div class="vtop"><div><div class="muted">David's verdict · ${esc(label(a.symbol))}</div><strong>${esc(a.name)}</strong></div><span class="badge ${verdictClass(a.verdict)}">${a.verdict}</span></div>
    <div class="meter"><i style="left:${pos}%"></i></div><div class="meter-l"><span>Strong sell</span><span>Hold</span><span>Strong buy</span></div>
    <div class="stats" style="margin-top:10px">
      <div class="stat"><div class="k">RSI (14)</div><div class="v">${fmt(s.rsi, 0)}</div></div>
      <div class="stat"><div class="k">6M return</div><div class="v ${cls(s.returns["6M"])}">${fmtPct(s.returns["6M"])}</div></div>
      <div class="stat"><div class="k">1Y return</div><div class="v ${cls(s.returns["1Y"])}">${fmtPct(s.returns["1Y"])}</div></div>
      <div class="stat"><div class="k">Volatility</div><div class="v">${fmt(s.volatility, 0)}%</div></div>
    </div>
    <ul class="reasons">${a.reasons.map((r) => `<li class="${r.tone}">${esc(r.text)}</li>`).join("")}</ul>
    <div class="muted" style="margin-top:6px">Confidence ${a.confidence}% · score ${a.score > 0 ? "+" : ""}${a.score}</div>
  </div>`;
}

let verdictReq = 0;
async function loadVerdict() {
  const id = ++verdictReq;
  $("verdict").innerHTML = `<div class="vcard muted">David is analysing ${esc(label(state.symbol))}…</div>`;
  try { const a = await api(`/api/analysis?symbol=${encodeURIComponent(state.symbol)}`); if (id === verdictReq) renderVerdict(a); }
  catch (e) { if (id === verdictReq) $("verdict").innerHTML = `<div class="vcard muted">No analysis available: ${esc(e.message)}</div>`; }
}

function addMsg(text, who, extra = "") {
  const el = document.createElement("div");
  el.className = "msg " + who; el.innerHTML = esc(text) + extra;
  $("chat").appendChild(el); $("chat").scrollTop = $("chat").scrollHeight;
  return el;
}

async function askDavid(q) {
  if (!q.trim()) return;
  addMsg(q, "user");
  const t = addMsg("", "bot"); t.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
  try {
    const r = await api(`/api/david?q=${encodeURIComponent(q)}`);
    let extra = "";
    if (r.analyses?.length) {
      const lines = r.analyses.map((a) => `\n\n${label(a.symbol)} · ${fmt(a.price)} ${a.currency || ""}\n` + a.reasons.map((x) => (x.tone === "bull" ? "▲ " : x.tone === "bear" ? "▼ " : "● ") + x.text).join("\n")).join("");
      extra = esc(lines) + `<div class="mini">${r.analyses.map((a) => `<button data-s="${esc(a.symbol)}">Open ${esc(label(a.symbol))} chart</button>`).join("")}</div>`;
      if (r.analyses.length === 1) selectSymbol(r.analyses[0].symbol);
    }
    t.innerHTML = esc(r.text) + extra;
  } catch (e) { t.textContent = "Sorry, I couldn't reach the market data right now. Please try again."; }
  $("chat").scrollTop = $("chat").scrollHeight;
}

$("chat-form").addEventListener("submit", (e) => { e.preventDefault(); const q = $("chat-input").value; $("chat-input").value = ""; askDavid(q); });
$("suggestions").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) askDavid(b.textContent); });

/* ---------- search ---------- */
let searchTimer;
$("search").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (!q) { $("search-results").hidden = true; return; }
  searchTimer = setTimeout(async () => {
    let res = [];
    try { res = await api(`/api/search?q=${encodeURIComponent(q)}`); } catch {}
    $("search-results").innerHTML = res.length ? res.map((r) => `<li><button data-add="${esc(r.symbol)}"><span><b>${esc(r.symbol)}</b> ${esc(r.name)}</span><small>${esc(r.type || "")} · ${esc(r.exchange || "")}</small></button></li>`).join("") : '<li class="muted" style="padding:8px">No results</li>';
    $("search-results").hidden = false;
  }, 250);
});
$("search-results").addEventListener("click", (e) => {
  const b = e.target.closest("[data-add]"); if (!b) return;
  const s = b.dataset.add, extra = JSON.parse(localStorage.getItem("extraWatch") || "[]");
  if (!WATCH.includes(s) && !extra.includes(s)) localStorage.setItem("extraWatch", JSON.stringify([...extra, s]));
  $("search-results").hidden = true; $("search").value = "";
  selectSymbol(s);
});
document.addEventListener("click", (e) => { if (!e.target.closest(".search")) $("search-results").hidden = true; });

/* ---------- init ---------- */
function selectSymbol(s) {
  state.symbol = s;
  renderWatchlist();
  loadChart();
  loadVerdict();
  history.replaceState(null, "", "#" + encodeURIComponent(s));
}

addMsg("Hi, I'm David. Ask me about any stock — e.g. \"Should I buy NVDA?\" — and I'll tell you whether it looks like a buy, hold or sell, with the stats behind it.", "bot");
const initial = decodeURIComponent(location.hash.slice(1)) || "^GSPC";
loadTicker().then(() => selectSymbol(initial));
setInterval(loadTicker, 60000);
