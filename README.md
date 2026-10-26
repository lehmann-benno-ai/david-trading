# David Trading

TradingView-style stock consulting site with "David", a bot that gives buy/hold/sell verdicts from technical analysis.

- Data: Yahoo Finance public chart/spark/search endpoints (free, no key), proxied by `server.py` (Python stdlib, no dependencies). History: up to MAX (decades).
- Chart: TradingView lightweight-charts v4.2 (vendored in `static/`).

Run: `python3 server.py` then open http://localhost:8000 (set `PORT` to change).

Live: https://david-trading.onrender.com (Render free tier, Frankfurt; first load after idle takes ~1 min).
