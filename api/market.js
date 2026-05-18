const TWELVEDATA_KEY = process.env.TWELVE_DATA_KEY;
const FINNHUB_KEY = process.env.FINNHUB_KEY;
const BASE = 'https://api.twelvedata.com';
const FH = 'https://finnhub.io/api/v1';

async function td(path) {
  const res = await fetch(`${BASE}${path}&apikey=${TWELVEDATA_KEY}`);
  return res.json();
}

async function fh(path) {
  const res = await fetch(`${FH}${path}&token=${FINNHUB_KEY}`);
  return res.json();
}

const SECTOR_MAP = {
  NVDA:'XLK', AMD:'XLK', MSFT:'XLK', AAPL:'XLK', GOOGL:'XLK', META:'XLK', TSLA:'XLK',
  AMZN:'XLK', CRM:'XLK', ORCL:'XLK', INTC:'XLK', QCOM:'XLK', AVGO:'XLK', NOW:'XLK',
  JPM:'XLF', BAC:'XLF', GS:'XLF', MS:'XLF', WFC:'XLF', C:'XLF', AXP:'XLF',
  JNJ:'XLV', PFE:'XLV', UNH:'XLV', ABBV:'XLV', MRK:'XLV', LLY:'XLV',
  XOM:'XLE', CVX:'XLE', COP:'XLE', SLB:'XLE', OXY:'XLE',
  AMGN:'XLB', LIN:'XLB', APD:'XLB', NEM:'XLB',
  CAT:'XLI', GE:'XLI', HON:'XLI', UPS:'XLI', RTX:'XLI', BA:'XLI', DE:'XLI',
  PG:'XLP', KO:'XLP', PEP:'XLP', WMT:'XLP', COST:'XLP', MCD:'XLP',
  NEE:'XLU', DUK:'XLU', SO:'XLU', D:'XLU',
  AMT:'XLRE', PLD:'XLRE', SPG:'XLRE',
  OUST:'ARKQ', IONQ:'ARKQ', RKLB:'ARKQ', PLTR:'ARKQ',
};

function calcSupportResistance(candles, currentPrice) {
  if (!candles || candles.length < 10) return { support: [], resistance: [] };
  const pivots = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    if (h > candles[i-1].high && h > candles[i-2].high && h > candles[i+1].high && h > candles[i+2].high) {
      pivots.push({ price: parseFloat(h.toFixed(2)), type: 'resistance' });
    }
    if (l < candles[i-1].low && l < candles[i-2].low && l < candles[i+1].low && l < candles[i+2].low) {
      pivots.push({ price: parseFloat(l.toFixed(2)), type: 'support' });
    }
  }
  const clustered = [];
  pivots.forEach(p => {
    const existing = clustered.find(c => Math.abs(c.price - p.price) / p.price < 0.015 && c.type === p.type);
    if (existing) { existing.strength++; }
    else { clustered.push({ ...p, strength: 1 }); }
  });
  const support = clustered
    .filter(p => p.type === 'support' && p.price < currentPrice)
    .sort((a, b) => b.strength - a.strength || b.price - a.price)
    .slice(0, 3).map(p => p.price);
  const resistance = clustered
    .filter(p => p.type === 'resistance' && p.price > currentPrice)
    .sort((a, b) => b.strength - a.strength || a.price - b.price)
    .slice(0, 3).map(p => p.price);
  return { support, resistance };
}

function calcAvgVolume(timeSeries) {
  if (!timeSeries || timeSeries.length < 5) return 0;
  const volumes = timeSeries.slice(0, 20).map(d => parseInt(d.volume || 0)).filter(v => v > 0);
  return volumes.length ? Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length) : 0;
}

