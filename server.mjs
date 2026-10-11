import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_BODY_BYTES = 3 * Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 24_000;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const MAX_PROVIDER_BYTES = 30 * 1024 * 1024;
const ASPECTS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4']);
const ROLES = {
    subject: 'Subject reference: use the main person, object, or character as inspiration for the subject.',
    scene: 'Scene reference: use the environment, layout, and lighting as inspiration for the setting.',
    style: 'Style reference: use the visual treatment, colors, and artistic medium as inspiration, not its subject.'
};
const STATIC_FILES = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/studio.css', ['studio.css', 'text/css; charset=utf-8']],
    ['/studio.js', ['studio.js', 'text/javascript; charset=utf-8']],
    ['/html-studio.js', ['html-studio.js', 'text/javascript; charset=utf-8']],
    ['/assets/NotoSansBengali.ttf', ['assets/NotoSansBengali.ttf', 'font/ttf']]
]);

class PublicError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
const fail = (status, code, message) => { throw new PublicError(status, code, message); };

function sendJSON(res, status, body) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
}

function readJSON(req) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
        fail(415, 'CONTENT_TYPE', 'অনুরোধটি JSON ফরম্যাটে পাঠাতে হবে।');
    }
    if (Number(req.headers['content-length']) > MAX_BODY_BYTES) {
        req.resume();
        fail(413, 'BODY_TOO_LARGE', 'ছবিগুলোর মোট সাইজ অনেক বড়। ছোট ছবি দিয়ে চেষ্টা করুন।');
    }
    return new Promise((resolveBody, reject) => {
        let size = 0;
        let chunks = [];
        let exceeded = false;
        req.on('data', chunk => {
            if (exceeded) return;
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                exceeded = true;
                chunks = [];
                reject(new PublicError(413, 'BODY_TOO_LARGE', 'ছবিগুলোর মোট সাইজ অনেক বড়। ছোট ছবি দিয়ে চেষ্টা করুন।'));
            } else chunks.push(chunk);
        });
        req.on('end', () => {
            if (exceeded) return;
            try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch { reject(new PublicError(400, 'INVALID_JSON', 'অনুরোধটি পড়া যায়নি। আবার চেষ্টা করুন।')); }
        });
        req.on('error', reject);
        req.on('aborted', () => reject(new PublicError(400, 'ABORTED', 'অনুরোধ বন্ধ হয়েছে।')));
    });
}

// Check canonical base64 and file signatures, not just the client-supplied MIME type.
function validImage(mimeType, data, maxBytes) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType) || typeof data !== 'string' ||
        !data.length || data.length > Math.ceil(maxBytes / 3) * 4) return false;
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > maxBytes || bytes.toString('base64') !== data) return false;
    if (mimeType === 'image/png') return bytes.length >= 33 &&
        bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0;
    if (mimeType === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    return bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
}

function validateInput(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.prompt !== 'string' ||
        body.prompt.length > 2000 || !ASPECTS.has(body.aspectRatio) || !Array.isArray(body.references) || body.references.length > 3) {
        fail(400, 'INVALID_INPUT', 'প্রম্পট (সর্বোচ্চ ২০০০ অক্ষর), ছবির অনুপাত ও সর্বোচ্চ তিনটি রেফারেন্স ঠিক করে দিন।');
    }
    const seen = new Set();
    const references = body.references.map(ref => {
        if (!ref || !Object.hasOwn(ROLES, ref.role) || seen.has(ref.role) || !validImage(ref.mimeType, ref.data, MAX_IMAGE_BYTES)) {
            fail(400, 'INVALID_IMAGE', 'প্রতি ঘরে একটি আসল JPG, PNG বা WEBP ছবি দিন, প্রতিটি সর্বোচ্চ ৫ MB।');
        }
        seen.add(ref.role);
        return { role: ref.role, mimeType: ref.mimeType, data: ref.data };
    });
    const prompt = body.prompt.trim();
    if (!prompt && !references.length) fail(400, 'EMPTY_INPUT', 'অন্তত একটি রেফারেন্স ছবি অথবা প্রম্পট দিন।');
    return { prompt, aspectRatio: body.aspectRatio, references };
}

export function buildGeminiRequest({ prompt, aspectRatio, references }) {
    const parts = [{ text: 'Generate one new image. Combine the supplied references according to their labeled roles. Use them as creative guidance; do not promise exact likeness. If a role is absent, infer it from the user instructions. Follow the user instructions below.' }];
    for (const reference of references) {
        parts.push({ text: ROLES[reference.role] });
        parts.push({ inlineData: { mimeType: reference.mimeType, data: reference.data } });
    }
    parts.push({ text: `User instructions: ${prompt || 'Combine these references into a cohesive new image.'}` });
    return {
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio } }
    };
}

