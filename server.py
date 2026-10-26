"""David Trading - stock consulting platform. Python stdlib server + Yahoo Finance proxy."""
import hashlib
import hmac
import json
import math
import secrets
import threading
import os
import re
import time
import urllib.parse
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
PRIVATE = os.path.join(ROOT, "private")
DATABASE_URL = os.environ.get("DATABASE_URL", "")
SESSION_SECRET = (os.environ.get("SESSION_SECRET") or secrets.token_hex(32)).encode()
SESSION_DAYS = 30
COOKIE = "dt_session"
UA = {"User-Agent": "Mozilla/5.0"}  # fuller browser UAs get HTTP 429 from Yahoo
YF = "https://query1.finance.yahoo.com"

TICKER_SYMBOLS = ["^GSPC", "^IXIC", "^DJI", "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META",
                  "TSLA", "BRK-B", "JPM", "V", "LLY", "AVGO", "NFLX", "COST", "BTC-USD"]
NAMES = {"^GSPC": "S&P 500", "^IXIC": "Nasdaq", "^DJI": "Dow Jones", "BTC-USD": "Bitcoin"}
VALID_RANGES = {"1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"}

_cache = {}


def fetch_json(url, ttl):
    hit = _cache.get(url)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    data, err = None, None
    for host in (url, url.replace("query1.", "query2.", 1)):
        try:
            req = urllib.request.Request(host, headers=UA)
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise LookupError("Symbol not found") from e
            err = e
        except Exception as e:
            err = e
    if data is None:
        if hit:
            return hit[1]
        raise err
    _cache[url] = (time.time(), data)
    return data


