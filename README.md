# Disclaimer: Not financial advice. Educational purposes only.

# Prediction Market Arbitrage Bot

An educational bot that detects and executes synthetic arbitrage strategies between Polymarket and Kalshi. Built with [pmxt](https://pmxt.dev) - the number 1 unified API for prediction markets.

## What is Synthetic Arbitrage?

Traditional arbitrage guarantees profit by exploiting price differences. This bot implements **synthetic arbitrage**: buying YES on one platform and No on another for the same outcome. If executed simultaneously at favorable prices, you lock in profit when prices converge.

**Example:**
- Polymarket: Kevin Warsh YES = 41¢
- Kalshi: Kevin Warsh NO = 57¢
- **Total cost: 98¢**
- **Payout if executed: 100¢**
- **Potential profit: 2¢**

**Execution Strategy:** We aggressively take liquidity using **Market Orders** on both platforms simultaneously. We do not place limit orders or wait for fills—we instantly seize the best available price to lock in the spread.

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Markets

Edit `config.js` to set your target markets:

```javascript
export const config = {
  polymarketUrl: 'https://polymarket.com/event/who-will-trump-nominate-as-fed-chair',
  kalshiUrl: 'https://kalshi.com/markets/kxfedchairnom/fed-chair-nominee/kxfedchairnom-29',
  pollIntervalSeconds: 30,
  minProfitCents: 1,
  tradingMode: 'YOLO', // or 'CONSERVATIVE'
  dryRun: true, // Set to false for live trading
};
```

### 3. Set Up Credentials (Optional for Dry Run)

Copy `.env.example` to `.env` and add your API keys:

```bash
cp .env.example .env
```

Edit `.env`:
```
POLYMARKET_PRIVATE_KEY=your_private_key_here
KALSHI_API_KEY=your_api_key_here
KALSHI_API_SECRET=your_api_secret_here
```

### 4. Run the Bot

```bash
npm start
```

## How It Works

### 1. Market Matching
The bot uses fuzzy matching (Jaccard + Levenshtein distance) to pair outcomes:
- "Kevin Warsh" on Polymarket -> "Kevin Warsh" on Kalshi
- Handles slight naming variations automatically

### 2. Arbitrage Detection
For each matched outcome, calculates both strategies:
- Strategy 1: Buy YES on Polymarket + Buy NO on Kalshi
- Strategy 2: Buy YES on Kalshi + Buy NO on Polymarket

Picks the strategy with maximum profit.

### 3. Execution (YOLO Mode)
- Finds the best arbitrage opportunity (highest profit)
- Goes ALL IN with available capital
- Places market orders on both platforms
- Waits for fills

### 4. Exit & Rotation Strategy
- **Profit Taking:** When markets converge (profit < 1¢), we sell to realize gains.
- **Opportunity Rotation:** If a **better** arbitrage opportunity appears (higher spread), we immediately exit the current position to rotate capital into the more profitable trade.

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `polymarketUrl` | Polymarket event URL | Required |
| `kalshiUrl` | Kalshi market URL | Required |
| `pollIntervalSeconds` | How often to check prices | 30 |
| `minProfitCents` | Minimum profit to execute trade | 1 |
| `tradingMode` | 'YOLO' (all-in) or 'CONSERVATIVE' | 'YOLO' |
| `tradeAmountCents` | Fixed amount if CONSERVATIVE | 100 |
| `matchingThreshold` | Fuzzy match threshold (0-1) | 0.7 |
| `dryRun` | Test mode (no real trades) | true |

## Optional: pre-trade resolution check (Crosswire)

A synthetic arb is only risk-free if both legs settle the same way. They don't always: the Polymarket and Kalshi legs can use a different resolution source, settle at a different instant, or void under different rules, and resolve to opposite sides. This optional check asks [Crosswire](https://api.crosswire-api.com) whether the two legs are actually fungible before the bot places orders, and gets back `safe` / `caution` / `block` plus the divergence finding codes.

It is **off by default**. Turn it on in `config.js`:

```javascript
resolutionCheck: true,          // default: false
resolutionCheckMode: 'warn',    // 'warn' = log only; 'block' = skip the trade on a BLOCK verdict
crosswireBase: 'https://api.crosswire-api.com',
```

- `warn` (default) logs the verdict and proceeds.
- `block` skips an opportunity that comes back `block`, with a log line naming the finding codes.

It is **fail-open**: any timeout, network error, or non-200 lets the trade proceed, so the bot is never blocked by Crosswire being down. It uses the runtime's built-in `fetch` (no new dependency) on a short timeout, and needs **no API key** (free tier).

**Coverage is narrow today.** It covers cross-venue BTC matched-strike pairs and a World Cup set; everything else (Fed-chair and most political markets) returns "not covered" and passes straight through. It is **advisory only**: Crosswire never executes, prices, or predicts, and the bot sends it nothing but the two market references. Live covered pairs are listed at [`/v1/events`](https://api.crosswire-api.com/v1/events); project at [crosswire-api.com](https://crosswire-api.com).

## Example Output

```
================================================================================
  PREDICTION MARKET ARBITRAGE BOT
  Educational Demo - Built with https://pmxt.dev
================================================================================

Initializing Arbitrage Bot...
API clients initialized

Bot started! Polling every 30s
Min profit: 1¢
Trading mode: YOLO
Dry run: YES

--------------------------------------------------------------------------------

Fetching markets...
   Polymarket: who-will-trump-nominate-as-fed-chair
   Kalshi: kxfedchairnom

Found 6 Polymarket outcomes, 3 Kalshi outcomes

Matched 3 outcome pairs

Found 1 arbitrage opportunity:

   1. Kevin Warsh
      Buy YES on Polymarket (42¢), Buy NO on Kalshi (57¢)
      Profit: 1.00¢ (0.95 match)

EXECUTING ARBITRAGE OPPORTUNITY!
   Outcome: Kevin Warsh
   Strategy: Buy YES on Polymarket (42¢), Buy NO on Kalshi (57¢)
   Expected Profit: 1.00¢

   [DRY RUN] Would execute: polymarket YES 1000¢ on market poly-123
   [DRY RUN] Would execute: kalshi NO 1000¢ on market kalshi-456

Both trades executed successfully!
```

## Project Structure

```
prediction-market-arbitrage-bot/
├── config.js              # User configuration
├── .env.example           # Environment variables template
├── package.json           # Dependencies
├── src/
│   ├── index.js          # Entry point
│   ├── bot.js            # Main bot logic
│   ├── matcher.js        # Fuzzy matching algorithms
│   └── arbitrage.js      # Arbitrage calculations
└── README.md             # This file
```

## Disclaimer

This is an educational project to demonstrate algorithmic trading concepts. 

- Ignores gas fees, trading fees, and slippage
- Uses simplified market order execution
- Not optimized for real-world profitability
- Use at your own risk

## Built With

- [pmxt.dev](https://pmxt.dev) - Unified prediction market API
- Node.js - Runtime
- Pure JavaScript - No frameworks needed

## Learn More

- [pmxt.dev Documentation](https://pmxt.dev/docs)
- [Polymarket API](https://docs.polymarket.com)
- [Kalshi API](https://docs.kalshi.com)

# Disclaimer: Not financial advice. Educational purposes only.

## License

MIT
