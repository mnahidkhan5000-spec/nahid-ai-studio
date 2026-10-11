import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createStudioServer, MAX_IMAGE_BYTES } from '../server.mjs';

const png = (await readFile(new URL('./fixtures/reference.png', import.meta.url))).toString('base64');
const token = 'test-only-studio-access-code';
const key = 'test-only-provider-secret';
const providerImage = () => Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png } }] } }] });
const payload = (overrides = {}) => ({ prompt: 'নদীর ধারে জলরঙের ছবি', aspectRatio: '16:9', references: [], ...overrides });
const reference = (role = 'subject') => ({ role, mimeType: 'image/png', data: png });

async function start(t, options = {}) {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push({ url, ...init }); return providerImage(); };
    const server = createStudioServer({ apiKey: key, accessToken: token, model: 'gemini-3.1-flash-image', fetchImpl, ...options });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });
    const post = (body = payload(), headers = {}) => fetch(`${base}/api/remix`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': token, Origin: base, ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body)
    });
    return { base, post, calls };
}

for (const options of [{ apiKey: '' }, { accessToken: '' }, { accessToken: 'short' }, { model: '../../not-a-model' }]) {
    test(`unconfigured server never calls provider: ${Object.keys(options)[0]}=${Object.values(options)[0]}`, async t => {
        const { base, post, calls } = await start(t, options);
        const status = await (await fetch(`${base}/api/status`)).json();
        assert.equal(status.configured, false);
        const response = await post();
        assert.equal(response.status, 503);
        assert.equal((await response.json()).code, 'NOT_CONFIGURED');
        assert.equal(calls.length, 0);
    });
}

test('status has no secrets and configuration does not trigger a paid provider request', async t => {
    const { base, calls } = await start(t);
    const response = await fetch(`${base}/api/status`);
    const text = await response.text();
    assert.equal(JSON.parse(text).configured, true);
    assert.equal(JSON.parse(text).maxImageBytes, MAX_IMAGE_BYTES);
    assert.ok(!text.includes(key) && !text.includes(token));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(calls.length, 0);
});

test('three role-labeled image inputs and aspect ratio reach Gemini, not a text-only fallback', async t => {
    const { post, calls } = await start(t);
    const response = await post(payload({ references: ['subject', 'scene', 'style'].map(reference) }));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).image, { mimeType: 'image/png', data: png });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent');
    assert.equal(calls[0].headers['x-goog-api-key'], key);
    assert.ok(!calls[0].url.includes(key));
    const request = JSON.parse(calls[0].body);
    assert.deepEqual(request.generationConfig, { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '16:9' } });
    const parts = request.contents[0].parts;
    assert.equal(parts.filter(part => part.inlineData).length, 3);
    for (const [index, role] of ['Subject', 'Scene', 'Style'].entries()) {
        assert.ok(parts[1 + index * 2].text.startsWith(`${role} reference:`));
        assert.deepEqual(parts[2 + index * 2].inlineData, { mimeType: 'image/png', data: png });
    }
    assert.ok(parts.at(-1).text.includes('নদীর ধারে'));
    assert.ok(!calls[0].body.includes(token));
});

test('text-only and reference-only generation are supported', async t => {
    const { post, calls } = await start(t);
    assert.equal((await post()).status, 200);
    assert.equal((await post(payload({ prompt: '', references: [reference('style')] }))).status, 200);
    assert.equal(calls.length, 2);
    assert.equal(JSON.parse(calls[0].body).contents[0].parts.filter(part => part.inlineData).length, 0);
});

