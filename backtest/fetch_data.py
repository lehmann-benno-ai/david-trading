"""Download daily closes (split/dividend-adjusted) from Yahoo for the backtest universe."""
import json, os, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

UNIVERSE = ("AAPL MSFT NVDA AMZN GOOGL META TSLA BRK-B JPM V LLY AVGO NFLX COST WMT XOM UNH MA JNJ PG HD KO PEP MRK "
            "ABBV CVX BAC WFC C GS INTC CSCO ORCL IBM QCOM TXN AMD ADBE CRM PYPL DIS NKE MCD SBUX BA CAT GE MMM HON "
            "UPS F GM T VZ PFE BMY CVS WBA MO KHC AAL CCL M SPY QQQ").split()
OUT = os.path.join(os.path.dirname(__file__), "data")


def fetch(sym):
    path = os.path.join(OUT, f"{sym}.json")
    if os.path.exists(path):
        return sym, "cached"
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?period1=1230768000&period2={int(time.time())}"
           "&interval=1d&events=div,splits&includeAdjustedClose=true")
    for attempt in range(4):
        try:
            res = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30))["chart"]["result"][0]
            break
        except Exception as e:
            err = e; time.sleep(2 + attempt * 3)
    else:
        return sym, f"failed: {err}"
    adj = res["indicators"]["adjclose"][0]["adjclose"]
    rows = [(t, a) for t, a in zip(res["timestamp"], adj) if a]
    json.dump({"t": [r[0] for r in rows], "c": [r[1] for r in rows]}, open(path, "w"))
    return sym, len(rows)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    with ThreadPoolExecutor(4) as ex:
        for sym, n in ex.map(fetch, UNIVERSE):
            print(sym, n)
