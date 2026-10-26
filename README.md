# David Trading

TradingView-style stock consulting site with "David", a bot that gives buy/hold/sell verdicts from technical analysis.

- Data: Yahoo Finance public chart/spark/search endpoints (free, no key), proxied by `server.py` (Python stdlib, no dependencies). History: up to MAX (decades).
- Chart: TradingView lightweight-charts v4.2 (vendored in `static/`).

Run: `python3 server.py` then open http://localhost:8000 (set `PORT` to change).

Live: https://david-trading.onrender.com (Render free tier, Frankfurt; first load after idle takes ~1 min).

## David Autopilot (owner only)

`/david` is a private page where David manages a separate demo fund, funded from the demo broker's cash. Every 30 minutes while the page is open (and on each visit) he scores a universe of large caps and ETFs with his technical analysis and buys/sells according to the chosen risk level (Careful, Balanced, Bold), explaining every trade.

Access is protected server-side: set `OWNER_PASSWORD` (and `SESSION_SECRET`) as environment variables. Login creates a signed HttpOnly cookie valid for 30 days; `/david`, `/private/*` and `/api/autopilot/plan` reject everyone else. Without `OWNER_PASSWORD`, login is disabled.
