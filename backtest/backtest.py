"""Walk-forward backtest of David's stock advice.

Every 5 trading days each method scores every stock using only prices up to that day.
We then look at what the stock did over the next 21 / 63 trading days, compared with SPY.
Train period picks the method, test period checks it on unseen years.
"""
import json, os, sys
import numpy as np, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
TRAIN_END, TEST_START = "2017-12-31", "2018-01-01"
STEP, COST = 5, 0.001


def load():
    cols = {}
    for f in sorted(os.listdir(os.path.join(HERE, "data"))):
        d = json.load(open(os.path.join(HERE, "data", f)))
        s = pd.Series(d["c"], index=pd.to_datetime(d["t"], unit="s").normalize())
        cols[f[:-5]] = s[~s.index.duplicated()]
    px = pd.DataFrame(cols).sort_index()
    return px[px.index >= px["SPY"].first_valid_index()].ffill(limit=5)


def rsi(c, n=14):
    d = c.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    return 100 - 100 / (1 + up / dn)


def features(c):
    f = {"c": c, "s20": c.rolling(20).mean(), "s50": c.rolling(50).mean(), "s200": c.rolling(200).mean(), "rsi": rsi(c)}
    macd = c.ewm(span=12, adjust=False).mean() - c.ewm(span=26, adjust=False).mean()
    f["macd_up"] = macd > macd.ewm(span=9, adjust=False).mean()
    for k, n in (("r1", 21), ("r3", 63), ("r6", 126), ("r12", 252)):
        f[k] = c / c.shift(n) - 1
    f["mom12_1"] = c.shift(21) / c.shift(252) - 1
    f["vol"] = np.log(c).diff().rolling(252).std() * np.sqrt(252)
    hi, lo = c.rolling(252).max(), c.rolling(252).min()
    f["pos52"] = (c - lo) / (hi - lo)
    f["hi52"] = c / hi
    return f


def pts(cond, p):
    return np.where(cond, p, 0)


# ---- point-based methods (same scale as David: integer score, BUY >= 2, STRONG BUY >= 5) ----
def m_v1(f):
    """David's current rules."""
    c, s20, s50, s200, r = f["c"], f["s20"], f["s50"], f["s200"], f["rsi"]
    s = np.where(c > s200, 2, -2) + np.where(s50 > s200, 1, -1)
    s = s + pts((c > s20) & (s20 > s50), 1) - pts((c < s20) & (s20 < s50), 1)
    s = s - pts(r > 75, 2) - pts((r > 70) & (r <= 75), 1) + pts(r < 25, 2) + pts((r >= 25) & (r < 30), 1)
    s = s + np.where(f["macd_up"], 1, -1) + pts(f["r6"] > .15, 1) - pts(f["r6"] < -.15, 1) - pts(f["vol"] > .6, 1)
    return s


def m_trend(f):
    """Trend following: 200-day average + golden cross + 20/50 alignment."""
    c, s20, s50, s200 = f["c"], f["s20"], f["s50"], f["s200"]
    return (np.where(c > s200, 2, -2) + np.where(s50 > s200, 1, -1)
            + pts((c > s20) & (s20 > s50), 1) - pts((c < s20) & (s20 < s50), 1))


def m_momentum(f):
    """12-month momentum, skipping the last month (classic academic factor)."""
    m = f["mom12_1"]
    return (pts(m > 0, 1) + pts(m > .1, 1) + pts(m > .3, 1) + pts(m > .6, 1)
            - pts(m < 0, 1) - pts(m < -.1, 1) - pts(m < -.3, 1))


def m_meanrev(f):
    """Buy the dip: oversold RSI / big 1-month drop = buy, overbought = sell."""
    r, r1 = f["rsi"], f["r1"]
    return (pts(r < 30, 2) + pts(r < 25, 1) - pts(r > 70, 2) - pts(r > 75, 1)
            + pts(r1 < -.1, 1) - pts(r1 > .1, 1))


def m_v1_no_rsi(f):
    """David's rules without the 'overbought = sell' penalty."""
    r = f["rsi"]
    return m_v1(f) + pts(r > 75, 2) + pts((r > 70) & (r <= 75), 1) - pts(r < 25, 2) - pts((r >= 25) & (r < 30), 1)


def m_trend_mom(f):
    """Trend filter + 12-1 momentum + near 52-week high, minus very high volatility."""
    c, s50, s200, m = f["c"], f["s50"], f["s200"], f["mom12_1"]
    s = np.where(c > s200, 2, -2) + np.where(s50 > s200, 1, -1)
    s = s + pts(m > .1, 1) + pts(m > .3, 1) - pts(m < -.1, 1) - pts(m < -.3, 1)
    s = s + pts(f["hi52"] > .9, 1) - pts(f["hi52"] < .7, 1) - pts(f["vol"] > .6, 1)
    return s


def m_mom_trend(f):
    """Momentum 12-1, but never BUY below the 200-day average."""
    return np.where(f["c"] > f["s200"], m_momentum(f), np.minimum(m_momentum(f), 0) - 1)


def m_trend_mom_dip(f):
    """trend_mom, plus: buy short dips inside an uptrend, avoid spikes."""
    c, s200, r = f["c"], f["s200"], f["rsi"]
    return m_trend_mom(f) + pts((c > s200) & (r < 40), 1) - pts(r > 80, 1)


METHODS = {"v1 (current David)": m_v1, "Trend": m_trend, "Momentum 12-1": m_momentum, "Buy the dip": m_meanrev,
           "v1 without RSI penalty": m_v1_no_rsi, "Trend + momentum": m_trend_mom, "Trend + momentum + dip": m_trend_mom_dip,
           "Momentum + 200-day filter": m_mom_trend}


