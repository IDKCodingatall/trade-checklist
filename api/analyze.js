const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const SYSTEM_PROMPT = `You are a disciplined institutional options trading analyst. You receive pre-calculated market data and return a structured JSON trading recommendation. Never add commentary outside the JSON. Never hallucinate numbers — only use what is provided.

Portfolio rules you must always apply:
- RH Trading ($50K): Max $1,000/trade (2%). Goal $1K/week. Naked long options only.
- Fidelity IRA ($240K): Max $4,800/trade (2%). Growth sleeve for speculative plays.
- Fidelity Roth IRA ($7K): Flag ANY contract over $700 (10% of account). Extreme caution.
- RH Investing ($100K): NO options. Long-term equity only.
- DTE: 60-90 days preferred. Never buy options with earnings within 21 days at high IV.
- Close at 50% profit. Stop at 2x premium paid.
- Volume ratio below 0.7 on a breakout = do not trust the move.
- Bear case required before any bullish thesis.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { marketData, account, strategy, screenshotBase64 } = req.body;
  if (!marketData) return res.status(400).json({ error: 'marketData required' });

  const m = marketData;
  const earningsDays = m.earnings_date
    ? Math.round((new Date(m.earnings_date) - new Date()) / 86400000)
    : null;

  const dataPrompt = `Analyze ${m.symbol} for a ${strategy || 'options trade'} in ${account || 'RH Trading'}.

LIVE CALCULATED DATA:
Price: $${m.price?.toFixed(2)} (${m.change_pct >= 0 ? '+' : ''}${m.change_pct?.toFixed(2)}% today)
RSI (14): ${m.rsi?.toFixed(1)}
MACD: ${m.macd?.bias} — MACD ${m.macd?.macd?.toFixed(3)}, Signal ${m.macd?.signal?.toFixed(3)}, Histogram ${m.macd?.histogram?.toFixed(3)}
EMA 50: $${m.ema50?.toFixed(2)} — price is ${m.price > m.ema50 ? 'ABOVE (bullish)' : 'BELOW (bearish)'}
EMA 200: $${m.ema200?.toFixed(2)} — price is ${m.price > m.ema200 ? 'ABOVE (bullish)' : 'BELOW (bearish)'}
Volume today: ${m.volume_today?.toLocaleString()} | 20-day avg: ${m.volume_avg20?.toLocaleString()} | Ratio: ${m.volume_ratio}x ${m.volume_ratio >= 1.5 ? '(HIGH — confirms move)' : m.volume_ratio < 0.7 ? '(LOW — do not trust breakout)' : '(Normal)'}
Support levels: ${m.support?.join(', ') || 'N/A'}
Resistance levels: ${m.resistance?.join(', ') || 'N/A'}
Earnings: ${earningsDays !== null ? (earningsDays > 0 ? `${earningsDays} days away (${m.earnings_date})` : `Past (${m.earnings_date})`) : 'Unknown'}
VIX: ${m.vix?.toFixed(1)} (${m.vix < 20 ? 'Green macro' : m.vix < 30 ? 'Yellow — caution' : 'Red — no new trades'})
SPY: $${m.spy_price?.toFixed(2)} vs EMA50 $${m.spy_ema50?.toFixed(2)} — ${m.spy_price > m.spy_ema50 ? 'Uptrend' : 'Below EMA50'}
Sector (${m.sector_etf}): $${m.sector_price?.toFixed(2)} vs EMA50 $${m.sector_ema50?.toFixed(2)} — ${m.sector_price > m.sector_ema50 ? 'Sector bullish' : 'Sector bearish'}
Analyst consensus: ${m.analyst_buy_pct !== null ? `${m.analyst_buy_pct}% bullish (${m.analyst_buy} buy, ${m.analyst_hold} hold, ${m.analyst_sell} sell)` : 'No data'}
52-week range: $${m.fh_52w_low} – $${m.fh_52w_high}
Account selected: ${account || 'RH Trading'}
Strategy: ${strategy || 'Long call/put'}

${screenshotBase64 ? 'Options chain screenshot also provided — extract strikes, premiums, IV per strike, and incorporate into recommendation.' : ''}

Return ONLY valid JSON, no markdown, no explanation:
{
  "verdict": "GO" | "CAUTION" | "STOP",
  "signal": "BULL" | "BEAR" | "NEUTRAL",
  "bias": "Long call" | "Long put" | "CSP" | "Covered call" | "Buy stock" | "Avoid",
  "entry_zone": "$XXX – $XXX",
  "target": "$XXX",
  "stop": "$XXX",
  "account": "RH Trading" | "Fidelity IRA" | "Fidelity Roth IRA" | "RH Investing",
  "contracts": "X contracts (~$XXX)",
  "top_risk": "One sentence most critical risk right now",
  "bear_case": "One sentence what kills this trade",
  "rsi_read": "Neutral/Overbought/Oversold + one-line interpretation",
  "macd_read": "Bullish/Bearish + one-line interpretation",
  "volume_read": "Confirms/Warns/Neutral + one line",
  "ema_read": "Bullish/Bearish/Mixed + one line",
  "earnings_risk": "Safe/Caution/Danger — X days away",
  "iv_read": "Elevated/Normal/Subdued — favor buying or selling",
  "sector_read": "Bullish/Bearish — sector ETF above/below EMA",
  "macro_color": "Green" | "Yellow" | "Red",
  "strike_suggestion": "Specific strike and expiry if options data available else null",
  "protocol_violations": ["list any rule violations empty array if none"],
  "disclaimer": "Verify before executing. Not financial advice."
}`;

  try {
    const userContent = screenshotBase64
      ? [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: screenshotBase64 } },
          { type: 'text', text: dataPrompt },
        ]
      : dataPrompt;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(502).json({ error: err.error?.message || 'Claude API error' });
    }

    const data = await response.json();
    let text = data.content?.[0]?.text || '{}';
    text = text.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return res.status(200).json({ raw: text, parse_error: true });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
