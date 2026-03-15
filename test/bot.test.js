import { jest } from '@jest/globals';

// Mock pmxtjs before importing the bot
jest.unstable_mockModule('pmxtjs', () => ({
    default: {
        polymarket: class { },
        kalshi: class { }
    }
}));

// Mock logger to avoid file I/O in tests
jest.unstable_mockModule('../src/logger.js', () => ({
    initLogger: jest.fn(),
    logMatching: jest.fn(),
    logTrade: jest.fn(),
    logError: jest.fn(),
}));

describe('ArbitrageBot', () => {
    let ArbitrageBot;
    let bot;
    const entryAmountCents = 1000;
    const polyPrice = 40;
    const kalshiPrice = 50;

    // Contracts = Amount / Price
    const polyContracts = Math.floor(entryAmountCents / polyPrice); // 25
    const kalshiContracts = Math.floor(entryAmountCents / kalshiPrice); // 20

    beforeAll(async () => {
        const module = await import('../src/bot.js');
        ArbitrageBot = module.ArbitrageBot;
    });

    beforeEach(() => {
        bot = Object.create(ArbitrageBot.prototype);
        bot.config = {
            minProfitCents: 1,
            tradingMode: 'CONSERVATIVE',
            tradeAmountCents: entryAmountCents,
            dryRun: false
        };

        // Mock clients
        bot.polymarket = { createOrder: jest.fn().mockResolvedValue({ id: 'poly_order_1' }) };
        bot.kalshi = { createOrder: jest.fn().mockResolvedValue({ id: 'kalshi_order_1' }) };

        // Setup a standard position for PnL and Exit tests
        bot.currentPosition = {
            amount: entryAmountCents, // Legacy field, kept for reference if needed
            shares: {
                polymarket: polyContracts,
                kalshi: kalshiContracts
            },
            outcomeIds: {
                polymarket: 'poly_yes_id',
                kalshi: 'kalshi_no_id'
            },
            entryPrices: {
                polymarket: polyPrice,
                kalshi: kalshiPrice
            },
            opportunity: {
                outcome: 'Test Event',
                polymarketOutcome: { marketId: 'poly_mkt', yesId: 'poly_yes_id', noId: 'poly_no_id' },
                kalshiOutcome: { marketId: 'kalshi_mkt', yesId: 'kalshi_yes_id', noId: 'kalshi_no_id' },
                polymarketSide: 'YES',
                kalshiSide: 'NO'
            },
            entryTime: Date.now() - 10000 // Entered 10s ago
        };
    });

    describe('PnL Calculation', () => {
        test('should calculate 0 PnL when prices have not changed', () => {
            const polyOutcomes = [{ marketId: 'poly_mkt', yesPrice: 40, noPrice: 60 }];
            const kalshiOutcomes = [{ marketId: 'kalshi_mkt', yesPrice: 50, noPrice: 50 }];

            const pnl = bot.calculateCurrentPnL(polyOutcomes, kalshiOutcomes);

            // Value = (25 * 40) + (20 * 50) = 1000 + 1000 = 2000
            // Cost = (25 * 40) + (20 * 50) = 2000
            // PnL = 0
            expect(pnl).toBeCloseTo(0, 4);
        });

        test('should calculate positive PnL when prices move in favor', () => {
            // Price goes UP to 50
            const polyOutcomes = [{ marketId: 'poly_mkt', yesPrice: 50, noPrice: 50 }];

            // Price goes UP to 55 (NO side price)
            const kalshiOutcomes = [{ marketId: 'kalshi_mkt', yesPrice: 45, noPrice: 55 }];

            const pnl = bot.calculateCurrentPnL(polyOutcomes, kalshiOutcomes);

            // New Value = (25 * 50) + (20 * 55) = 1250 + 1100 = 2350
            // Cost = 2000
            // Exp PnL = 350
            expect(pnl).toBeCloseTo(350, 4);
        });

        test('should calculate negative PnL when prices move against', () => {
            // Price drops to 30
            const polyOutcomes = [{ marketId: 'poly_mkt', yesPrice: 30, noPrice: 70 }];
            // Price drops to 40
            const kalshiOutcomes = [{ marketId: 'kalshi_mkt', yesPrice: 60, noPrice: 40 }];

            const pnl = bot.calculateCurrentPnL(polyOutcomes, kalshiOutcomes);

            // New Value = (25 * 30) + (20 * 40) = 750 + 800 = 1550
            // Cost = 2000
            // Exp PnL = -450
            expect(pnl).toBeCloseTo(-450, 4);
        });
    });

    describe('Execution Logic', () => {
        test('should execute BUY orders correctly on entry', async () => {
            // Clear position to test entry
            bot.currentPosition = null;

            const opportunity = {
                outcome: 'New Opp',
                description: 'Buy YES Poly, Buy NO Kalshi',
                profit: 10,
                polymarketOutcome: { marketId: 'p_m', yesPrice: 40, noPrice: 60, yesId: 'p_yes', noId: 'p_no' },
                kalshiOutcome: { marketId: 'k_m', yesPrice: 50, noPrice: 50, yesId: 'k_yes', noId: 'k_no' },
                polymarketSide: 'YES',
                kalshiSide: 'NO'
            };

            const success = await bot.executeArbitrage(opportunity);

            expect(success).toBe(true);

            // Verify Polymarket Order
            expect(bot.polymarket.createOrder).toHaveBeenCalledWith({
                marketId: 'p_m',
                outcomeId: 'p_yes',
                side: 'buy',
                amount: 25, // 1000 / 40
                type: 'market'
            });

            // Verify Kalshi Order
            expect(bot.kalshi.createOrder).toHaveBeenCalledWith({
                marketId: 'k_m',
                outcomeId: 'k_no',
                side: 'buy',
                amount: 20, // 1000 / 50
                type: 'market'
            });

            // Verify State Update
            expect(bot.currentPosition).not.toBeNull();
            expect(bot.currentPosition.shares.polymarket).toBe(25);
            expect(bot.currentPosition.shares.kalshi).toBe(20);
        });

        test('should execute SELL orders correctly on exit', async () => {
            // currentPosition is already set in beforeEach
            await bot.exitPosition();

            // Verify Polymarket Order
            expect(bot.polymarket.createOrder).toHaveBeenCalledWith({
                marketId: 'poly_mkt',
                outcomeId: 'poly_yes_id', // Matches position.outcomeIds.polymarket
                side: 'sell',
                amount: polyContracts, // Matches position.shares.polymarket
                type: 'market'
            });

            // Verify Kalshi Order
            expect(bot.kalshi.createOrder).toHaveBeenCalledWith({
                marketId: 'kalshi_mkt',
                outcomeId: 'kalshi_no_id', // Matches position.outcomeIds.kalshi
                side: 'sell',
                amount: kalshiContracts, // Matches position.shares.kalshi
                type: 'market'
            });

            // Verify Position Cleared
            expect(bot.currentPosition).toBeNull();
        });
    });

    describe('parseOutcomes', () => {
        test('should use market.title for matching, not outcome label', () => {
            const markets = [
                {
                    id: 'warsh_mkt', title: 'Kevin Warsh', volume: 50000,
                    outcomes: [
                        { label: 'Yes', price: 0.41, id: 'w_y', side: 'yes' },
                        { label: 'No', price: 0.59, id: 'w_n', side: 'no' }
                    ]
                },
                {
                    id: 'powell_mkt', title: 'Jerome Powell', volume: 30000,
                    outcomes: [
                        { label: 'Yes', price: 0.25, id: 'p_y', side: 'yes' },
                        { label: 'No', price: 0.75, id: 'p_n', side: 'no' }
                    ]
                }
            ];

            const parsed = bot.parseOutcomes(markets, 'polymarket');

            expect(parsed[0].title).toBe('Kevin Warsh');
            expect(parsed[1].title).toBe('Jerome Powell');
            // Must NOT be 'Yes'
            expect(parsed[0].title).not.toBe('Yes');
            expect(parsed[1].title).not.toBe('Yes');
        });

        test('should fall back to market.question if title is missing', () => {
            const markets = [{
                id: 'q_mkt', question: 'Will Bitcoin exceed $100k?', volume: 1000,
                outcomes: [
                    { label: 'Yes', price: 0.60, id: 'q_y', side: 'yes' },
                    { label: 'No', price: 0.40, id: 'q_n', side: 'no' }
                ]
            }];

            const parsed = bot.parseOutcomes(markets, 'polymarket');
            expect(parsed[0].title).toBe('Will Bitcoin exceed $100k?');
        });

        test('should fall back to outcome label when no market-level title exists', () => {
            const markets = [{
                id: 'bare_mkt', volume: 500,
                outcomes: [
                    { label: 'Yes', price: 0.50, id: 'b_y', side: 'yes' },
                    { label: 'No', price: 0.50, id: 'b_n', side: 'no' }
                ]
            }];

            const parsed = bot.parseOutcomes(markets, 'polymarket');
            // Falls back to outcome label as last resort
            expect(parsed[0].title).toBe('Yes');
        });

        test('should correctly parse prices and IDs alongside title', () => {
            const markets = [{
                id: 'mkt1', title: 'Kevin Hassett', volume: 10000,
                outcomes: [
                    { label: 'Yes', price: 0.10, id: 'h_y', side: 'yes' },
                    { label: 'No', price: 0.90, id: 'h_n', side: 'no' }
                ]
            }];

            const parsed = bot.parseOutcomes(markets, 'kalshi');
            expect(parsed[0]).toEqual({
                title: 'Kevin Hassett',
                marketId: 'mkt1',
                yesId: 'h_y',
                noId: 'h_n',
                yesPrice: 10,
                noPrice: 90,
                platform: 'kalshi',
                volume: 10000,
            });
        });

        test('end-to-end: parseOutcomes + matchOutcomes pairs candidates correctly across platforms', async () => {
            const { matchOutcomes } = await import('../src/matcher.js');

            const polyMarkets = [
                { id: 'p_warsh', title: 'Kevin Warsh', volume: 50000, outcomes: [{ label: 'Yes', price: 0.41, id: 'pw_y', side: 'yes' }, { label: 'No', price: 0.59, id: 'pw_n', side: 'no' }] },
                { id: 'p_powell', title: 'Jerome Powell', volume: 30000, outcomes: [{ label: 'Yes', price: 0.25, id: 'pp_y', side: 'yes' }, { label: 'No', price: 0.75, id: 'pp_n', side: 'no' }] },
                { id: 'p_hassett', title: 'Kevin Hassett', volume: 10000, outcomes: [{ label: 'Yes', price: 0.10, id: 'ph_y', side: 'yes' }, { label: 'No', price: 0.90, id: 'ph_n', side: 'no' }] },
            ];

            const kalshiMarkets = [
                { id: 'k_powell', title: 'Jerome H. Powell', volume: 28000, outcomes: [{ label: 'Yes', price: 0.27, id: 'kp_y', side: 'yes' }, { label: 'No', price: 0.73, id: 'kp_n', side: 'no' }] },
                { id: 'k_warsh', title: 'Kevin W. Warsh', volume: 45000, outcomes: [{ label: 'Yes', price: 0.39, id: 'kw_y', side: 'yes' }, { label: 'No', price: 0.61, id: 'kw_n', side: 'no' }] },
                { id: 'k_hassett', title: 'Kevin Hassett', volume: 12000, outcomes: [{ label: 'Yes', price: 0.12, id: 'kh_y', side: 'yes' }, { label: 'No', price: 0.88, id: 'kh_n', side: 'no' }] },
            ];

            const polyParsed = bot.parseOutcomes(polyMarkets, 'polymarket');
            const kalshiParsed = bot.parseOutcomes(kalshiMarkets, 'kalshi');

            const matches = matchOutcomes(polyParsed, kalshiParsed, 0.5);

            // Should match all 3
            expect(matches.length).toBe(3);

            // Verify correct pairings
            const warshMatch = matches.find(m => m.polymarket.marketId === 'p_warsh');
            expect(warshMatch.kalshi.marketId).toBe('k_warsh');

            const powellMatch = matches.find(m => m.polymarket.marketId === 'p_powell');
            expect(powellMatch.kalshi.marketId).toBe('k_powell');

            const hassettMatch = matches.find(m => m.polymarket.marketId === 'p_hassett');
            expect(hassettMatch.kalshi.marketId).toBe('k_hassett');
        });

        test('should handle asymmetric candidate lists (more on one platform)', async () => {
            const { matchOutcomes } = await import('../src/matcher.js');

            const polyMarkets = [
                { id: 'p_warsh', title: 'Kevin Warsh', volume: 50000, outcomes: [{ label: 'Yes', price: 0.41, id: 'pw_y', side: 'yes' }, { label: 'No', price: 0.59, id: 'pw_n', side: 'no' }] },
                { id: 'p_powell', title: 'Jerome Powell', volume: 30000, outcomes: [{ label: 'Yes', price: 0.25, id: 'pp_y', side: 'yes' }, { label: 'No', price: 0.75, id: 'pp_n', side: 'no' }] },
                { id: 'p_hassett', title: 'Kevin Hassett', volume: 10000, outcomes: [{ label: 'Yes', price: 0.10, id: 'ph_y', side: 'yes' }, { label: 'No', price: 0.90, id: 'ph_n', side: 'no' }] },
                { id: 'p_yellen', title: 'Janet Yellen', volume: 5000, outcomes: [{ label: 'Yes', price: 0.05, id: 'py_y', side: 'yes' }, { label: 'No', price: 0.95, id: 'py_n', side: 'no' }] },
                { id: 'p_brainard', title: 'Lael Brainard', volume: 3000, outcomes: [{ label: 'Yes', price: 0.02, id: 'pb_y', side: 'yes' }, { label: 'No', price: 0.98, id: 'pb_n', side: 'no' }] },
            ];

            const kalshiMarkets = [
                { id: 'k_warsh', title: 'Kevin Warsh', volume: 45000, outcomes: [{ label: 'Yes', price: 0.39, id: 'kw_y', side: 'yes' }, { label: 'No', price: 0.61, id: 'kw_n', side: 'no' }] },
                { id: 'k_hassett', title: 'Kevin Hassett', volume: 12000, outcomes: [{ label: 'Yes', price: 0.12, id: 'kh_y', side: 'yes' }, { label: 'No', price: 0.88, id: 'kh_n', side: 'no' }] },
                { id: 'k_powell', title: 'Jerome Powell', volume: 28000, outcomes: [{ label: 'Yes', price: 0.27, id: 'kp_y', side: 'yes' }, { label: 'No', price: 0.73, id: 'kp_n', side: 'no' }] },
            ];

            const polyParsed = bot.parseOutcomes(polyMarkets, 'polymarket');
            const kalshiParsed = bot.parseOutcomes(kalshiMarkets, 'kalshi');

            const matches = matchOutcomes(polyParsed, kalshiParsed, 0.7);

            // Only 3 should match (the overlapping candidates)
            expect(matches.length).toBe(3);

            // Yellen and Brainard should NOT appear in matches
            const matchedPolyIds = matches.map(m => m.polymarket.marketId);
            expect(matchedPolyIds).not.toContain('p_yellen');
            expect(matchedPolyIds).not.toContain('p_brainard');
        });
    });
});
