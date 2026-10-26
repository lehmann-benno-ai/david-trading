"""Robustness: portfolio results for different numbers of stocks held, and year by year."""
import numpy as np, pandas as pd
import backtest as bt

px = bt.load()
stocks = [s for s in px.columns if s not in ("SPY", "QQQ")]
feats = {s: bt.features(px[s]) for s in stocks}
dates = px.index[260::bt.STEP]
pick = ["v1 (current David)", "Trend", "Momentum 12-1", "Momentum + 200-day filter", "Trend + momentum"]
rets = px[stocks].pct_change().fillna(0)
spy = px["SPY"].pct_change().fillna(0)
rows, yearly, beat = [], {}, []
for name in pick:
    fn = bt.METHODS[name]
    sc = pd.DataFrame({s: pd.Series(fn(feats[s]), index=px.index).where(feats[s]["s200"].notna() & feats[s]["mom12_1"].notna()) for s in stocks})
    sc = sc + pd.DataFrame({s: feats[s]["r6"] for s in stocks}) * 1e-3
    for top in (5, 8, 10, 15):
        w = pd.DataFrame(np.nan, index=px.index, columns=stocks)
        for d in dates:
            s = sc.loc[d].dropna(); p = s[s >= 2].sort_values(ascending=False).index[:top]
            w.loc[d] = 0.0; w.loc[d, p] = 1 / top
        w = w.ffill().fillna(0)
        held = w.shift(1).fillna(0)
        daily = (held * rets).sum(axis=1) - (w - w.shift(1)).abs().sum(axis=1).fillna(0) * bt.COST
        r = {"method": name, "top": top}
        for per, sl in (("train", slice(px.index[261], bt.TRAIN_END)), ("test", slice(bt.TEST_START, None))):
            st = bt.stats(daily[sl]); r[f"{per}_cagr"] = round(st["cagr"], 1); r[f"{per}_sharpe"] = round(st["sharpe"], 2); r[f"{per}_dd"] = round(st["maxdd"], 1)
        rows.append(r)
        if top == 8:
            yearly[name] = ((1 + daily[px.index[261]:]).groupby(daily[px.index[261]:].index.year).prod() - 1) * 100
            # how often the 8 picks beat SPY over the next 3 months
            f63 = px[stocks].shift(-63) / px[stocks] - 1
            s63 = px["SPY"].shift(-63) / px["SPY"] - 1
            wk = w.loc[dates].iloc[:-13]
            pr = (wk * f63.loc[wk.index].fillna(0)).sum(axis=1) / wk.sum(axis=1).replace(0, np.nan)
            ok = (pr > s63.loc[wk.index]).where(pr.notna())
            beat.append({"method": name, "train_beat%": round(ok[:bt.TRAIN_END].mean() * 100, 1), "test_beat%": round(ok[bt.TEST_START:].mean() * 100, 1)})
yearly["SPY"] = ((1 + spy[px.index[261]:]).groupby(spy[px.index[261]:].index.year).prod() - 1) * 100
pd.set_option("display.width", 250)
print(pd.DataFrame(rows).to_string(index=False))
print(pd.DataFrame(beat).to_string(index=False))
print(pd.DataFrame(yearly).round(1).to_string())
