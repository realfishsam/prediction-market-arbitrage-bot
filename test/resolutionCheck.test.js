import { jest } from '@jest/globals';
import { checkResolution } from '../src/resolutionCheck.js';

// The whole point of the guard is that it is fail-open: it must never block the bot
// on an uncovered pair, a metered (402) pair, or Crosswire being unreachable.

const polyRef = { marketId: '0xpoly', outcome: 'Argentina', side: 'yes' };
const kalshiRef = { marketId: 'KXWCGAME-ARG', outcome: 'Argentina', side: 'no' };

function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('checkResolution', () => {
    afterEach(() => {
        delete global.fetch;
    });

    test('covered pair returns the verdict and finding codes', async () => {
        global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, {
            execution_verdict: 'block',
            findings: [{ code: 'settlement_source' }, { code: 'settlement_timing' }]
        }));

        const result = await checkResolution(polyRef, kalshiRef);

        expect(result).toEqual({
            covered: true,
            verdict: 'block',
            findings: ['settlement_source', 'settlement_timing']
        });
    });

    test('safe verdict with no findings maps to an empty array', async () => {
        global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, { execution_verdict: 'safe' }));

        const result = await checkResolution(polyRef, kalshiRef);

        expect(result).toEqual({ covered: true, verdict: 'safe', findings: [] });
    });

    test('404 pair_not_covered fails open (covered: false)', async () => {
        global.fetch = jest.fn().mockResolvedValue(jsonResponse(404, { detail: 'pair_not_covered' }));

        const result = await checkResolution(polyRef, kalshiRef);

        expect(result).toEqual({ covered: false });
    });

    test('402 on a metered pair fails open (no key, free tier)', async () => {
        global.fetch = jest.fn().mockResolvedValue(jsonResponse(402, { error: 'payment_required' }));

        const result = await checkResolution(polyRef, kalshiRef);

        expect(result).toEqual({ covered: false });
    });

    test('network error / timeout fails open', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('aborted'));

        const result = await checkResolution(polyRef, kalshiRef);

        expect(result).toEqual({ covered: false });
    });

    test('posts the two legs to /v1/audit on the configured base', async () => {
        global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, { execution_verdict: 'safe' }));

        await checkResolution(polyRef, kalshiRef, { base: 'https://example.test' });

        const [url, init] = global.fetch.mock.calls[0];
        expect(url).toBe('https://example.test/v1/audit');
        expect(init.method).toBe('POST');
        const body = JSON.parse(init.body);
        expect(body.market_a).toEqual({ venue: 'polymarket', market_id: '0xpoly', outcome: 'Argentina', side: 'yes' });
        expect(body.market_b).toEqual({ venue: 'kalshi', market_id: 'KXWCGAME-ARG', outcome: 'Argentina', side: 'no' });
    });
});
