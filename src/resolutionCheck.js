// Optional pre-trade resolution check via Crosswire (https://api.crosswire-api.com).
//
// A cross-venue arb is only risk-free if both legs settle the same way. They don't
// always: different resolution source, settlement instant, or void rule can resolve
// the two legs to opposite sides. Before firing, this asks Crosswire whether the
// Polymarket and Kalshi legs are actually fungible and gets back SAFE / CAUTION / BLOCK
// plus the divergence finding codes. It is advisory only: Crosswire never prices,
// predicts, or executes anything, and we send no positions or balances.
//
// Coverage is narrow today: cross-venue BTC matched-strike pairs and a World Cup set.
// Everything else (Fed-chair, most political markets) is not covered. This guard is
// fail-open everywhere: any timeout, network error, non-200 (including 404
// pair_not_covered and 402 on the metered crypto pairs, since we run the free tier
// with no key) returns { covered: false }, so the bot is never blocked by Crosswire
// being down or by a pair it can't audit.

const DEFAULT_BASE = 'https://api.crosswire-api.com';
const TIMEOUT_MS = 4000;

// polymarketRef / kalshiRef: { marketId, outcome, side }
// Returns { covered: false } on any pass-through, or
// { covered: true, verdict: 'safe'|'caution'|'block', findings: string[] } on a hit.
export async function checkResolution(polymarketRef, kalshiRef, options = {}) {
    const base = options.base || DEFAULT_BASE;
    const body = {
        market_a: { venue: 'polymarket', market_id: polymarketRef.marketId, outcome: polymarketRef.outcome, side: polymarketRef.side },
        market_b: { venue: 'kalshi', market_id: kalshiRef.marketId, outcome: kalshiRef.outcome, side: kalshiRef.side }
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const res = await fetch(`${base}/v1/audit`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal
        });

        // 404 pair_not_covered, 402 over free-tier, 5xx, etc. -> pass through, never block.
        if (!res.ok) return { covered: false };

        const fsao = await res.json();
        return {
            covered: true,
            verdict: fsao.execution_verdict,                  // 'safe' | 'caution' | 'block'
            findings: (fsao.findings || []).map(f => f.code)  // e.g. ['settlement_source', 'settlement_timing']
        };
    } catch (error) {
        // Timeout (abort), DNS failure, connection refused -> fail open.
        return { covered: false };
    } finally {
        clearTimeout(timer);
    }
}
