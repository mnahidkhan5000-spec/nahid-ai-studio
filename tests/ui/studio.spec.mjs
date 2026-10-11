import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const fixture = await readFile(new URL('../fixtures/reference.png', import.meta.url));
const code = 'test-only-studio-access-code';
const mockResult = { image: { mimeType: 'image/png', data: fixture.toString('base64') }, model: 'test-image-model' };
const file = (name = 'reference.png') => ({ name, mimeType: 'image/png', buffer: fixture });

async function configured(page) {
    await page.route('**/api/status', route => route.fulfill({ json: { configured: true, provider: 'Google Gemini', model: 'test-image-model', accessRequired: true } }));
    await page.goto('/');
    await expect(page.locator('#accessCodeGroup')).toBeVisible();
}

async function readyPrompt(page) {
    await configured(page);
    await page.locator('#remixPrompt').fill('নদীর পাশে নরম আলোয় একটি বাড়ি');
    await page.locator('#studioAccessCode').fill(code);
}

test('no API key shows honest setup guidance; local drafting and the Whisk shortcut still work', async ({ page, context }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page.locator('#connectionBadge')).toHaveText('API সেটআপ প্রয়োজন');
    await expect(page.locator('#generateRemix')).toBeDisabled();
    await expect(page.locator('#setupInstructions')).toBeVisible();
    await page.locator('#remixPrompt').fill('আমার নতুন ছবি');
    await page.locator('#tab-whisk').click();
    const link = page.locator('#openWhisk');
    await expect(link).toHaveAttribute('href', 'https://labs.google/fx/tools/whisk');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await context.route('https://labs.google/**', route => route.fulfill({ body: '<h1>External page test stub</h1>', contentType: 'text/html' }));
    const opened = page.waitForEvent('popup');
    await link.click();
    const popup = await opened;
    await popup.waitForLoadState();
    expect(popup.url()).toBe('https://labs.google/fx/tools/whisk');
    await popup.close();
    await page.locator('#tab-remix').click();
    await expect(page.locator('#remixPrompt')).toHaveValue('আমার নতুন ছবি');
    expect(errors).toEqual([]);
});

test('keyboard navigation works and the original HTML sandbox/editor stays separate', async ({ page }) => {
    await page.goto('/');
    await page.locator('#tab-remix').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tab-legacy')).toBeFocused();
    await expect(page.locator('#legacy-panel')).toBeVisible();
    await page.keyboard.press('End');
    await expect(page.locator('#tab-html')).toBeFocused();
    await expect(page.locator('#html-panel')).toBeVisible();
    await expect(page.locator('#htmlPreview')).toHaveAttribute('sandbox', '');
    await page.locator('#htmlCode').fill('<h1>পরীক্ষার HTML</h1><script>parent.__escaped = true</script>');
    await page.locator('#renderHtml').click();
    await expect(page.frameLocator('#htmlPreview').getByRole('heading')).toHaveText('পরীক্ষার HTML');
    expect(await page.evaluate(() => window.__escaped)).toBeUndefined();
    await page.locator('#tab-remix').click();
    await expect(page.locator('#remixPrompt')).toHaveValue('');
    await page.locator('#tab-html').click();
    await expect(page.locator('#htmlCode')).toHaveValue(/পরীক্ষার HTML/);
    await page.reload();
    await expect(page.locator('#html-panel')).toBeVisible();
    await expect(page.locator('#htmlCode')).toHaveValue(/পরীক্ষার HTML/);
});

test('all three references preview locally, survive tab switches, and can be removed/replaced', async ({ page }) => {
    let posted = 0;
    await page.route('**/api/remix', route => { posted++; return route.abort(); });
    await page.goto('/');
    for (const role of ['subject', 'scene', 'style']) {
        await page.locator(`#${role}File`).setInputFiles(file(`${role}.png`));
        await expect(page.locator(`#${role}Preview`)).toBeVisible();
        await expect(page.locator(`#${role}FileName`)).toHaveText(`${role}.png`);
    }
    await page.locator('#tab-whisk').click();
    await page.locator('#tab-remix').click();
    await expect(page.locator('#subjectPreview')).toBeVisible();
    await page.locator('#subjectRemove').click();
    await expect(page.locator('#subjectPreview')).toBeHidden();
    await expect(page.locator('#scenePreview')).toBeVisible();
    await page.locator('#sceneFile').setInputFiles(file('new-scene.png'));
    await expect(page.locator('#sceneFileName')).toHaveText('new-scene.png');
    expect(posted).toBe(0);
});

