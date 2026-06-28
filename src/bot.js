import pmxt from 'pmxtjs';
import { matchOutcomes } from './matcher.js';
import { findArbitrageOpportunities, getBestOpportunity } from './arbitrage.js';
import { checkResolution } from './resolutionCheck.js';

export class ArbitrageBot {
    constructor(config) {
        this.config = config;
        this.polymarket = new pmxt.polymarket({ privateKey: config.polymarketPrivateKey });
        this.kalshi = new pmxt.kalshi({ apiKey: config.kalshiApiKey, apiSecret: config.kalshiApiSecret });
        this.currentPosition = null;
    }

    extractMarketId(url, platform) {
        if (platform === 'polymarket') {
            const match = url.match(/event\/([^/?]+)/);
            return match ? match[1] : null;
        } else {
            // Kalshi: extract the last segment for the specific event ticker
            const parts = url.split('/');
            return parts[parts.length - 1].toUpperCase();
        }
    }

    async fetchMarkets() {
        const polymarketId = this.extractMarketId(this.config.polymarketUrl, 'polymarket');
        const kalshiId = this.extractMarketId(this.config.kalshiUrl, 'kalshi');

        const [polymarketMarkets, kalshiMarkets] = await Promise.all([
            this.polymarket.getMarketsBySlug(polymarketId),
            this.kalshi.getMarketsBySlug(kalshiId)
        ]);

        return { polymarketMarkets, kalshiMarkets };
    }

    parseOutcomes(markets, platform) {
        return markets
            .filter(m => m.outcomes && m.outcomes.length >= 2)
            .map(market => {
                // Find YES and NO outcomes by label, don't assume array order
                const yesOutcome = market.outcomes.find(o => o.label.toLowerCase().includes('yes') || o.side === 'yes');
                const noOutcome = market.outcomes.find(o => o.label.toLowerCase().includes('no') || o.side === 'no');

                // Fallback: if not found by label, use the first/second outcome
                const title = yesOutcome ? yesOutcome.label : market.outcomes[0].label;
                const yesId = yesOutcome ? yesOutcome.id : market.outcomes[0].id;
                const noId = noOutcome ? noOutcome.id : market.outcomes[1].id;

                // For binary markets, if we can't find explicit YES/NO, assume outcomes are complementary
                // Use 2 decimal precision for cents (e.g. 44.50) to capture sub-cent arb
                const yesPrice = yesOutcome
                    ? Number((yesOutcome.price * 100).toFixed(2))
                    : Number((market.outcomes[0].price * 100).toFixed(2));

                const noPrice = noOutcome
                    ? Number((noOutcome.price * 100).toFixed(2))
                    : Number((market.outcomes[1].price * 100).toFixed(2));

                return {
                    title,
                    marketId: market.id,
                    yesId,
                    noId,
                    yesPrice,
                    noPrice,
                    platform,
                    volume: market.volume || 0,
                };
            });
    }

