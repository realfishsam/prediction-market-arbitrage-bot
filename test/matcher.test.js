import { matchOutcomes } from '../src/matcher.js';

describe('Similarity Matcher Logic', () => {

    test('should match exact strings', () => {
        const poly = [{ title: 'Donald Trump', marketId: 'p1' }];
        const kalshi = [{ title: 'Donald Trump', marketId: 'k1' }];

        const matches = matchOutcomes(poly, kalshi, 1.0);
        expect(matches.length).toBe(1);
        expect(matches[0].polymarket.title).toBe('Donald Trump');
        expect(matches[0].kalshi.title).toBe('Donald Trump');
    });

    test('should match case-insensitive', () => {
        const poly = [{ title: 'DONALD TRUMP', marketId: 'p1' }];
        const kalshi = [{ title: 'Donald Trump', marketId: 'k1' }];

        const matches = matchOutcomes(poly, kalshi, 0.9);
        expect(matches.length).toBe(1);
    });

    test('should fuzzy match related names (High threshold)', () => {
        const poly = [{ title: 'Robert F. Kennedy Jr.', marketId: 'p1' }];
        const kalshi = [{ title: 'Robert Kennedy', marketId: 'k1' }];

        // Threshold of 0.7 is confirming our config default
        const matches = matchOutcomes(poly, kalshi, 0.5);
        expect(matches.length).toBe(1);
        expect(matches[0].polymarket.title).toBe('Robert F. Kennedy Jr.');
        expect(matches[0].kalshi.title).toBe('Robert Kennedy');
    });

    test('should NOT match unrelated names', () => {
        const poly = [{ title: 'Donald Trump', marketId: 'p1' }];
        const kalshi = [{ title: 'Joe Biden', marketId: 'k1' }];

        const matches = matchOutcomes(poly, kalshi, 0.5); // Even with low threshold
        expect(matches.length).toBe(0);
    });

    test('should pick the BEST match when multiple candidates exist', () => {
        const poly = [{ title: 'Doug Burgum', marketId: 'p1' }];

        // Similar names scenario
        const kalshi = [
            { title: 'Doug Collins', marketId: 'k1' }, // Good match but not best
            { title: 'Doug Burgum', marketId: 'k2' }   // Perfect match
        ];

        const matches = matchOutcomes(poly, kalshi, 0.5);

        expect(matches.length).toBe(1);
        expect(matches[0].kalshi.title).toBe('Doug Burgum'); // Should match k2, not k1
    });

    test('regression: identical titles produce arbitrary pairings (the "Yes" bug)', () => {
        // This documents the bug where parseOutcomes used outcome labels ("Yes") instead
        // of market titles. When all titles are identical, the matcher pairs them in order
        // which is meaningless — Poly's Warsh could match Kalshi's Powell.
        const poly = [
            { title: 'Yes', marketId: 'p_warsh' },
            { title: 'Yes', marketId: 'p_powell' },
            { title: 'Yes', marketId: 'p_hassett' }
        ];
        const kalshi = [
            { title: 'Yes', marketId: 'k_powell' },
            { title: 'Yes', marketId: 'k_warsh' },
            { title: 'Yes', marketId: 'k_hassett' }
        ];

        const matches = matchOutcomes(poly, kalshi, 0.7);

        // All match with perfect score since titles are identical
        expect(matches.length).toBe(3);
        matches.forEach(m => expect(m.similarity).toBe(1));

        // But pairings are just in-order (greedy), NOT semantically correct
        // p_warsh matches k_powell (wrong!), p_powell matches k_warsh (wrong!)
        expect(matches[0].polymarket.marketId).toBe('p_warsh');
        expect(matches[0].kalshi.marketId).toBe('k_powell'); // Wrong pairing!
    });

    test('should handle greedy matching (one-to-one)', () => {
        const poly = [
            { title: 'Name A', marketId: 'p1' },
            { title: 'Name B', marketId: 'p2' }
        ];
        const kalshi = [
            { title: 'Name A', marketId: 'k1' },
            { title: 'Name B', marketId: 'k2' }
        ];

        const matches = matchOutcomes(poly, kalshi, 0.8);
        expect(matches.length).toBe(2);

        const matchA = matches.find(m => m.polymarket.marketId === 'p1');
        expect(matchA.kalshi.marketId).toBe('k1');

        const matchB = matches.find(m => m.polymarket.marketId === 'p2');
        expect(matchB.kalshi.marketId).toBe('k2');
    });
});