def get_ticker():
    syms = ",".join(TICKER_SYMBOLS)
    url = f"{YF}/v7/finance/spark?symbols={urllib.parse.quote(syms)}&range=1d&interval=5m"
    data = fetch_json(url, 60)
    by_sym = {}
    for item in data.get("spark", {}).get("result", []) or []:
        resp = (item.get("response") or [{}])[0]
        meta = resp.get("meta", {})
        closes = ((resp.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
        closes = [c for c in closes if c is not None]
        price = meta.get("regularMarketPrice")
        prev = meta.get("chartPreviousClose") or meta.get("previousClose")
        chg = meta.get("regularMarketChangePercent")
        if chg is None and price and prev:
            chg = (price - prev) / prev * 100
        sym = item.get("symbol")
        by_sym[sym] = {
            "symbol": sym,
            "name": NAMES.get(sym, meta.get("shortName") or sym),
            "price": price,
            "changePercent": chg,
            "spark": closes[-78:],
        }
    return [by_sym[s] for s in TICKER_SYMBOLS if s in by_sym]


def _spark(symbols):
    url = f"{YF}/v7/finance/spark?symbols={urllib.parse.quote(','.join(symbols))}&range=1d&interval=5m"
    data = fetch_json(url, 30)
    out = {}
    for item in data.get("spark", {}).get("result", []) or []:
        meta = ((item.get("response") or [{}])[0]).get("meta", {})
        if meta.get("regularMarketPrice") is not None:
            out[item.get("symbol")] = meta
    return out


def get_quotes(symbols, limit=20):
    """Latest prices plus a USD conversion rate so the demo broker can settle everything in USD."""
    symbols = list(dict.fromkeys(s.strip().upper() for s in symbols if s.strip()))[:limit]
    if not symbols:
        return {}
    metas = {}
    for i in range(0, len(symbols), 20):
        metas.update(_spark(symbols[i:i + 20]))
    ccys = {(m.get("currency") or "USD") for m in metas.values()}
    base = {c: ("GBP" if c == "GBp" else "ZAR" if c == "ZAc" else "ILS" if c == "ILA" else c) for c in ccys}
    need = sorted({b for b in base.values() if b != "USD"})
    fx = {"USD": 1.0}
    if need:
        for k, m in _spark([f"{c}USD=X" for c in need]).items():
            fx[k[:3]] = m["regularMarketPrice"]
    out = {}
    for sym, m in metas.items():
        ccy = m.get("currency") or "USD"
        rate = fx.get(base[ccy])
        if rate is None:
            continue
        if ccy in ("GBp", "ZAc", "ILA"):
            rate /= 100
        out[sym] = {"symbol": sym, "name": NAMES.get(sym, m.get("longName") or (m.get("shortName") or sym).strip()),
                    "price": m["regularMarketPrice"], "currency": ccy, "usdRate": rate,
                    "priceUsd": m["regularMarketPrice"] * rate, "changePercent": m.get("regularMarketChangePercent")}
    return out


def get_chart(symbol, rng="1y"):
    interval = "1wk" if rng in ("10y", "max") else "1d"
    url = f"{YF}/v8/finance/chart/{urllib.parse.quote(symbol)}?range={rng}&interval={interval}&includePrePost=false"
    data = fetch_json(url, 300)
    res = (data.get("chart", {}).get("result") or [None])[0]
    if not res or not res.get("timestamp"):
        raise LookupError(f"No data for {symbol}")
    q = res["indicators"]["quote"][0]
    candles = []
    for i, t in enumerate(res["timestamp"]):
        o, h, l, c, v = (q["open"][i], q["high"][i], q["low"][i], q["close"][i], q["volume"][i])
        if None in (o, h, l, c):
            continue
        candles.append({"time": t, "open": o, "high": h, "low": l, "close": c, "volume": v or 0})
    meta = res["meta"]
    return {
        "symbol": meta.get("symbol", symbol),
        "name": NAMES.get(symbol, meta.get("longName") or meta.get("shortName") or symbol),
        "currency": meta.get("currency"),
        "exchange": meta.get("fullExchangeName"),
        "price": meta.get("regularMarketPrice"),
        "dayHigh": meta.get("regularMarketDayHigh"),
        "dayLow": meta.get("regularMarketDayLow"),
        "volume": meta.get("regularMarketVolume"),
        "high52": meta.get("fiftyTwoWeekHigh"),
        "low52": meta.get("fiftyTwoWeekLow"),
        "interval": interval,
        "candles": candles,
    }


def search(q):
    url = f"{YF}/v1/finance/search?q={urllib.parse.quote(q)}&quotesCount=8&newsCount=0"
    data = fetch_json(url, 3600)
    out = []
    for item in data.get("quotes", []):
        if item.get("quoteType") in ("EQUITY", "ETF", "INDEX", "CRYPTOCURRENCY", "MUTUALFUND") and item.get("symbol"):
            out.append({"symbol": item["symbol"], "name": item.get("longname") or item.get("shortname") or item["symbol"],
                        "exchange": item.get("exchDisp"), "type": item.get("typeDisp")})
    return out



# ---------------------------------------------------------------- news & social buzz (context only, not scored)
_text_cache = {}
POS_WORDS = {"surge", "surges", "soar", "soars", "jump", "jumps", "rally", "rallies", "beat", "beats", "record", "upgrade",
             "upgraded", "gain", "gains", "rise", "rises", "climb", "climbs", "strong", "boost", "boosts", "outperform", "bullish",
             "growth", "profit", "wins", "approval", "approved", "partnership", "buyback", "raises", "tops", "higher"}
NEG_WORDS = {"plunge", "plunges", "drop", "drops", "fall", "falls", "slump", "slumps", "tumble", "tumbles", "sink", "sinks",
             "miss", "misses", "downgrade", "downgraded", "cut", "cuts", "lawsuit", "probe", "investigation", "recall", "loss",
             "losses", "weak", "warning", "warns", "layoffs", "tariff", "tariffs", "fine", "fined", "bearish", "crash", "lower",
             "fears", "selloff", "sell-off", "bankruptcy", "fraud", "halt", "strike", "war", "sanctions", "decline", "declines"}


def fetch_text(url, ttl):
    hit = _text_cache.get(url)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=12) as r:
            text = r.read().decode("utf-8", "replace")
    except Exception:
        if hit:
            return hit[1]
        raise
    _text_cache[url] = (time.time(), text)
    return text


def headline_tone(title):
    words = set(re.findall(r"[a-z][a-z\-]+", title.lower()))
    return len(words & POS_WORDS) - len(words & NEG_WORDS)


def google_news(query, limit=6, path=None):
    import html
    from email.utils import parsedate_to_datetime
    url = path or f"https://news.google.com/rss/search?q={urllib.parse.quote(query)}&hl=en-US&gl=US&ceid=US:en"
    xml = fetch_text(url, 600)
    out, seen = [], set()
    for item in re.findall(r"<item>(.*?)</item>", xml, re.S):
        title = html.unescape(re.sub(r"<.*?>", "", (re.search(r"<title>(.*?)</title>", item, re.S) or [None, ""])[1]))
        link = (re.search(r"<link>(.*?)</link>", item) or [None, ""])[1]
        src = html.unescape((re.search(r"<source[^>]*>(.*?)</source>", item) or [None, ""])[1])
        date = (re.search(r"<pubDate>(.*?)</pubDate>", item) or [None, ""])[1]
        if src and title.endswith(" - " + src):
            title = title[: -len(src) - 3]
        if not title or not link.startswith("https://") or title.lower() in seen:
            continue
        seen.add(title.lower())
        try:
            ts = int(parsedate_to_datetime(date).timestamp())
        except Exception:
            ts = 0
        out.append({"title": title, "link": link, "source": src, "time": ts, "tone": headline_tone(title)})
    out.sort(key=lambda x: -x["time"])
    return out[:limit]


def stocktwits(symbol):
    sym = {"^GSPC": "SPY", "^IXIC": "QQQ", "^DJI": "DIA"}.get(symbol, symbol)
    if sym.endswith("-USD"):
        sym = sym[:-4] + ".X"
    if sym.startswith("^") or "." in sym and not sym.endswith(".X"):
        return None
    data = json.loads(fetch_text(f"https://api.stocktwits.com/api/2/streams/symbol/{urllib.parse.quote(sym)}.json", 300))
    msgs = data.get("messages") or []
    bull = sum(1 for m in msgs if ((m.get("entities") or {}).get("sentiment") or {}).get("basic") == "Bullish")
    bear = sum(1 for m in msgs if ((m.get("entities") or {}).get("sentiment") or {}).get("basic") == "Bearish")
    posts = [{"text": m["body"][:220], "sentiment": ((m.get("entities") or {}).get("sentiment") or {}).get("basic"),
              "time": m.get("created_at")} for m in msgs[:4] if m.get("body")]
    return {"symbol": sym, "count": len(msgs), "bullish": bull, "bearish": bear, "posts": posts,
            "watchers": (data.get("symbol") or {}).get("watchlist_count"),
            "url": f"https://stocktwits.com/symbol/{sym}"}


SOCIAL_POS = POS_WORDS | {"calls", "long", "buy", "buying", "bought", "moon", "breakout", "undervalued", "loading", "adding", "ath"}
SOCIAL_NEG = NEG_WORDS | {"puts", "short", "shorting", "sell", "selling", "sold", "overvalued", "bubble", "dump", "dumping", "rug"}


def bluesky(symbol, name):
    if symbol.startswith("^"):
        q = name
    elif symbol.endswith("-USD"):
        q = "$" + symbol[:-4]
    elif "." in symbol or "=" in symbol:
        q = name
    else:
        q = "$" + symbol
    url = f"https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q={urllib.parse.quote(q)}&limit=30&sort=latest&lang=en"
    posts = json.loads(fetch_text(url, 300)).get("posts") or []
    out, pos, neg = [], 0, 0
    for p in posts:
        text = ((p.get("record") or {}).get("text") or "").strip()
        if not text:
            continue
        words = set(re.findall(r"[a-z][a-z\-]+", text.lower()))
        t = len(words & SOCIAL_POS) - len(words & SOCIAL_NEG)
        pos, neg = pos + (t > 0), neg + (t < 0)
        handle = (p.get("author") or {}).get("handle", "")
        out.append({"text": text[:240], "author": handle, "tone": t, "likes": p.get("likeCount", 0),
                    "time": (p.get("record") or {}).get("createdAt"),
                    "link": f"https://bsky.app/profile/{handle}/post/{p.get('uri', '').rsplit('/', 1)[-1]}"})
    return {"query": q, "count": len(out), "positive": pos, "negative": neg, "posts": out[:4],
            "url": f"https://bsky.app/search?q={urllib.parse.quote(q)}"}


def summarize_buzz(news, social, sky=None):
    tone = sum(1 if n["tone"] > 0 else -1 if n["tone"] < 0 else 0 for n in news)
    parts = []
    if news:
        parts.append("News is mostly positive" if tone >= 2 else "News is mostly negative" if tone <= -2 else "News is mixed")
    if social and social["bullish"] + social["bearish"] >= 3:
        b = social["bullish"] / (social["bullish"] + social["bearish"]) * 100
        parts.append(f"{b:.0f}% of tagged StockTwits posts are bullish")
    if sky and sky["positive"] + sky["negative"] >= 3:
        parts.append("Bluesky chatter leans positive" if sky["positive"] > sky["negative"] * 1.5 else
                     "Bluesky chatter leans negative" if sky["negative"] > sky["positive"] * 1.5 else "Bluesky chatter is mixed")
    return {"tone": tone, "text": "; ".join(parts) + "." if parts else "Not much buzz right now."}


def get_buzz(symbol):
    try:
        name = get_chart(symbol, "1mo")["name"]
    except Exception:
        name = symbol
    query = f'"{name}" when:7d' if name and name != symbol else f"{symbol} stock when:7d"
    with ThreadPoolExecutor(max_workers=3) as ex:
        fn = ex.submit(google_news, query)
        fs = ex.submit(stocktwits, symbol)
        fb = ex.submit(bluesky, symbol, name)
        try:
            sky = fb.result()
        except Exception:
            sky = None
        try:
            news = fn.result()
        except Exception:
            news = []
        social_error = None
        try:
            social = fs.result()
        except Exception as e:
            social, social_error = None, str(e)[:120]
    return {"symbol": symbol, "name": name, "news": news, "social": social, "bluesky": sky,
            "summary": summarize_buzz(news, social, sky)}


def get_world():
    news = google_news("", limit=8, path="https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en")
    return {"news": news, "summary": summarize_buzz(news, None)}


# ---------------------------------------------------------------- David's brain
def sma(vals, n):
    return sum(vals[-n:]) / n if len(vals) >= n else None


def ema_series(vals, n):
    k = 2 / (n + 1)
    out, e = [], None
    for v in vals:
        e = v if e is None else v * k + e * (1 - k)
        out.append(e)
    return out


def rsi(vals, n=14):
    if len(vals) <= n:
        return None
    gains = losses = 0.0
    for i in range(1, n + 1):
        d = vals[i] - vals[i - 1]
        gains += max(d, 0)
        losses += max(-d, 0)
    ag, al = gains / n, losses / n
    for i in range(n + 1, len(vals)):
        d = vals[i] - vals[i - 1]
        ag = (ag * (n - 1) + max(d, 0)) / n
        al = (al * (n - 1) + max(-d, 0)) / n
    return 100.0 if al == 0 else 100 - 100 / (1 + ag / al)


def pct(a, b):
    return (a / b - 1) * 100 if a and b else None


def analyze(symbol):
    data = get_chart(symbol, "2y")
    c = [x["close"] for x in data["candles"]]
    if len(c) < 60:
        raise LookupError(f"Not enough history for {symbol}")
    price = data["price"] or c[-1]
    s20, s50, s200 = sma(c, 20), sma(c, 50), sma(c, 200)
    r = rsi(c)
    e12, e26 = ema_series(c, 12), ema_series(c, 26)
    macd_line = [a - b for a, b in zip(e12, e26)]
    signal = ema_series(macd_line, 9)
    macd, macd_sig = macd_line[-1], signal[-1]
    ret = {k: pct(price, c[-n - 1]) if len(c) > n else None
           for k, n in (("1M", 21), ("3M", 63), ("6M", 126), ("1Y", 252))}
    daily = [math.log(c[i] / c[i - 1]) for i in range(max(1, len(c) - 252), len(c))]
    mean = sum(daily) / len(daily)
    vol = math.sqrt(sum((d - mean) ** 2 for d in daily) / (len(daily) - 1)) * math.sqrt(252) * 100
    window = c[-252:]
    peak, mdd = window[0], 0.0
    for v in window:
        peak = max(peak, v)
        mdd = min(mdd, (v / peak - 1) * 100)
    hi52, lo52 = max(window), min(window)
    pos52 = (price - lo52) / (hi52 - lo52) * 100 if hi52 > lo52 else 50

    score, reasons = 0, []

    def add(points, good, text):
        nonlocal score
        score += points
        reasons.append({"tone": "bull" if good else "bear" if good is False else "neutral", "text": text})

    # Score = 12-1 momentum (return from 12 months ago to 1 month ago): the best of 8 methods in backtest/
    if len(c) > 252:
        mom, span = pct(c[-22], c[-253]), "12 months"
    elif len(c) > 147:
        mom, span = pct(c[-22], c[-127]), "6 months"
    else:
        mom = None
    if mom is None:
        add(0, None, "Less than 6 months of history, which isn't enough for my momentum signal.")
    else:
        pts = int(mom > 0) + int(mom > 10) + int(mom > 30) + int(mom > 60) - int(mom < 0) - int(mom < -10) - int(mom < -30)
        label = ("a very strong winner. In my backtest, stocks like this tended to keep beating the market" if mom > 60 else
                 "a strong winner, and winners tended to keep beating the market" if mom > 30 else
                 "a solid uptrend" if mom > 10 else
                 "only slightly positive, so no clear edge" if mom > 0 else
                 "slightly negative, so no clear edge" if mom > -10 else
                 "a loser, and losers tended to keep lagging the market" if mom > -30 else
                 "a deep loser, and these tended to keep lagging the market")
        add(pts, True if mom > 10 else False if mom < -10 else None,
            f"Momentum: {mom:+.1f}% over the past {span} (skipping the last month), {label}.")
    if s200:
        add(0, price > s200, f"Price is {'above' if price > s200 else 'below'} the 200-day average ({s200:,.2f}).")
    if ret["1M"] is not None:
        add(0, None, f"Last month: {ret['1M']:+.1f}%. Short-term moves are noise, so I don't score them.")
    if r is not None:
        add(0, None, f"RSI is {r:.0f}" + (" (overbought)." if r > 70 else " (oversold)." if r < 30 else "."))
    if vol > 60:
        add(0, False, f"Very high volatility ({vol:.0f}% a year): big swings, so keep the position small.")
    elif vol < 25:
        add(0, None, f"Low volatility ({vol:.0f}% a year): a relatively calm stock.")
    if pos52 > 95:
        add(0, None, "Trading right at its 52-week high.")
    elif pos52 < 10:
        add(0, None, "Trading near its 52-week low.")

    if score >= 4:
        verdict = "STRONG BUY"
    elif score >= 2:
        verdict = "BUY"
    elif score <= -3:
        verdict = "STRONG SELL"
    elif score <= -2:
        verdict = "SELL"
    else:
        verdict = "HOLD"
    confidence = min(90, 50 + abs(score) * 10)

    return {
        "symbol": data["symbol"], "name": data["name"], "currency": data["currency"],
        "price": price, "verdict": verdict, "score": score, "confidence": confidence,
        "stats": {"sma20": s20, "sma50": s50, "sma200": s200, "rsi": r, "macd": macd, "macdSignal": macd_sig,
                  "volatility": vol, "maxDrawdown": mdd, "high52": hi52, "low52": lo52, "pos52": pos52,
                  "returns": ret},
        "reasons": reasons,
    }


SUMMARY = {
    "STRONG BUY": "The technical picture is clearly positive. If it fits your plan, this looks like a good moment to buy.",
    "BUY": "More signals point up than down. Buying looks reasonable — consider building the position step by step.",
    "HOLD": "Signals are mixed. If you own it, holding is sensible; if not, I'd wait for a clearer setup.",
    "SELL": "More signals point down than up. If you hold it, consider taking profits or reducing the position.",
    "STRONG SELL": "The technical picture is clearly negative. Selling or staying away looks like the smarter move.",
}

STOPWORDS = {"I", "A", "AND", "OR", "THE", "IS", "IT", "TO", "BUY", "SELL", "HOLD", "SHOULD", "WHAT", "HOW",
             "ABOUT", "DO", "YOU", "THINK", "OF", "ON", "IN", "ME", "MY", "NOW", "STOCK", "STOCKS", "DAVID", "HI",
             "HELLO", "HEY", "PLEASE", "NEWS", "BUZZ", "SOCIAL", "WORLD", "LATEST", "ANY", "TELL", "CAN", "SHARE", "SHARES", "ANALYZE", "ANALYSE", "WORTH", "IF", "GOOD",
             "BAD", "TODAY", "VS", "COMPARE", "WITH", "WHY", "ARE", "FOR", "THIS", "THAT", "GIVE", "STATS", "SOME"}


def resolve_symbols(text):
    tokens = re.findall(r"\$?[A-Za-z][A-Za-z0-9.\-^]{0,9}", text)
    found = []
    for t in tokens:
        raw = t.lstrip("$")
        if t.startswith("$") or (raw.isupper() and raw not in STOPWORDS and len(raw) <= 6):
            found.append(raw.upper())
    if not found:
        words = [w for w in re.findall(r"[A-Za-z&.\-]+", text) if w.upper() not in STOPWORDS and len(w) > 2]
        for w in words[:3]:
            try:
                hits = search(w)
            except Exception:
                hits = []
            if hits:
                found.append(hits[0]["symbol"])
                break
    alias = {"SP500": "^GSPC", "S&P": "^GSPC", "SPX": "^GSPC", "NASDAQ": "^IXIC", "DOW": "^DJI", "BTC": "BTC-USD"}
    out = []
    for s in found:
        s = alias.get(s, s)
        if s not in out:
            out.append(s)
    return out[:3]


def david_reply(message):
    msg = message.strip()
    if not msg:
        return {"text": "Ask me about any stock, e.g. \"Should I buy NVDA?\" or \"Compare AAPL and MSFT\"."}
    low = msg.lower()
    if re.fullmatch(r"(hi|hello|hey|hallo|servus|moin)[!. ]*(david)?[!. ]*", low):
        return {"text": "Hi, I'm David, your stock consultant. Name a stock (ticker or company) and I'll tell you "
                        "whether it looks like a buy, hold or sell — with the numbers behind it."}
    if "help" in low or "how do you work" in low or "how does" in low:
        return {"text": "I score each stock by its momentum: how much it rose or fell from 12 months ago to 1 month ago. "
                        "Strong winners get BUY or STRONG BUY, big losers get SELL or STRONG SELL. I tested 8 methods on "
                        "60 stocks from 2010 to 2026 and this one picked the best stocks. I still show the 200-day average, "
                        "RSI and volatility for context. Past results don't guarantee anything, and this isn't financial advice."}
    if re.search(r"\b(world|markets?|events?)\b", low) and "news" in low or re.fullmatch(r"(what'?s|any|latest)? ?news\??", low):
        w = get_world()
        lines = "\n".join(f"• {n['title']} ({n['source']})" for n in w["news"][:5])
        return {"text": f"Top business & world headlines right now. {w['summary']['text']}\n{lines}\n"
                        "I show news as context only; my verdicts come from price momentum, which I could backtest."}
    syms = resolve_symbols(msg)
    if syms and re.search(r"\b(news|buzz|social|sentiment|twitter|stocktwits|reddit|happening)\b", low):
        b = get_buzz(syms[0])
        lines = "\n".join(f"• {n['title']} ({n['source']})" for n in b["news"][:4])
        return {"text": f"News & buzz for {b['name']} ({syms[0]}): {b['summary']['text']}\n{lines or 'No headlines this week.'}"}
    if not syms:
        return {"text": "I couldn't find a stock in that message. Try a ticker like AAPL, TSLA or SAP, or a company name."}
    analyses, errors = [], []
    for s in syms:
        try:
            analyses.append(analyze(s))
        except Exception:
            errors.append(s)
    if not analyses:
        return {"text": f"I couldn't load data for {', '.join(errors)}. Check the ticker and try again."}
    if len(analyses) == 1:
        a = analyses[0]
        text = f"{a['name']} ({a['symbol']}) — my verdict: {a['verdict']} ({a['confidence']}% confidence). {SUMMARY[a['verdict']]}"
    else:
        best = max(analyses, key=lambda x: x["score"])
        parts = ", ".join(f"{a['symbol']}: {a['verdict']} (score {a['score']:+d})" for a in analyses)
        text = f"Comparison — {parts}. Based on the technicals, {best['symbol']} currently looks strongest."
    return {"text": text, "analyses": analyses}


# ---------------------------------------------------------------- accounts (Postgres via DATABASE_URL, SQLite locally)
if DATABASE_URL:
    import psycopg

    def _connect():
        return psycopg.connect(DATABASE_URL, autocommit=True)
    PH, ID_COL = "%s", "BIGSERIAL PRIMARY KEY"
else:
    import sqlite3

    def _connect():
        c = sqlite3.connect(os.path.join(ROOT, "data.db"), check_same_thread=False)
        c.isolation_level = None
        return c
    PH, ID_COL = "?", "INTEGER PRIMARY KEY AUTOINCREMENT"

_conn = None
_db_lock = threading.Lock()


def db(sql, args=(), one=False):
    global _conn
    sql = sql.replace("?", PH)
    with _db_lock:
        for attempt in (0, 1):
            try:
                if _conn is None:
                    _conn = _connect()
                cur = _conn.execute(sql, args)
                rows = cur.fetchall() if cur.description else []
                return (rows[0] if rows else None) if one else rows
            except Exception:
                if attempt or not _is_conn_error():
                    raise
                _conn = None


def _is_conn_error():
    try:
        _conn.execute("SELECT 1")
        return False
    except Exception:
        return True


def init_db():
    db(f"""CREATE TABLE IF NOT EXISTS users (
        id {ID_COL}, email TEXT UNIQUE NOT NULL, pw_hash TEXT NOT NULL, created BIGINT NOT NULL,
        broker TEXT, autopilot TEXT, updated BIGINT)""")


EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")
PBKDF2_ROUNDS = 240_000
_fails, _signups = {}, {}


def hash_password(pw, salt=None, rounds=PBKDF2_ROUNDS):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), rounds).hex()
    return f"pbkdf2${rounds}${salt}${h}"