test('missing/wrong access codes and cross-site requests do not reach the provider', async t => {
    const { post, calls } = await start(t);
    assert.equal((await post(payload(), { 'X-Studio-Token': '' })).status, 401);
    assert.equal((await post(payload(), { 'X-Studio-Token': 'wrong' })).status, 401);
    assert.equal((await post(payload(), { Origin: 'https://attacker.invalid' })).status, 403);
    assert.equal((await post(payload(), { Origin: 'null' })).status, 403);
    assert.equal((await post(payload(), { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal(calls.length, 0);
});

test('repeated wrong access codes are throttled', async t => {
    const { post, calls } = await start(t);
    for (let i = 0; i < 20; i++) assert.equal((await post(payload(), { 'X-Studio-Token': 'wrong' })).status, 401);
    const response = await post(payload(), { 'X-Studio-Token': 'wrong' });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '60');
    assert.equal(calls.length, 0);
});

test('invalid requests and forged image types are rejected before billing', async t => {
    const { post, calls } = await start(t);
    const invalid = [
        null, [], {}, payload({ prompt: '' }), payload({ prompt: 'x'.repeat(2001) }),
        payload({ aspectRatio: '999:1' }), payload({ references: {} }),
        payload({ references: [reference(), reference()] }),
        payload({ references: ['subject', 'scene', 'style', 'subject'].map(reference) }),
        payload({ references: [reference('__proto__')] }),
        payload({ references: [{ ...reference(), mimeType: 'image/svg+xml' }] }),
        payload({ references: [{ ...reference(), mimeType: 'image/jpeg' }] }),
        payload({ references: [{ ...reference(), data: 'data:image/png;base64,' + png }] }),
        payload({ references: [{ ...reference(), data: png + '\n' }] }),
        payload({ references: [{ ...reference(), data: Buffer.from('<svg onload="alert(1)"></svg>').toString('base64') }] }),
        payload({ references: [{ ...reference(), data: Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64') }] })
    ];
    for (const body of invalid) assert.equal((await post(body)).status, 400);
    assert.equal((await post('{invalid json')).status, 400);
    assert.equal((await post(payload(), { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal(calls.length, 0);
});

test('request bodies above the total limit get 413', async t => {
    const { post, calls } = await start(t);
    const response = await post(JSON.stringify({ ignored: 'x'.repeat(22 * 1024 * 1024) }));
    assert.equal(response.status, 413);
    assert.equal(calls.length, 0);
});

test('generation attempts share a server-side limit', async t => {
    const { post, calls } = await start(t, { generationLimit: 1 });
    assert.equal((await post()).status, 200);
    const response = await post();
    assert.equal(response.status, 429);
    assert.equal((await response.json()).code, 'RATE_LIMIT');
    assert.equal(calls.length, 1);
});

test('only one upstream request runs at a time and the lock is released', async t => {
    let release;
    let started;
    const entered = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    let calls = 0;
    const { post } = await start(t, { fetchImpl: async () => { calls++; started(); await gate; return providerImage(); } });
    const first = post();
    await entered;
    const second = await post();
    assert.equal(second.status, 429);
    assert.equal((await second.json()).code, 'BUSY');
    release();
    assert.equal((await first).status, 200);
    assert.equal((await post()).status, 200);
    assert.equal(calls, 2);
});

for (const [upstream, expected, code] of [[429, 429, 'PROVIDER_QUOTA'], [401, 502, 'PROVIDER_CONFIG'], [403, 502, 'PROVIDER_CONFIG'], [404, 502, 'PROVIDER_CONFIG'], [400, 422, 'PROVIDER_REJECTED'], [500, 502, 'PROVIDER_ERROR']]) {
    test(`upstream ${upstream} is safely mapped to ${code}`, async t => {
        const { post } = await start(t, { fetchImpl: async () => new Response(`Never expose ${key}`, { status: upstream }) });
        const response = await post();
        assert.equal(response.status, expected);
        const body = await response.text();
        assert.equal(JSON.parse(body).code, code);
        assert.ok(!body.includes(key));
    });
}

for (const [body, code] of [
    [{ promptFeedback: { blockReason: 'SAFETY' } }, 'SAFETY_BLOCK'],
    [{ candidates: [{ finishReason: 'IMAGE_SAFETY' }] }, 'SAFETY_BLOCK'],
    [{ candidates: [{ content: { parts: [{ text: 'No image' }] } }] }, 'NO_IMAGE'],
    [{ candidates: [{ content: { parts: [{ thought: true, inlineData: { mimeType: 'image/png', data: png } }] } }] }, 'NO_IMAGE'],
    [{ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'text/html', data: png } }] } }] }, 'INVALID_OUTPUT']
]) {
    test(`provider output is handled: ${code}`, async t => {
        const { post } = await start(t, { fetchImpl: async () => Response.json(body) });
        const response = await post();
        assert.equal((await response.json()).code, code);
    });
}

test('network/JSON failures are safe and a timeout releases the generation lock', async t => {
    let mode = 'network';
    const { post } = await start(t, {
        timeoutMs: 25,
        fetchImpl: async (_url, { signal }) => {
            if (mode === 'network') throw new Error(`private error ${key}`);
            if (mode === 'json') return new Response('not json');
            if (mode === 'slow') return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
            return providerImage();
        }
    });
    assert.equal((await (await post()).json()).code, 'PROVIDER_UNREACHABLE');
    mode = 'json';
    assert.equal((await (await post()).json()).code, 'PROVIDER_RESPONSE');
    mode = 'slow';
    assert.equal((await (await post()).json()).code, 'TIMEOUT');
    mode = 'ready';
    assert.equal((await post()).status, 200);
});

test('disconnect aborts the upstream request', async t => {
    let entered;
    let cancelled;
    const started = new Promise(resolve => { entered = resolve; });
    const aborted = new Promise(resolve => { cancelled = resolve; });
    const { base } = await start(t, {
        fetchImpl: async (_url, { signal }) => new Promise((_, reject) => {
            entered();
            signal.addEventListener('abort', () => { cancelled(); reject(new Error('aborted')); }, { once: true });
        })
    });
    const controller = new AbortController();
    const request = fetch(`${base}/api/remix`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': token },
        body: JSON.stringify(payload()), signal: controller.signal
    }).catch(error => error);
    await started;
    controller.abort();
    await aborted;
    assert.equal((await request).name, 'AbortError');
});

test('only public assets are served; preview host and iframe embedding remain allowed', async t => {
    const { base } = await start(t);
    for (const path of ['/', '/index.html', '/studio.css', '/studio.js', '/html-studio.js', '/assets/NotoSansBengali.ttf']) {
        const response = await fetch(base + path, { headers: { Host: '3000-example.e2b.app' } });
        assert.equal(response.status, 200, path);
        assert.equal(response.headers.get('x-frame-options'), null);
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    }
    for (const path of ['/.env', '/.env.example', '/.git/config', '/server.mjs', '/package.json', '/%2e%2e/.env', '/api/unknown']) {
        assert.equal((await fetch(base + path)).status, 404, path);
    }
    assert.equal((await fetch(base + '/api/remix')).status, 405);
    assert.equal((await fetch(base + '/api/status', { method: 'POST' })).status, 405);
    const head = await fetch(base + '/', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
});