async function readProviderJSON(response) {
    if (Number(response.headers.get('content-length')) > MAX_PROVIDER_BYTES) {
        await response.body?.cancel();
        fail(502, 'PROVIDER_RESPONSE', 'ইমেজ সার্ভার থেকে অস্বাভাবিক বড় উত্তর এসেছে। আবার চেষ্টা করুন।');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body || []) {
        size += chunk.length;
        if (size > MAX_PROVIDER_BYTES) fail(502, 'PROVIDER_RESPONSE', 'ইমেজ সার্ভারের উত্তর অনেক বড়। আবার চেষ্টা করুন।');
        chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { fail(502, 'PROVIDER_RESPONSE', 'ইমেজ সার্ভারের উত্তর পড়া যায়নি। আবার চেষ্টা করুন।'); }
}

function extractImage(result) {
    if (result?.promptFeedback?.blockReason || result?.candidates?.some(candidate =>
        ['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST'].includes(candidate.finishReason))) {
        fail(422, 'SAFETY_BLOCK', 'ইমেজ সেবার নিরাপত্তা নীতির কারণে ছবি তৈরি হয়নি। ছবি বা প্রম্পট বদলে চেষ্টা করুন।');
    }
    const parts = result?.candidates?.flatMap(candidate => candidate.content?.parts || []) || [];
    // Some image models include internal/thought images. Only return the final, non-thought image.
    const image = parts.find(part => !part.thought && part.inlineData)?.inlineData;
    if (!image) fail(422, 'NO_IMAGE', 'মডেল কোনো ছবি ফেরত দেয়নি। প্রম্পট বা রেফারেন্স বদলে আবার চেষ্টা করুন।');
    if (!validImage(image.mimeType, image.data, MAX_OUTPUT_BYTES)) {
        fail(502, 'INVALID_OUTPUT', 'সার্ভার থেকে বৈধ ছবি পাওয়া যায়নি। আবার চেষ্টা করুন।');
    }
    return { mimeType: image.mimeType, data: image.data };
}

function sameOrigin(req) {
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    if (!req.headers.origin) return true; // CLI clients still need the separate access token.
    try { return new URL(req.headers.origin).host === req.headers.host; }
    catch { return false; }
}

export function createStudioServer({
    apiKey = process.env.GEMINI_API_KEY || '',
    accessToken = process.env.STUDIO_ACCESS_TOKEN || '',
    model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image',
    fetchImpl = globalThis.fetch,
    timeoutMs = 120_000,
    generationLimit = 10,
    rateWindowMs = 10 * 60_000
} = {}) {
    apiKey = apiKey.trim();
    accessToken = accessToken.trim();
    model = model.trim();
    const modelValid = /^gemini-[a-z0-9.-]{1,100}$/.test(model);
    const configured = Boolean(apiKey && accessToken.length >= 16 && modelValid);
    const tokenHash = createHash('sha256').update(accessToken).digest();
    let busy = false;
    let generationTimes = [];
    let authFailures = [];

    const server = createServer(async (req, res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        const path = (req.url || '/').split('?')[0];
        try {
            if (path === '/api/status') {
                if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); fail(405, 'METHOD', 'GET ব্যবহার করুন।'); }
                sendJSON(res, 200, {
                    configured, provider: 'Google Gemini', model: modelValid ? model : '',
                    accessRequired: true, maxImageBytes: MAX_IMAGE_BYTES
                });
                return;
            }
            if (path === '/api/remix') {
                if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); fail(405, 'METHOD', 'POST ব্যবহার করুন।'); }
                if (!sameOrigin(req)) fail(403, 'ORIGIN', 'এই অ্যাপের ভেতর থেকে অনুরোধ পাঠান।');
                if (!configured) fail(503, 'NOT_CONFIGURED', 'সার্ভারে Gemini API key, image model ও কমপক্ষে ১৬ অক্ষরের Studio access code সেটআপ করতে হবে।');
                const now = Date.now();
                authFailures = authFailures.filter(time => now - time < 60_000);
                if (authFailures.length >= 20) {
                    res.setHeader('Retry-After', '60');
                    fail(429, 'AUTH_RATE_LIMIT', 'বারবার ভুল access code দেওয়া হয়েছে। এক মিনিট পরে চেষ্টা করুন।');
                }
                const submittedToken = typeof req.headers['x-studio-token'] === 'string' ? req.headers['x-studio-token'] : '';
                if (!timingSafeEqual(tokenHash, createHash('sha256').update(submittedToken).digest())) {
                    authFailures.push(now);
                    fail(401, 'ACCESS_DENIED', 'Studio access code সঠিক নয়। এটি Gemini API key নয়; সার্ভারের আলাদা access code দিন।');
                }
                if (busy) fail(429, 'BUSY', 'একটি ছবি তৈরি হচ্ছে। সেটি শেষ হলে আবার চেষ্টা করুন।');
                const input = validateInput(await readJSON(req));
                // Re-check after reading the body: concurrent requests must not both start a paid call.
                if (busy) fail(429, 'BUSY', 'একটি ছবি তৈরি হচ্ছে। সেটি শেষ হলে আবার চেষ্টা করুন।');
                generationTimes = generationTimes.filter(time => Date.now() - time < rateWindowMs);
                if (generationTimes.length >= generationLimit) {
                    res.setHeader('Retry-After', String(Math.ceil(rateWindowMs / 1000)));
                    fail(429, 'RATE_LIMIT', 'এই স্টুডিওতে আপাতত অনুরোধের সীমা শেষ। কিছুক্ষণ পরে আবার চেষ্টা করুন।');
                }
                if (res.destroyed) return;
                busy = true;
                generationTimes.push(Date.now());
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeoutMs);
                const abortOnDisconnect = () => { if (!res.writableEnded) controller.abort(); };
                res.on('close', abortOnDisconnect);
                try {
                    const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                        body: JSON.stringify(buildGeminiRequest(input)),
                        signal: controller.signal
                    });
                    if (!response.ok) {
                        await response.body?.cancel();
                        if (response.status === 429) {
                            res.setHeader('Retry-After', '60');
                            fail(429, 'PROVIDER_QUOTA', 'Gemini-এর quota বা rate limit শেষ। বিলিং/সীমা পরীক্ষা করুন অথবা পরে চেষ্টা করুন।');
                        }
                        if ([401, 403, 404].includes(response.status)) fail(502, 'PROVIDER_CONFIG', 'সার্ভারের Gemini key, বিলিং, অনুমতি বা image model পরীক্ষা করতে হবে।');
                        if (response.status === 400) fail(422, 'PROVIDER_REJECTED', 'Gemini এই অনুরোধ গ্রহণ করেনি। ছবি/প্রম্পট বদলান এবং সঠিক image model ব্যবহার হচ্ছে কি না পরীক্ষা করুন।');
                        fail(502, 'PROVIDER_ERROR', 'ইমেজ সেবায় সাময়িক সমস্যা হচ্ছে। পরে আবার চেষ্টা করুন।');
                    }
                    const image = extractImage(await readProviderJSON(response));
                    sendJSON(res, 200, { image, model });
                } catch (error) {
                    if (error instanceof PublicError) throw error;
                    if (controller.signal.aborted) fail(504, 'TIMEOUT', 'অপেক্ষার সময় শেষ বা অনুরোধ বন্ধ হয়েছে। পরে আবার চেষ্টা করুন।');
                    fail(502, 'PROVIDER_UNREACHABLE', 'Gemini সার্ভারে পৌঁছানো যায়নি। সার্ভারের ইন্টারনেট সংযোগ পরীক্ষা করুন।');
                } finally {
                    clearTimeout(timer);
                    res.off('close', abortOnDisconnect);
                    busy = false;
                }
                return;
            }
            const asset = STATIC_FILES.get(path);
            if (!asset) fail(404, 'NOT_FOUND', 'এই ঠিকানাটি পাওয়া যায়নি।');
            if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); fail(405, 'METHOD', 'GET ব্যবহার করুন।'); }
            const contents = await readFile(fileURLToPath(new URL(asset[0], import.meta.url)));
            res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-cache', 'Content-Length': contents.length });
            res.end(req.method === 'HEAD' ? undefined : contents);
        } catch (error) {
            if (error instanceof PublicError) {
                sendJSON(res, error.status, { error: error.message, code: error.code });
            } else {
                // Never echo provider errors, request bodies, tokens, or API keys into logs/responses.
                sendJSON(res, 500, { error: 'সার্ভারে সমস্যা হয়েছে। আবার চেষ্টা করুন।', code: 'SERVER_ERROR' });
            }
            if (!req.complete) req.resume();
        }
    });
    server.requestTimeout = 60_000;
    server.headersTimeout = 15_000;
    return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const port = Number(process.env.PORT || 3000);
    const server = createStudioServer();
    server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Nahid AI Studio listening on port ${port}`));
    server.on('error', error => { console.error(`Server failed to start (${error.code || 'unknown error'}).`); process.exitCode = 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
        server.close();
        server.closeAllConnections();
    });
}