test('invalid, corrupt and oversized uploads do not replace a good reference', async ({ page }) => {
    await page.goto('/');
    await page.locator('#subjectFile').setInputFiles(file('keep-me.png'));
    await expect(page.locator('#subjectPreview')).toBeVisible();
    await page.locator('#subjectFile').setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
    await expect(page.locator('#uploadStatus')).toHaveAttribute('data-tone', 'error');
    await expect(page.locator('#subjectFileName')).toHaveText('keep-me.png');
    await page.locator('#subjectFile').setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    await expect(page.locator('#uploadStatus')).toContainText('বৈধ');
    await page.locator('#subjectFile').setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
    await expect(page.locator('#uploadStatus')).toContainText('৫ MB');
    await expect(page.locator('#subjectFileName')).toHaveText('keep-me.png');
});

test('only prompt/aspect persist on reload, never reference bytes or the access code', async ({ page }) => {
    await readyPrompt(page);
    await page.locator('#remixAspect').selectOption('9:16');
    await page.locator('#styleFile').setInputFiles(file());
    await expect(page.locator('#stylePreview')).toBeVisible();
    const storage = await page.evaluate(() => JSON.stringify(localStorage));
    expect(storage).not.toContain(code);
    expect(storage).not.toContain(fixture.toString('base64'));
    await page.reload();
    await expect(page.locator('#remixPrompt')).toHaveValue('নদীর পাশে নরম আলোয় একটি বাড়ি');
    await expect(page.locator('#remixAspect')).toHaveValue('9:16');
    await expect(page.locator('#studioAccessCode')).toHaveValue('');
    await expect(page.locator('#stylePreview')).toBeHidden();
});

test('generation sends real reference bytes, renders actual dimensions, and downloads the response', async ({ page }) => {
    let request;
    await page.route('**/api/remix', route => { request = route.request(); return route.fulfill({ json: mockResult }); });
    await readyPrompt(page);
    for (const role of ['subject', 'scene', 'style']) {
        await page.locator(`#${role}File`).setInputFiles(file());
        await expect(page.locator(`#${role}Preview`)).toBeVisible();
    }
    await page.locator('#remixAspect').selectOption('16:9');
    await page.locator('#generateRemix').click();
    await expect(page.locator('#remixResult')).toBeVisible();
    await expect(page.locator('#resultMeta')).toHaveText('32 × 32 · PNG');
    expect(request.headers()['x-studio-token']).toBe(code);
    expect(request.headers()['x-goog-api-key']).toBeUndefined();
    expect(request.postDataJSON().aspectRatio).toBe('16:9');
    expect(request.postDataJSON().references).toEqual(['subject', 'scene', 'style'].map(role => ({ role, mimeType: 'image/png', data: fixture.toString('base64') })));
    const downloading = page.waitForEvent('download');
    await page.locator('#remixDownload').click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^nahid-image-.*\.png$/);
    expect(await readFile(await download.path())).toEqual(fixture);
    await page.locator('#tab-whisk').click();
    await page.locator('#tab-remix').click();
    await expect(page.locator('#remixResult')).toBeVisible();
});

test('empty input and missing access code are caught before an API request', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/remix', route => { calls++; return route.fulfill({ json: mockResult }); });
    await configured(page);
    await page.locator('#generateRemix').click();
    await expect(page.locator('#remixStatus')).toContainText('অন্তত একটি');
    await expect(page.locator('#remixPrompt')).toBeFocused();
    await page.locator('#remixPrompt').fill('একটি বাড়ি');
    await page.locator('#generateRemix').click();
    await expect(page.locator('#studioAccessCode')).toBeFocused();
    expect(calls).toBe(0);
});

test('provider failures retain the previous output and input, and restore the controls', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/remix', route => {
        calls++;
        return route.fulfill(calls === 1 ? { json: mockResult } : { status: 429, json: { error: 'কোটা শেষ; পরে চেষ্টা করুন।', code: 'PROVIDER_QUOTA' } });
    });
    await readyPrompt(page);
    await page.locator('#generateRemix').click();
    await expect(page.locator('#remixResult')).toBeVisible();
    const original = await page.locator('#remixResult').getAttribute('src');
    await page.locator('#generateRemix').click();
    await expect(page.locator('#remixStatus')).toContainText('কোটা শেষ');
    await expect(page.locator('#remixResult')).toHaveAttribute('src', original);
    await expect(page.locator('#generateRemix')).toBeEnabled();
    await expect(page.locator('#remixPrompt')).toHaveValue('নদীর পাশে নরম আলোয় একটি বাড়ি');
    await expect(page.locator('#remixLoading')).toBeHidden();
});

