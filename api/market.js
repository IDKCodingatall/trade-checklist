const TWELVEDATA_KEY = process.env.TWELVE_DATA_KEY;
const BASE = 'https://api.twelvedata.com';

async function td(path) {
  const res = await fetch(`${BASE}${path}&apikey=${TWELVEDATA_KEY}`);
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  try {
    const [quote, rsi, macd, ema50, ema200, earnings] = await Promise.all([
      td(`/quote?symbol=${symbol}`),
      td(`/rsi?symbol=${symbol}&interval=1day&time_period=14&outputsize=1`),
      td(`/macd?symbol=${symbol}&interval=1day&outputsize=1`),
      td(`/ema?symbol=${symbol}&interval=1day&time_period=50&outputsize=1`),
      td(`/ema?symbol=${symbol}&interval=1day&time_period=200&outputsize=1`),
      td(`/earnings?symbol=${symbol}&outputsize=1`),
    ]);

    const [vix, spy] = await Promise.all([
      td(`/quote?symbol=VIX`),
      td(`/quote?symbol=SPY`),
    ]);

    const spyEma50 = await td(`/ema?symbol=SPY&interval=1day&time_period=50&outputsize=1`);

    res.status(200).json({
      symbol: symbol.toUpperCase(),
      price: parseFloat(quote.close || quote.price || 0),
      change_pct: parseFloat(quote.percent_change || 0),
      rsi: parseFloat(rsi.values?.[0]?.rsi || 0),
      macd: {
        macd: parseFloat(macd.values?.[0]?.macd || 0),
        signal: parseFloat(macd.values?.[0]?.signal || 0),
        histogram: parseFloat(macd.values?.[0]?.histogram || 0),
      },
      ema50: parseFloat(ema50.values?.[0]?.ema || 0),
      ema200: parseFloat(ema200.values?.[0]?.ema || 0),
      earnings_date: earnings.earnings?.[0]?.date || null,
      vix: parseFloat(vix.close || vix.price || 0),
      spy_price: parseFloat(spy.close || spy.price || 0),
      spy_ema50: parseFloat(spyEma50.values?.[0]?.ema || 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
