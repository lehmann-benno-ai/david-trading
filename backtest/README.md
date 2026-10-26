# Backtest: how accurate is David's advice?

`python3 fetch_data.py && python3 backtest.py && python3 sensitivity.py`

**Setup.** 60 large US stocks from all sectors, including losers (Intel, Boeing, AAL, Carnival, Macy's, Ford, Pfizer, Kraft Heinz...), daily adjusted prices 2009–Oct 2026 from Yahoo. Every 5 trading days, each method scores every stock using **only data up to that day**. We then check what happened over the next 1 and 3 months versus the S&P 500 (SPY).
Methods were compared on **2010–2017 (train)** and checked on **2018–2026 (test, unseen)**.

Portfolio test = what Autopilot does: each week hold the 8 highest-scoring stocks rated BUY or better, equal weight, 0.1% trading cost.

| Method | Train CAGR | Train Sharpe | Test CAGR | Test Sharpe | Test max drawdown | Top-8 beat SPY over next 3 months (test) |
|---|---|---|---|---|---|---|
| **Momentum 12-1 (new David)** | 27.9% | 1.25 | **25.7%** | **0.98** | -34% | **56.8%** |
| Momentum + 200-day filter | 29.4% | 1.32 | 19.3% | 0.81 | -33% | 54.1% |
| Trend (200/50/20-day averages) | 19.8% | 1.06 | 16.1% | 0.78 | -33% | 52.2% |
| Trend + momentum | 20.9% | 1.10 | 13.2% | 0.67 | -29% | 52.7% |
| v1 without RSI penalty | 17.0% | 0.98 | 7.9% | 0.47 | -36% | – |
| **v1 (old David)** | 13.8% | 0.83 | 5.5% | 0.37 | -38% | 51.5% |
| Buy the dip (RSI / 1-month drop) | 2.7% | 0.39 | 2.8% | 0.25 | -41% | – |
| SPY buy & hold | 13.5% | 0.94 | 14.5% | 0.81 | -34% | – |
| All 60 stocks, equal weight | 19.6% | 1.25 | 16.5% | 0.88 | -35% | – |

Momentum 12-1 was best on the unseen years for every portfolio size tested (5, 8, 10, 15 stocks).

**Honest caveats**
- For a *single* stock call, every method is close to a coin flip: BUY/SELL calls beat or lagged the market over 3 months only 49–53% of the time. The edge shows up when ranking many stocks and holding the best ones, which is what Autopilot does.
- The stock list is today's large companies, so it is biased toward winners (survivorship bias: e.g. Walgreens was delisted and couldn't be downloaded). That flatters all methods, especially momentum. Compare against "All 60 stocks, equal weight", not only SPY.
- Momentum has bad years (2011, 2022, 2025 lagged SPY) and drawdowns as deep as the market's.
- Past results don't guarantee future returns. Not financial advice.