def verify_password(pw, stored):
    try:
        _, rounds, salt, _h = stored.split("$")
        return hmac.compare_digest(hash_password(pw, salt, int(rounds)), stored)
    except ValueError:
        return False


def _sign(uid, exp, pw_hash):
    # tied to the password hash, so changing a password logs out old sessions
    return hmac.new(SESSION_SECRET, f"{uid}.{exp}.{pw_hash[-24:]}".encode(), hashlib.sha256).hexdigest()


def make_token(uid, pw_hash):
    exp = int(time.time()) + SESSION_DAYS * 86400
    return f"{uid}.{exp}.{_sign(uid, exp, pw_hash)}"


def user_from_token(tok):
    parts = (tok or "").split(".")
    if len(parts) != 3 or not parts[0].isdigit() or not parts[1].isdigit() or int(parts[1]) < time.time():
        return None
    row = db("SELECT id, email, pw_hash FROM users WHERE id = ?", (int(parts[0]),), one=True)
    if row and hmac.compare_digest(parts[2], _sign(row[0], int(parts[1]), row[2])):
        return {"id": row[0], "email": row[1]}
    return None


def rate_limited(store, ip, limit, window):
    now = time.time()
    store[ip] = [t for t in store.get(ip, []) if now - t < window]
    return len(store[ip]) >= limit


