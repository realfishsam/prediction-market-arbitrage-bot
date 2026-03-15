import { appendFileSync, mkdirSync, existsSync } from 'fs';
import https from 'https';
import http from 'http';
import { URL } from 'url';

let logDir = 'logs';
let slackWebhookUrl = null;

export function initLogger(config) {
    logDir = config.logDir || 'logs';
    slackWebhookUrl = config.slackWebhookUrl || null;
    if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
    }
}

function writeLog(file, data) {
    const entry = { timestamp: new Date().toISOString(), ...data };
    try {
        appendFileSync(`${logDir}/${file}`, JSON.stringify(entry) + '\n');
    } catch (err) {
        console.error(`[LOG ERROR] Failed to write to ${file}: ${err.message}`);
    }
}

export function logMatching({ polymarketCount, kalshiCount, matches, unmatchedPoly, unmatchedKalshi }) {
    writeLog('matching.log', {
        polymarketOutcomes: polymarketCount,
        kalshiOutcomes: kalshiCount,
        matchedPairs: matches.map(m => ({
            polymarket: m.polymarket.title,
            kalshi: m.kalshi.title,
            similarity: Number(m.similarity.toFixed(3)),
        })),
        unmatchedPolymarket: unmatchedPoly.map(o => o.title),
        unmatchedKalshi: unmatchedKalshi.map(o => o.title),
    });
}

export function logTrade({ event, outcome, strategy, polymarketSide, kalshiSide, polyPrice, kalshiPrice, polyContracts, kalshiContracts, profit, orderId, error }) {
    const data = { event, outcome, strategy, polymarketSide, kalshiSide, polyPrice, kalshiPrice, polyContracts, kalshiContracts, profit };
    if (orderId) data.orderId = orderId;
    if (error) data.error = error;
    writeLog('trades.log', data);

    if (slackWebhookUrl) {
        const emoji = event === 'ENTRY' ? ':chart_with_upwards_trend:' : event === 'EXIT' ? ':door:' : ':warning:';
        const text = `${emoji} *${event}* | ${outcome}\nStrategy: ${strategy} | Poly ${polymarketSide} @ ${polyPrice}¢ (${polyContracts} contracts) | Kalshi ${kalshiSide} @ ${kalshiPrice}¢ (${kalshiContracts} contracts) | Profit: ${profit?.toFixed(2)}¢${error ? `\nError: ${error}` : ''}`;
        sendSlack(text);
    }
}

export function logError(message, stack) {
    writeLog('trades.log', { event: 'ERROR', message, stack });
    if (slackWebhookUrl) {
        sendSlack(`:rotating_light: *ERROR* | ${message}`);
    }
}

function sendSlack(text) {
    if (!slackWebhookUrl) return;
    const payload = JSON.stringify({ text });
    try {
        const parsed = new URL(slackWebhookUrl);
        const transport = parsed.protocol === 'https:' ? https : http;
        const req = transport.request(parsed, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } });
        req.on('error', (err) => console.error(`[SLACK ERROR] ${err.message}`));
        req.write(payload);
        req.end();
    } catch (err) {
        console.error(`[SLACK ERROR] ${err.message}`);
    }
}