// Get next earnings date from Finnhub earnings calendar
function getFinnhubEarningsDate(fhEarnings) {
  try {
    const list = fhEarnings?.earningsCalendar || [];
    const today = new Date().toISOString().split('T')[0];
    // Find next upcoming earnings
    const upcoming = list
      .filter(e => e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date));
    return upcoming[0]?.date || null;
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  const sym = symbol.toUpperCase();
  const sectorEtf = SECTOR_MAP[sym] || 'SPY';

  try {
    const [quote, rsi, macd, ema50, ema200, tdEarnings, ohlc, vixQ, spyQ, spyEma50, sectorQ, sectorEma50] = await Promise.all([
      td(`/quote?symbol=${sym}`),
      td(`/rsi?symbol=${sym}&interval=1day&time_period=14&outputsize=1`),
      td(`/macd?symbol=${sym}&interval=1day&outputsize=1`),
      td(`/ema?symbol=${sym}&interval=1day&time_period=50&outputsize=1`),
      td(`/ema?symbol=${sym}&interval=1day&time_period=200&outputsize=1`),
      td(`/earnings?symbol=${sym}&outputsize=1`),
      td(`/time_series?symbol=${sym}&interval=1day&outputsize=90`),
      td(`/quote?symbol=VIX`),
      td(`/quote?symbol=SPY`),
      td(`/ema?symbol=SPY&interval=1day&time_period=50&outputsize=1`),
      td(`/quote?symbol=${sectorEtf}`),
      td(`/ema?symbol=${sectorEtf}&interval=1day&time_period=50&outputsize=1`),
    ]);

    // Finnhub calls — earnings calendar + analyst ratings + quote
    const today = new Date().toISOString().split('T')[0];
    const futureDate = new Date(Date.now() + 180 * 86400000).toISOString().split('T')[0];
    const [finnhubQuote, recommendations, fhEarnings] = await Promise.all([
      fh(`/quote?symbol=${sym}`),
      fh(`/stock/recommendation?symbol=${sym}`),
      fh(`/calendar/earnings?symbol=${sym}&from=${today}&to=${futureDate}`),
    ]);

    // Process OHLC
    const candles = (ohlc.values || []).map(d => ({
      high: parseFloat(d.high),
      low: parseFloat(d.low),
      close: parseFloat(d.close),
      volume: parseInt(d.volume || 0),
    }));

    const currentPrice = parseFloat(quote.close || quote.price || 0);
    const { support, resistance } = calcSupportResistance(candles, currentPrice);
    const avgVolume20 = calcAvgVolume(ohlc.values || []);
    const todayVolume = candles.length > 0 ? candles[0].volume : 0;
    const volumeRatio = avgVolume20 > 0 ? parseFloat((todayVolume / avgVolume20).toFixed(2)) : null;

    // Earnings — Twelve Data first, fallback to Finnhub
    const tdEarningsDate = tdEarnings.earnings?.[0]?.date || null;
    const fhEarningsDate = getFinnhubEarningsDate(fhEarnings);
    const earningsDate = tdEarningsDate || fhEarningsDate;

    // Analyst consensus
    const rec = recommendations?.[0] || {};
    const totalRecs = (rec.buy || 0) + (rec.hold || 0) + (rec.sell || 0) + (rec.strongBuy || 0) + (rec.strongSell || 0);
    const analystBullPct = totalRecs > 0 ? Math.round(((rec.buy || 0) + (rec.strongBuy || 0)) / totalRecs * 100) : null;

    // MACD
    const macdVal = parseFloat(macd.values?.[0]?.macd || 0);
    const macdSig = parseFloat(macd.values?.[0]?.signal || 0);
    const macdHist = parseFloat(macd.values?.[0]?.histogram || 0);
    const macdBias = macdVal > macdSig ? 'bullish' : 'bearish';

    // 52w range from Finnhub
    const fhHigh52 = finnhubQuote.h || 0;
    const fhLow52 = finnhubQuote.l || 0;

    res.status(200).json({
      symbol: sym,
      price: currentPrice,
      change_pct: parseFloat(quote.percent_change || 0),
      rsi: parseFloat(rsi.values?.[0]?.rsi || 0),
      macd: { macd: macdVal, signal: macdSig, histogram: macdHist, bias: macdBias },
      ema50: parseFloat(ema50.values?.[0]?.ema || 0),
      ema200: parseFloat(ema200.values?.[0]?.ema || 0),
      earnings_date: earningsDate,
      earnings_source: tdEarningsDate ? 'twelvedata' : fhEarningsDate ? 'finnhub' : null,
      vix: parseFloat(vixQ.close || vixQ.price || 0),
      spy_price: parseFloat(spyQ.close || spyQ.price || 0),
      spy_ema50: parseFloat(spyEma50.values?.[0]?.ema || 0),
      volume_today: todayVolume,
      volume_avg20: avgVolume20,
      volume_ratio: volumeRatio,
      support,
      resistance,
      sector_etf: sectorEtf,
      sector_price: parseFloat(sectorQ.close || sectorQ.price || 0),
      sector_ema50: parseFloat(sectorEma50.values?.[0]?.ema || 0),
      analyst_buy_pct: analystBullPct,
      analyst_total: totalRecs,
      analyst_buy: (rec.buy || 0) + (rec.strongBuy || 0),
      analyst_hold: rec.hold || 0,
      analyst_sell: (rec.sell || 0) + (rec.strongSell || 0),
      fh_52w_high: fhHigh52,
      fh_52w_low: fhLow52,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
