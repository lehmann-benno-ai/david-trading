# David Trading

TradingView-style stock consulting site with "David", a bot that gives buy/hold/sell verdicts from technical analysis.

- Data: Yahoo Finance public chart/spark/search endpoints (free, no key), proxied by `server.py` (Python stdlib, no dependencies). History: up to MAX (decades).
- Chart: TradingView lightweight-charts v4.2 (vendored in `static/`).

Run: `python3 server.py` then open http://localhost:8000 (set `PORT` to change).

Live: https://david-trading.onrender.com (Render free tier, Frankfurt; first load after idle takes ~1 min).

## Accounts and David Autopilot

Anyone can create an account with an email and password (`/login.html`). Logged-in users get their demo portfolio and their David fund saved on the server, so it follows them across devices; without an account the demo broker works from the browser only.

`/david` (login required) is David Autopilot: David manages a separate demo fund, funded from the demo broker's cash. Every 30 minutes while the page is open (and on each visit) he scores a universe of large caps and ETFs with his technical analysis and buys/sells according to the chosen risk level (Careful, Balanced, Bold), explaining every trade.

Storage: set `DATABASE_URL` to a Postgres connection string (used via `psycopg`, see `requirements.txt`); without it, a local `data.db` SQLite file is used, which is fine for development but is wiped on Render's free tier. Set `SESSION_SECRET` so logins survive restarts. Passwords are stored as salted PBKDF2-SHA256 hashes; sessions are HMAC-signed HttpOnly cookies valid for 30 days.