    async executeTrade(platform, marketId, outcomeId, side, contracts) {
        if (this.config.dryRun) {
            console.log(`   [DRY RUN] ${platform} ${side.toUpperCase()} ${contracts} contracts on ${marketId} (Outcome: ${outcomeId})`);
            return { success: true, orderId: 'dry-run-' + Date.now() };
        }

        const client = platform === 'polymarket' ? this.polymarket : this.kalshi;
        try {
            const order = await client.createOrder({
                marketId,
                outcomeId,
                side: side.toLowerCase(), // 'buy' or 'sell'
                amount: contracts,
                type: 'market'
            });
            return { success: true, orderId: order.id };
        } catch (error) {
            console.error(`   [ERROR] ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async executeArbitrage(opportunity) {
        console.log(`\n[EXECUTE] ${opportunity.outcome}: ${opportunity.description} | Profit: ${opportunity.profit.toFixed(2)}¢`);

        const tradeAmountCents = this.config.tradingMode === 'YOLO' ? 1000 : this.config.tradeAmountCents;

        // Calculate contract amount based on price (contracts = tradeAmountCents / priceInCents)
        const polyPrice = opportunity.polymarketSide === 'YES' ? opportunity.polymarketOutcome.yesPrice : opportunity.polymarketOutcome.noPrice;
        const kalshiPrice = opportunity.kalshiSide === 'YES' ? opportunity.kalshiOutcome.yesPrice : opportunity.kalshiOutcome.noPrice;

        const polyContracts = Math.floor(tradeAmountCents / (polyPrice || 1));
        const kalshiContracts = Math.floor(tradeAmountCents / (kalshiPrice || 1));

        const polyOutcomeId = opportunity.polymarketSide === 'YES' ? opportunity.polymarketOutcome.yesId : opportunity.polymarketOutcome.noId;
        const kalshiOutcomeId = opportunity.kalshiSide === 'YES' ? opportunity.kalshiOutcome.yesId : opportunity.kalshiOutcome.noId;

        // Optional pre-trade resolution gate (off by default, fail-open, advisory only).
        // Confirms the two legs actually settle the same way before placing orders. An
        // uncovered pair or any error passes through; only a BLOCK verdict in 'block' mode skips.
        if (this.config.resolutionCheck) {
            const resolution = await checkResolution(
                { marketId: opportunity.polymarketOutcome.marketId, outcome: opportunity.outcome, side: opportunity.polymarketSide.toLowerCase() },
                { marketId: opportunity.kalshiOutcome.marketId, outcome: opportunity.outcome, side: opportunity.kalshiSide.toLowerCase() },
                { base: this.config.crosswireBase }
            );

            if (!resolution.covered) {
                console.log('   [RESOLUTION] not covered, proceeding');
            } else if (resolution.verdict === 'block') {
                const codes = resolution.findings.join(', ');
                if (this.config.resolutionCheckMode === 'block') {
                    console.log(`   [RESOLUTION] BLOCK: ${codes} - legs may not settle the same way, skipping`);
                    return false;
                }
                console.log(`   [RESOLUTION] BLOCK: ${codes} - legs may not settle the same way (warn mode, proceeding)`);
            } else if (resolution.verdict === 'caution') {
                console.log(`   [RESOLUTION] CAUTION: ${resolution.findings.join(', ')} - residual settlement risk, proceeding`);
            } else {
                console.log('   [RESOLUTION] SAFE');
            }
        }

        const [polyTrade, kalshiTrade] = await Promise.all([
            this.executeTrade('polymarket', opportunity.polymarketOutcome.marketId, polyOutcomeId, 'buy', polyContracts),
            this.executeTrade('kalshi', opportunity.kalshiOutcome.marketId, kalshiOutcomeId, 'buy', kalshiContracts)
        ]);


        if (polyTrade.success && kalshiTrade.success) {
            // Track the position with entry details and shares
            this.currentPosition = {
                opportunity,
                polymarketOrderId: polyTrade.orderId,
                kalshiOrderId: kalshiTrade.orderId,
                shares: {
                    polymarket: polyContracts,
                    kalshi: kalshiContracts
                },
                outcomeIds: {
                    polymarket: polyOutcomeId,
                    kalshi: kalshiOutcomeId
                },
                entryPrices: {
                    polymarket: polyPrice,
                    kalshi: kalshiPrice
                },
                entryTime: Date.now()
            };

            return true;
        }
        console.log('[ERROR] Trade execution failed\n');
        return false;
    }

    calculateCurrentPnL(polymarketOutcomes, kalshiOutcomes) {
        if (!this.currentPosition) return 0;

        // Find current prices for the position
        const polyNow = polymarketOutcomes.find(o => o.marketId === this.currentPosition.opportunity.polymarketOutcome.marketId);
        const kalshiNow = kalshiOutcomes.find(o => o.marketId === this.currentPosition.opportunity.kalshiOutcome.marketId);

        if (!polyNow || !kalshiNow) return 0;

        // Identify which price we need (YES or NO)
        const polySide = this.currentPosition.opportunity.polymarketSide;
        const kalshiSide = this.currentPosition.opportunity.kalshiSide;

        const polyCurrentPrice = polySide === 'YES' ? polyNow.yesPrice : polyNow.noPrice;
        const kalshiCurrentPrice = kalshiSide === 'YES' ? kalshiNow.yesPrice : kalshiNow.noPrice;

        // Value = Shares * Current Price
        const polyValue = this.currentPosition.shares.polymarket * polyCurrentPrice;
        const kalshiValue = this.currentPosition.shares.kalshi * kalshiCurrentPrice;

        // Cost = Shares * Entry Price
        const polyCost = this.currentPosition.shares.polymarket * this.currentPosition.entryPrices.polymarket;
        const kalshiCost = this.currentPosition.shares.kalshi * this.currentPosition.entryPrices.kalshi;

        return (polyValue + kalshiValue) - (polyCost + kalshiCost);
    }

    shouldExitPosition(opportunities) {
        if (!this.currentPosition) return false;

        // Exit if current opportunity is gone or unprofitable
        const currentOpp = opportunities.find(opp => opp.outcome === this.currentPosition.opportunity.outcome);
        if (!currentOpp || currentOpp.profit < this.config.minProfitCents) return true;

        // Exit if a BETTER opportunity exists (Rotation)
        const bestOpp = getBestOpportunity(opportunities);
        if (bestOpp && bestOpp.profit > currentOpp.profit) {
            console.log(`[ROTATION] Found better opportunity: ${bestOpp.outcome} (${bestOpp.profit.toFixed(2)}¢) > ${currentOpp.outcome} (${currentOpp.profit.toFixed(2)}¢)`);
            return true;
        }

        return false;
    }

    async exitPosition() {
        if (!this.currentPosition) return;
        const heldTime = Math.round((Date.now() - this.currentPosition.entryTime) / 1000);
        console.log(`\n[EXITING] ${this.currentPosition.opportunity.outcome} (held ${heldTime}s) - Executing SELL orders...`);

        const { outcomeIds, shares, opportunity } = this.currentPosition;

        const [polyExit, kalshiExit] = await Promise.all([
            this.executeTrade('polymarket', opportunity.polymarketOutcome.marketId, outcomeIds.polymarket, 'sell', shares.polymarket),
            this.executeTrade('kalshi', opportunity.kalshiOutcome.marketId, outcomeIds.kalshi, 'sell', shares.kalshi)
        ]);

        if (polyExit.success && kalshiExit.success) {
            console.log(`[SOLD] Position closed successfully.\n`);
            this.currentPosition = null;
        } else {
            console.log(`[ERROR] Failed to close position fully. Check logs.\n`);
            // Force clear for now, but in production we'd need manual intervention
            this.currentPosition = null;
        }
    }

    async poll() {
        try {
            const { polymarketMarkets, kalshiMarkets } = await this.fetchMarkets();
            const polymarketOutcomes = this.parseOutcomes(polymarketMarkets, 'polymarket');
            const kalshiOutcomes = this.parseOutcomes(kalshiMarkets, 'kalshi');
            const matches = matchOutcomes(polymarketOutcomes, kalshiOutcomes, this.config.matchingThreshold);
            const allOpportunities = findArbitrageOpportunities(matches, this.config.minProfitCents)
                .filter(opp => {
                    // Skip markets where either side has a price at or below the threshold
                    const polyYes = opp.polymarketOutcome.yesPrice;
                    const polyNo = opp.polymarketOutcome.noPrice;
                    const kalshiYes = opp.kalshiOutcome.yesPrice;
                    const kalshiNo = opp.kalshiOutcome.noPrice;

                    return polyYes > this.config.minPriceThreshold &&
                        polyNo > this.config.minPriceThreshold &&
                        kalshiYes > this.config.minPriceThreshold &&
                        kalshiNo > this.config.minPriceThreshold;
                })
                .map(opp => ({
                    ...opp,
                    totalVolume: (opp.polymarketOutcome.volume || 0) + (opp.kalshiOutcome.volume || 0)
                }))
                .sort((a, b) => b.totalVolume - a.totalVolume); // First rank by volume

            // Then take top N and re-sort by profit
            const topOpportunities = allOpportunities
                .slice(0, this.config.topNOpportunities)
                .sort((a, b) => b.profit - a.profit);

            // Calculate current unrealized PnL
            const currentPnL = this.calculateCurrentPnL(polymarketOutcomes, kalshiOutcomes);
            console.log(`[CURRENT PnL: ${currentPnL.toFixed(2)}¢]`);

            if (topOpportunities.length > 0) {
                console.log(`[TOP ${topOpportunities.length} OPPORTUNITIES BY PROFIT (FROM TOP VOLUME MARKETS)]`);
                topOpportunities.forEach((opp, i) => {
                    console.log(`  ${i + 1}. ${opp.outcome}: ${opp.description} | Profit: ${opp.profit.toFixed(2)}¢ | Vol: $${(opp.totalVolume || 0).toLocaleString()}`);
                });
                console.log('');
            }

            if (this.shouldExitPosition(topOpportunities)) await this.exitPosition();
            if (!this.currentPosition && topOpportunities.length > 0) {
                await this.executeArbitrage(getBestOpportunity(topOpportunities));
            }
        } catch (error) {
            console.error('[ERROR]', error.message);
            console.error(error.stack);
        }
    }

    async start() {
        console.log(`[BOT STARTED] Polling every ${this.config.pollIntervalSeconds}s | Min profit: ${this.config.minProfitCents}¢ | Mode: ${this.config.tradingMode} | Dry run: ${this.config.dryRun ? 'YES' : 'NO'}\n`);
        await this.poll();
        this.pollInterval = setInterval(async () => {
            console.log(`[${new Date().toLocaleTimeString()}]`);
            await this.poll();
        }, this.config.pollIntervalSeconds * 1000);
    }

    stop() {
        if (this.pollInterval) clearInterval(this.pollInterval);
        console.log('\n[BOT STOPPED]');
    }
}