# ---------------------------------------------------------------- David autopilot
AUTOPILOT_UNIVERSE = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "BRK-B", "JPM", "V",
                      "LLY", "AVGO", "NFLX", "COST", "WMT", "XOM", "UNH", "MA", "SPY", "QQQ"]
RISK_PROFILES = {
    "conservative": {"reserve": 0.30, "max_pos": 5, "max_w": 0.15, "stop": -8.0, "min_score": 3},
    "balanced": {"reserve": 0.10, "max_pos": 8, "max_w": 0.20, "stop": -12.0, "min_score": 2},
    "aggressive": {"reserve": 0.02, "max_pos": 10, "max_w": 0.30, "stop": -18.0, "min_score": 2},
}


def _safe_analyze(sym):
    try:
        return sym, analyze(sym)
    except Exception:
        return sym, None


def autopilot_plan(cash, positions, risk):
    prof = RISK_PROFILES.get(risk, RISK_PROFILES["balanced"])
    held = {s.upper(): p for s, p in positions.items() if float(p.get("shares", 0)) > 0}
    symbols = list(dict.fromkeys(list(held) + AUTOPILOT_UNIVERSE))
    with ThreadPoolExecutor(max_workers=8) as ex:
        analyses = {s: a for s, a in ex.map(_safe_analyze, symbols) if a}
    quotes = get_quotes(symbols, limit=60)
    price = {s: q["priceUsd"] for s, q in quotes.items()}
    value = {s: float(p["shares"]) * price[s] for s, p in held.items() if s in price}
    total = cash + sum(value.values())
    trades, sold_out = [], set()

    def trade(side, sym, usd_amount, reason):
        sh = round(usd_amount / price[sym], 6)
        if sh <= 0:
            return
        q = quotes[sym]
        trades.append({"side": side, "symbol": sym, "name": q["name"], "shares": sh, "price": q["price"],
                       "currency": q["currency"], "priceUsd": price[sym], "total": sh * price[sym], "reason": reason})

    for s, p in held.items():
        if s not in price:
            continue
        a, shares, cost = analyses.get(s), float(p["shares"]), float(p.get("cost", 0))
        pl = (value[s] / cost - 1) * 100 if cost else 0
        if pl <= prof["stop"]:
            trade("sell", s, value[s], f"Stop-loss: down {pl:.1f}% from what I paid, cutting the loss.")
            sold_out.add(s)
        elif a and a["verdict"] == "STRONG SELL":
            trade("sell", s, value[s], f"My verdict turned STRONG SELL (score {a['score']:+d}). Selling everything.")
            sold_out.add(s)
        elif a and a["verdict"] == "SELL":
            if value[s] < 100:
                trade("sell", s, value[s], f"Verdict is SELL (score {a['score']:+d}); closing this small position.")
                sold_out.add(s)
            else:
                trade("sell", s, value[s] / 2, f"Verdict is SELL (score {a['score']:+d}). Selling half to reduce risk.")
        elif total and value[s] / total > prof["max_w"] * 1.25:
            trade("sell", s, value[s] - prof["max_w"] * total,
                  f"Position grew to {value[s] / total * 100:.0f}% of the fund. Taking some profit.")

    cash_after = cash + sum(t["total"] for t in trades)
    for t in trades:
        value[t["symbol"]] = value.get(t["symbol"], 0) - t["total"]

    cands = sorted((a for s, a in analyses.items() if s in price and s not in sold_out and a["score"] >= prof["min_score"]),
                   key=lambda a: (a["score"], a["stats"]["returns"].get("6M") or 0), reverse=True)[:prof["max_pos"]]
    invest_cap = (1 - prof["reserve"]) * total
    weight_sum = sum(a["score"] for a in cands) or 1
    spendable = max(0.0, cash_after - prof["reserve"] * total)
    min_trade = max(25.0, 0.01 * total)
    for a in cands:
        s = a["symbol"]
        target = min(prof["max_w"], a["score"] / weight_sum * (1 - prof["reserve"])) * total
        target = min(target, invest_cap)
        gap = target - value.get(s, 0)
        if gap < min_trade or spendable < min_trade:
            continue
        amount = min(gap, spendable)
        bull = next((r["text"] for r in a["reasons"] if r["tone"] == "bull"), "")
        trade("buy", s, amount, f"Verdict {a['verdict']} (score {a['score']:+d}). {bull}".strip())
        spendable -= amount

    verdicts = {s: {"verdict": a["verdict"], "score": a["score"], "name": a["name"]} for s, a in analyses.items()}
    buys = sum(1 for t in trades if t["side"] == "buy")
    if not trades:
        note = "No changes needed. Your fund already matches my current view of the market."
    else:
        note = f"{buys} buy(s), {len(trades) - buys} sell(s)."
    return {"trades": trades, "total": total, "note": note, "verdicts": verdicts, "quotes": quotes, "risk": risk}