def verdict(s):
    return np.select([s >= 5, s >= 2, s <= -5, s <= -2], ["STRONG BUY", "BUY", "STRONG SELL", "SELL"], "HOLD")


def evaluate(px):
    spy = px["SPY"]
    stocks = [s for s in px.columns if s not in ("SPY", "QQQ")]
    feats = {s: features(px[s]) for s in stocks}
    fwd = {h: {s: px[s].shift(-h) / px[s] - 1 - (spy.shift(-h) / spy - 1) for s in stocks} for h in (21, 63)}
    fwd_abs = {s: px[s].shift(-63) / px[s] - 1 for s in stocks}
    dates = px.index[260::STEP]
    rows = []
    for name, fn in METHODS.items():
        sc = pd.DataFrame({s: pd.Series(fn(feats[s]), index=px.index).where(feats[s]["s200"].notna() & feats[s]["mom12_1"].notna()) for s in stocks})
        sc = sc.loc[dates]
        long = sc.stack().rename("score").to_frame()
        for h in (21, 63):
            long[f"x{h}"] = pd.DataFrame(fwd[h]).loc[dates].stack()
        long["abs63"] = pd.DataFrame(fwd_abs).loc[dates].stack()
        long = long.dropna()
        long["verdict"] = verdict(long["score"].values)
        long["period"] = np.where(long.index.get_level_values(0) <= TRAIN_END, "train", "test")
        for per, g in long.groupby("period"):
            ic = g.groupby(level=0).apply(lambda d: d["score"].corr(d["x63"], method="spearman") if d["score"].nunique() > 1 else np.nan).dropna()
            buy, sell = g[g.verdict.isin(["BUY", "STRONG BUY"])], g[g.verdict.isin(["SELL", "STRONG SELL"])]
            hit = (np.r_[(buy.x63 > 0).values, (sell.x63 < 0).values]).mean()
            rows.append({"method": name, "period": per, "IC": ic.mean(), "IC_t": ic.mean() / ic.std() * np.sqrt(len(ic)),
                         "buy_n": len(buy), "buy_x63": buy.x63.mean() * 100, "buy_beat": (buy.x63 > 0).mean() * 100,
                         "buy_up": (buy.abs63 > 0).mean() * 100, "sell_n": len(sell), "sell_x63": sell.x63.mean() * 100,
                         "sell_lag": (sell.x63 < 0).mean() * 100, "spread63": (buy.x63.mean() - sell.x63.mean()) * 100,
                         "spread21": (buy.x21.mean() - sell.x21.mean()) * 100, "accuracy": hit * 100,
                         "sbuy_x63": g[g.verdict == "STRONG BUY"].x63.mean() * 100})
        tie = pd.DataFrame({s: feats[s]["r6"] for s in stocks}).loc[dates] * 1e-3
        rows += portfolio(px, (sc + tie).reindex(px.index).ffill(limit=STEP), stocks, name)
    return pd.DataFrame(rows)


def portfolio(px, sc, stocks, name, top=8, min_score=2):
    """Weekly rebalanced: equal-weight the top-8 stocks scoring BUY or better, rest in cash."""
    rets = px[stocks].pct_change()
    w = pd.DataFrame(0.0, index=px.index, columns=stocks)
    cur = pd.Series(0.0, index=stocks)
    for i, d in enumerate(px.index[260:], 260):
        if (i - 260) % STEP == 0:
            s = sc.loc[d].dropna()
            pick = s[s >= min_score].sort_values(ascending=False).index[:top]
            cur = pd.Series(0.0, index=stocks); cur[pick] = 1 / top
        w.loc[d] = cur
    held = w.shift(1).fillna(0)
    turnover = (w - w.shift(1)).abs().sum(axis=1).fillna(0)
    daily = (held * rets.fillna(0)).sum(axis=1) - turnover * COST
    out = []
    for per, sl in (("train", slice(px.index[261], TRAIN_END)), ("test", slice(TEST_START, None))):
        out.append({"method": name, "period": per, **stats(daily[sl], "pf_"), "pf_invested": held[sl].sum(axis=1).mean() * 100})
    return out


def stats(r, p=""):
    eq = (1 + r).cumprod()
    yrs = len(r) / 252
    return {p + "cagr": (eq.iloc[-1] ** (1 / yrs) - 1) * 100, p + "sharpe": r.mean() / r.std() * np.sqrt(252),
            p + "maxdd": (eq / eq.cummax() - 1).min() * 100}


if __name__ == "__main__":
    px = load()
    print("data:", px.index[0].date(), "->", px.index[-1].date(), "stocks:", len(px.columns) - 2, list(px.columns), file=sys.stderr)
    res = evaluate(px).groupby(["method", "period"]).first().reset_index()
    spy, stocks = px["SPY"].pct_change(), [s for s in px.columns if s not in ("SPY", "QQQ")]
    ew = px[stocks].pct_change().mean(axis=1)
    bench = []
    for per, sl in (("train", slice(px.index[261], TRAIN_END)), ("test", slice(TEST_START, None))):
        bench.append({"method": "SPY buy & hold", "period": per, **stats(spy[sl], "pf_"), "pf_invested": 100})
        bench.append({"method": "All 60 stocks equal-weight", "period": per, **stats(ew[sl], "pf_"), "pf_invested": 100})
    res = pd.concat([res, pd.DataFrame(bench)], ignore_index=True)
    res.to_csv(os.path.join(HERE, "results.csv"), index=False)
    pd.set_option("display.width", 250); pd.set_option("display.max_columns", 30)
    for per in ("train", "test"):
        print(f"\n=== {per} ===")
        print(res[res.period == per].drop(columns="period").set_index("method").round(2).to_string())
