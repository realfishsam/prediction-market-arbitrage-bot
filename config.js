// Configuration for the arbitrage bot
export const config = {
  // Market URLs to monitor
  polymarketUrl: 'https://polymarket.com/event/who-will-trump-nominate-as-fed-chair',
  kalshiUrl: 'https://kalshi.com/markets/kxfedchairnom/fed-chair-nominee/kxfedchairnom-29',

  // Polling interval in seconds
  pollIntervalSeconds: 60,

  // Minimum profit margin in cents to execute trade
  minProfitCents: 0.001,

  // Trading mode: 'YOLO' (all-in) or 'CONSERVATIVE' (fixed amount)
  tradingMode: 'YOLO',

  // If CONSERVATIVE mode, amount to trade per opportunity (in cents)
  tradeAmountCents: 100,

  // API credentials (set via environment variables)
  polymarketPrivateKey: process.env.POLYMARKET_PRIVATE_KEY,
  kalshiApiKey: process.env.KALSHI_API_KEY,
  kalshiApiSecret: process.env.KALSHI_API_SECRET,

  // Fuzzy matching threshold (0-1, higher = stricter matching)
  matchingThreshold: 0.7,

  // Enable dry run mode (no actual trades)
  dryRun: true,

  // Number of top opportunities to show
  topNOpportunities: 5,

  // Minimum price threshold - skip markets where YES or NO is <= this value (in cents)
  minPriceThreshold: 2,

  // Optional pre-trade resolution check via Crosswire (advisory, off by default).
  // Asks whether the two legs actually settle the same way before executing. With
  // resolutionCheck: false the bot behaves exactly as before. Fail-open: never blocks
  // on Crosswire being down or on an uncovered pair. No API key (free tier).
  resolutionCheck: false,
  resolutionCheckMode: 'warn', // 'warn' = log only; 'block' = skip the trade on a BLOCK verdict
  crosswireBase: 'https://api.crosswire-api.com',
};