# ---------------------------------------------------------------- HTTP
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=STATIC, **kw)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ---- owner session helpers
    def cookie(self, name):
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == name:
                return v
        return None

    def user(self):
        if not hasattr(self, "_user"):
            try:
                self._user = user_from_token(self.cookie(COOKIE))
            except Exception:
                self._user = None
        return self._user

    def client_ip(self):
        return (self.headers.get("X-Forwarded-For") or self.client_address[0]).split(",")[0].strip()

    def set_session(self, token, max_age):
        secure = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
        return f"{COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}{secure}"

    def send_json_cookie(self, obj, cookie, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def redirect(self, location):
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def serve_private(self, name):
        path = os.path.realpath(os.path.join(PRIVATE, name))
        if not path.startswith(PRIVATE + os.sep) or not os.path.isfile(path):
            return self.send_json({"error": "not found"}, 404)
        ctype = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                 ".css": "text/css; charset=utf-8"}.get(os.path.splitext(path)[1], "application/octet-stream")
        with open(path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Robots-Tag", "noindex")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        if (self.headers.get("Content-Type") or "").split(";")[0].strip() != "application/json":
            raise ValueError("Content-Type must be application/json")
        n = int(self.headers.get("Content-Length") or 0)
        if n > 2_000_000:
            raise ValueError("Request too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        try:
            body = self.read_json()
        except Exception as e:
            return self.send_json({"error": str(e)}, 400)
        if u.path in ("/api/register", "/api/login"):
            return self.auth(u.path == "/api/register", body)
        if u.path == "/api/logout":
            return self.send_json_cookie({"ok": True}, self.set_session("", 0))
        if u.path == "/api/state":
            user = self.user()
            if not user:
                return self.send_json({"error": "Login required"}, 401)
            sets = {k: json.dumps(body[k]) if body[k] is not None else None for k in ("broker", "autopilot") if k in body}
            if sets:
                cols = ", ".join(f"{k} = ?" for k in sets)
                db(f"UPDATE users SET {cols}, updated = ? WHERE id = ?", (*sets.values(), int(time.time()), user["id"]))
            return self.send_json({"ok": True})
        if u.path == "/api/autopilot/plan":
            if not self.user():
                return self.send_json({"error": "Login required"}, 401)
            try:
                cash = max(0.0, float(body.get("cash", 0)))
                positions = body.get("positions") or {}
                if not isinstance(positions, dict) or len(positions) > 40:
                    raise ValueError("bad positions")
                return self.send_json(autopilot_plan(cash, positions, str(body.get("risk", "balanced"))))
            except (ValueError, TypeError) as e:
                return self.send_json({"error": f"Bad request: {e}"}, 400)
            except Exception as e:
                return self.send_json({"error": f"Data source error: {e}"}, 502)
        return self.send_json({"error": "not found"}, 404)

    def auth(self, register, body):
        ip = self.client_ip()
        email = str(body.get("email", "")).strip().lower()
        pw = str(body.get("password", ""))
        try:
            if register:
                if not EMAIL_RE.match(email) or len(email) > 254:
                    return self.send_json({"error": "Please enter a valid email address."}, 400)
                if len(pw) < 8 or len(pw) > 200:
                    return self.send_json({"error": "Password must be at least 8 characters."}, 400)
                if rate_limited(_signups, ip, 10, 3600):
                    return self.send_json({"error": "Too many new accounts from your network. Try again later."}, 429)
                if db("SELECT id FROM users WHERE email = ?", (email,), one=True):
                    return self.send_json({"error": "An account with this email already exists. Log in instead."}, 409)
                pw_hash = hash_password(pw)
                row = db("INSERT INTO users (email, pw_hash, created) VALUES (?, ?, ?) RETURNING id",
                         (email, pw_hash, int(time.time())), one=True)
                _signups.setdefault(ip, []).append(time.time())
            else:
                if rate_limited(_fails, ip, 8, 900):
                    return self.send_json({"error": "Too many wrong attempts. Try again in 15 minutes."}, 429)
                row = db("SELECT id, pw_hash FROM users WHERE email = ?", (email,), one=True)
                if not row or not verify_password(pw, row[1]):
                    _fails.setdefault(ip, []).append(time.time())
                    time.sleep(0.5)
                    return self.send_json({"error": "Wrong email or password."}, 401)
                pw_hash = row[1]
                _fails.pop(ip, None)
        except Exception as e:
            return self.send_json({"error": f"Account database unavailable: {type(e).__name__}"}, 503)
        token = make_token(row[0], pw_hash)
        return self.send_json_cookie({"ok": True, "email": email}, self.set_session(token, SESSION_DAYS * 86400))

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path in ("/david", "/david/"):
            if not self.user():
                return self.redirect("/login.html?next=/david")
            return self.serve_private("david.html")
        if u.path.startswith("/private/"):
            if not self.user():
                return self.send_json({"error": "Login required"}, 401)
            return self.serve_private(u.path[len("/private/"):])
        if u.path == "/api/me":
            user = self.user()
            return self.send_json({"user": {"email": user["email"]} if user else None})
        if u.path == "/api/state":
            user = self.user()
            if not user:
                return self.send_json({"error": "Login required"}, 401)
            row = db("SELECT broker, autopilot FROM users WHERE id = ?", (user["id"],), one=True)
            return self.send_json({"broker": json.loads(row[0]) if row[0] else None,
                                   "autopilot": json.loads(row[1]) if row[1] else None})
        if not u.path.startswith("/api/"):
            return super().do_GET()
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        try:
            if u.path == "/api/ticker":
                return self.send_json(get_ticker())
            if u.path == "/api/chart":
                rng = q.get("range", "1y")
                if rng not in VALID_RANGES:
                    rng = "1y"
                return self.send_json(get_chart(q.get("symbol", "^GSPC").upper(), rng))
            if u.path == "/api/quote":
                return self.send_json(get_quotes(q.get("symbols", "").split(",")))
            if u.path == "/api/search":
                return self.send_json(search(q.get("q", ""))[:8] if q.get("q") else [])
            if u.path == "/api/analysis":
                return self.send_json(analyze(q.get("symbol", "^GSPC").upper()))
            if u.path == "/api/buzz":
                return self.send_json(get_buzz(q.get("symbol", "^GSPC").upper()))
            if u.path == "/api/world":
                return self.send_json(get_world())
            if u.path == "/api/david":
                return self.send_json(david_reply(q.get("q", "")[:300]))
            return self.send_json({"error": "not found"}, 404)
        except LookupError as e:
            return self.send_json({"error": str(e)}, 404)
        except Exception as e:
            return self.send_json({"error": f"Data source error: {e}"}, 502)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    init_db()
    print(f"David Trading running on http://localhost:{port}")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