test('wrong access code gives an actionable error without losing the prompt', async ({ page }) => {
    await page.route('**/api/remix', route => route.fulfill({ status: 401, json: { code: 'ACCESS_DENIED', error: 'Studio access code সঠিক নয়।' } }));
    await readyPrompt(page);
    await page.locator('#generateRemix').click();
    await expect(page.locator('#studioAccessCode')).toBeFocused();
    await expect(page.locator('#remixStatus')).toContainText('সঠিক নয়');
    await expect(page.locator('#generateRemix')).toBeEnabled();
});

test('switching tabs does not cancel a request; explicit cancel restores controls', async ({ page }) => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/remix', async route => { await gate; await route.fulfill({ json: mockResult }).catch(() => {}); });
    await readyPrompt(page);
    await page.locator('#generateRemix').click();
    await expect(page.locator('#remixLoading')).toBeVisible();
    await expect(page.locator('#remixPrompt')).toBeDisabled();
    await page.locator('#tab-whisk').click();
    await page.locator('#tab-remix').click();
    await expect(page.locator('#remixLoading')).toBeVisible();
    await page.locator('#cancelRemix').click();
    await expect(page.locator('#remixStatus')).toContainText('অপেক্ষা বন্ধ');
    await expect(page.locator('#generateRemix')).toBeEnabled();
    await expect(page.locator('#remixLoading')).toBeHidden();
    release();
});

test('reset requires confirmation and affects only the Image Studio', async ({ page }) => {
    await readyPrompt(page);
    await page.locator('#subjectFile').setInputFiles(file());
    await expect(page.locator('#subjectPreview')).toBeVisible();
    await page.locator('#tab-html').click();
    await page.locator('#htmlCode').fill('<h1>আমার HTML থাকবে</h1>');
    await page.locator('#tab-remix').click();
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#resetRemix').click();
    await expect(page.locator('#subjectPreview')).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#resetRemix').click();
    await expect(page.locator('#subjectPreview')).toBeHidden();
    await expect(page.locator('#remixPrompt')).toHaveValue('');
    await page.locator('#tab-html').click();
    await expect(page.locator('#htmlCode')).toHaveValue('<h1>আমার HTML থাকবে</h1>');
});

test('prompt copy is usable without an API connection', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await page.locator('#remixPrompt').fill('জলরঙের সুন্দর একটি বাড়ি');
    await page.locator('#remixAspect').selectOption('4:3');
    await page.locator('#copyPrompt').click();
    await expect(page.locator('#remixStatus')).toContainText('প্রম্পট কপি হয়েছে');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Aspect ratio: 4:3.');
});

test('static hosting failure is explained, and connection can be rechecked', async ({ page }) => {
    let ready = false;
    await page.route('**/api/status', route => ready
        ? route.fulfill({ json: { configured: true, model: 'test-model' } })
        : route.fulfill({ status: 404, contentType: 'text/html', body: 'Not Found' }));
    await page.goto('/');
    await expect(page.locator('#connectionBadge')).toHaveText('ইমেজ সার্ভার পাওয়া যায়নি');
    await expect(page.locator('#generateRemix')).toBeDisabled();
    ready = true;
    await page.locator('#checkConnection').click();
    await expect(page.locator('#generateRemix')).toBeEnabled();
    await expect(page.locator('#accessCodeGroup')).toBeVisible();
});

test('disabled localStorage does not break navigation or image previews', async ({ page }) => {
    await page.addInitScript(() => {
        Storage.prototype.getItem = () => { throw new DOMException('Disabled'); };
        Storage.prototype.setItem = () => { throw new DOMException('Disabled'); };
    });
    await page.goto('/');
    await page.locator('#remixPrompt').fill('অস্থায়ী প্রম্পট');
    await expect(page.locator('#remixDraftStatus')).toContainText('সংরক্ষণ বন্ধ');
    await page.locator('#subjectFile').setInputFiles(file());
    await expect(page.locator('#subjectPreview')).toBeVisible();
    await page.locator('#tab-html').click();
    await expect(page.locator('#htmlStatus')).toContainText('সংরক্ষণ সম্ভব হয়নি');
});

for (const width of [320, 390, 768, 1440]) {
    test(`all workspaces fit a ${width}px viewport`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/');
        await page.evaluate(() => document.fonts.ready);
        for (const name of ['remix', 'whisk', 'legacy', 'html']) {
            await page.locator(`#tab-${name}`).click();
            await expect(page.locator(`#${name}-panel`)).toBeVisible();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        }
    });
}
