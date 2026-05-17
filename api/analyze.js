const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { ticker, strat, acct, marketData } = req.body;
  if (!ticker) return res.status(400).json({ error: 'ticker required' });

  // Build a rich prompt using live market data if available
  let dataContext = '';
  if (marketData) {
    const m = marketData;
    dataContext = `
Here is the current live market data for ${ticker}:
- Price: $${m.price?.toFixed(2)} (${m.change_pct >= 0 ? '+' : ''}${m.change_pct?.toFixed(2)}% today)
- RSI (14): ${m.rsi?.toFixed(1)}
- EMA 50: $${m.ema50?.toFixed(2)} — price is ${m.price > m.ema50 ? 'ABOVE (bullish)' : 'BELOW (bearish)'}
- EMA 200: $${m.ema200?.toFixed(2)} — price is ${m.price > m.ema200 ? 'ABOVE (bullish)' : 'BELOW (bearish)'}
- MACD: ${m.macd?.macd?.toFixed(3)}, Signal: ${m.macd?.signal?.toFixed(3)}, Histogram: ${m.macd?.histogram?.toFixed(3)}
- Earnings date: ${m.earnings_date || 'unknown'}
- VIX: ${m.vix?.toFixed(1)} (${m.vix < 20 ? 'green macro' : m.vix < 30 ? 'yellow/caution macro' : 'red macro — high fear'})
- SPY: $${m.spy_price?.toFixed(2)} vs EMA50 $${m.spy_ema50?.toFixed(2)} — SPY is ${m.spy_price > m.spy_ema50 ? 'in uptrend' : 'below EMA50 (bearish)'}

Use this data directly in your analysis. Do not say you lack real-time data.`;
  }

  const prompt = `You are a disciplined options and stock trader. Analyze ${ticker} for a ${strat || 'general options trade'} in ${acct || 'a trading account'}.
${dataContext}

Provide a structured analysis covering:
1. **Macro environment** — VIX level, SPY trend, what they mean for this trade
2. **Technical setup** — RSI, MACD, EMA 50/200 interpretation for ${ticker}
3. **Trade recommendation** — Entry zone, profit target (20–50% of max gain), stop loss (2× premium for buyers), and position size (2–4% of account)
4. **Risk factors** — Earnings proximity, IV environment, any red flags
5. **Verdict** — Go / Caution / Avoid with one clear sentence why

Be specific and direct. No fluff. Use the live data provided.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(502).json({ error: err.error?.message || 'Claude API error' });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    return res.status(200).json({ analysis: text });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
