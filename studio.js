(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const tabs = [...document.querySelectorAll('[data-workspace]')];
    const roles = ['subject', 'scene', 'style'];
    const roleLabels = { subject: 'Subject', scene: 'Scene', style: 'Style' };
    const maxImageBytes = 5 * 1024 * 1024;
    const imageTypes = ['image/png', 'image/jpeg', 'image/webp'];
    const aspects = new Set(['1:1', '16:9', '9:16', '4:3', '3:4']);
    const draftKey = 'nahid-image-studio-draft-v1';
    const refs = new Map();
    const uploadVersions = { subject: 0, scene: 0, style: 0 };
    const state = { ready: false, busy: false, pendingUploads: 0, request: null, resultURL: null };

    function openWorkspace(name, focus = false, updateHash = true) {
        if (!tabs.some(tab => tab.dataset.workspace === name)) name = 'remix';
        for (const tab of tabs) {
            const selected = tab.dataset.workspace === name;
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
            $(tab.getAttribute('aria-controls')).hidden = !selected;
            if (selected && focus) tab.focus();
        }
        if (updateHash) {
            try { history.replaceState(null, '', `#${name}`); }
            catch { /* Tabs still work when history is unavailable in a file viewer. */ }
        }
    }
    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => openWorkspace(tab.dataset.workspace));
        tab.addEventListener('keydown', event => {
            let next;
            if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
            if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = tabs.length - 1;
            if (next !== undefined) {
                event.preventDefault();
                openWorkspace(tabs[next].dataset.workspace, true);
            }
        });
    });
    document.querySelectorAll('[data-open-workspace]').forEach(button => {
        button.addEventListener('click', () => openWorkspace(button.dataset.openWorkspace, true));
    });
    window.addEventListener('hashchange', () => openWorkspace(location.hash.slice(1), false, false));
    openWorkspace(location.hash.slice(1), false, false);

    function message(id, text, error = false) {
        $(id).textContent = text;
        $(id).dataset.tone = error ? 'error' : 'normal';
    }
    function updateControls() {
        $('generateRemix').disabled = !state.ready || state.busy || state.pendingUploads > 0;
        $('remixInputs').disabled = state.busy;
        $('cancelRemix').hidden = !state.busy;
        $('remixLoading').hidden = !state.busy;
        $('remixOutput').setAttribute('aria-busy', String(state.busy));
    }
    async function checkConnection() {
        $('checkConnection').disabled = true;
        $('connectionBadge').textContent = 'সংযোগ পরীক্ষা হচ্ছে…';
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        try {
            const response = await fetch('/api/status', { cache: 'no-store', signal: controller.signal, credentials: 'same-origin' });
            if (!response.ok) throw new Error('No backend');
            const info = await response.json();
            if (typeof info.configured !== 'boolean') throw new Error('Invalid backend');
            state.ready = info.configured;
            $('connectionBadge').textContent = state.ready ? '● Gemini সেটআপ আছে' : 'API সেটআপ প্রয়োজন';
            $('connectionShort').textContent = state.ready ? 'সার্ভার প্রস্তুত · access code দিয়ে ব্যবহার করুন' : 'রেফারেন্স সাজাতে পারেন; ছবি তৈরি এখনো চালু নয়';
            $('connectionMessage').textContent = state.ready
                ? `সার্ভারে ${typeof info.model === 'string' ? info.model : 'Gemini image model'} সেটআপ আছে। ছবি তৈরি করতে নিচে আপনার আলাদা Studio access code দিন। এটি সেটআপের অবস্থা; প্রথম অনুরোধে provider key, quota ও model access যাচাই হবে।`
                : 'ছবি তৈরি এখনো চালু নয়। সার্ভারে Gemini key, উপযুক্ত image model এবং আলাদা Studio access code সেটআপ করুন।';
            $('setupInstructions').hidden = state.ready;
        } catch {
            state.ready = false;
            $('connectionBadge').textContent = 'ইমেজ সার্ভার পাওয়া যায়নি';
            $('connectionShort').textContent = 'Node.js backend প্রয়োজন';
            $('connectionMessage').textContent = 'এই ঠিকানায় ইমেজ API পাওয়া যায়নি। শুধু HTML ফাইল বা static hosting হলে Node.js সার্ভার দিয়ে অ্যাপ চালু করুন। সার্ভার থাকলে সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।';
            $('setupInstructions').hidden = false;
        } finally {
            clearTimeout(timer);
            $('connectionBadge').dataset.state = state.ready ? 'ready' : 'setup';
            $('connectionDetails').open = !state.ready;
            $('accessCodeGroup').hidden = !state.ready;
            $('generateHint').textContent = state.ready
                ? 'নির্বাচিত ছবি ও প্রম্পট Gemini-তে পাঠানো হবে; ব্যবহারমূল্য প্রযোজ্য হতে পারে।'
                : 'API সেটআপ হলে ছবি তৈরি করা যাবে। এখন প্রম্পট লেখা ও কপি করতে পারেন।';
            $('checkConnection').disabled = false;
            updateControls();
        }
    }
    $('checkConnection').addEventListener('click', checkConnection);

    function saveDraft() {
        $('promptCount').textContent = `${$('remixPrompt').value.length} / 2000`;
        try {
            localStorage.setItem(draftKey, JSON.stringify({ prompt: $('remixPrompt').value, aspectRatio: $('remixAspect').value }));
            $('remixDraftStatus').textContent = 'প্রম্পট ও অনুপাত সংরক্ষিত। ছবি শুধু এই খোলা পেজে থাকবে।';
        } catch {
            $('remixDraftStatus').textContent = 'ব্রাউজারে সংরক্ষণ বন্ধ আছে; প্রম্পট কপি করে রাখুন।';
        }
    }
    try {
        const draft = JSON.parse(localStorage.getItem(draftKey));
        if (draft && typeof draft.prompt === 'string') $('remixPrompt').value = draft.prompt.slice(0, 2000);
        if (draft && aspects.has(draft.aspectRatio)) $('remixAspect').value = draft.aspectRatio;
    } catch { /* Disabled storage or an invalid draft must not break the editor. */ }
    $('promptCount').textContent = `${$('remixPrompt').value.length} / 2000`;
    $('remixPrompt').addEventListener('input', saveDraft);
    $('remixAspect').addEventListener('change', saveDraft);

    function clearReference(role) {
        uploadVersions[role]++;
        if (refs.has(role)) URL.revokeObjectURL(refs.get(role).url);
        refs.delete(role);
        $(`${role}Preview`).hidden = true;
        $(`${role}Preview`).removeAttribute('src');
        $(`${role}Placeholder`).hidden = false;
        $(`${role}Remove`).hidden = true;
        $(`${role}File`).value = '';
        $(`${role}FileName`).textContent = 'কোনো ছবি নেই';
        $(`${role}FileName`).removeAttribute('title');
        document.querySelector(`[data-drop-role="${role}"] .replace-image`).hidden = true;
    }
    function readBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
            reader.onerror = () => reject(new Error('ছবি পড়া যায়নি। অন্য একটি ফাইল বেছে নিন।'));
            reader.readAsDataURL(file);
        });
    }
    async function loadReference(role, file) {
        if (!file || state.busy) return;
        const version = ++uploadVersions[role];
        state.pendingUploads++;
        updateControls();
        let newURL;
        try {
            if (!imageTypes.includes(file.type) || !file.size || file.size > maxImageBytes) {
                throw new Error('৫ MB বা তার কম সাইজের JPG, PNG অথবা WEBP ছবি দিন।');
            }
            message('uploadStatus', `${roleLabels[role]} ছবিটি পড়া হচ্ছে…`);
            newURL = URL.createObjectURL(file);
            const image = new Image();
            image.src = newURL;
            try { await image.decode(); }
            catch { throw new Error('ফাইলটি বৈধ বা পড়ার উপযোগী ছবি নয়। অন্য ছবি বেছে নিন।'); }
            if (image.naturalWidth * image.naturalHeight > 24_000_000 || Math.max(image.naturalWidth, image.naturalHeight) > 8192) {
                throw new Error('ছবিটি অনেক বড়। সর্বোচ্চ ২৪ মেগাপিক্সেল এবং প্রতি পাশে ৮১৯২ পিক্সেলের মধ্যে ছোট করে দিন।');
            }
            const data = await readBase64(file);
            if (version !== uploadVersions[role]) return;
            if (refs.has(role)) URL.revokeObjectURL(refs.get(role).url);
            refs.set(role, { data, mimeType: file.type, url: newURL });
            $(`${role}Preview`).src = newURL;
            $(`${role}Preview`).hidden = false;
            $(`${role}Placeholder`).hidden = true;
            $(`${role}Remove`).hidden = false;
            $(`${role}FileName`).textContent = file.name;
            $(`${role}FileName`).title = file.name;
            document.querySelector(`[data-drop-role="${role}"] .replace-image`).hidden = false;
            newURL = null; // The reference owns this object URL until removed/replaced.
            message('uploadStatus', `${roleLabels[role]} ছবি প্রস্তুত। এখনো কোনো ছবি সার্ভারে পাঠানো হয়নি।`);
        } catch (error) {
            if (version === uploadVersions[role]) message('uploadStatus', error.message, true);
        } finally {
            if (newURL) URL.revokeObjectURL(newURL);
            state.pendingUploads--;
            updateControls();
        }
    }
    for (const role of roles) {
        $(`${role}File`).addEventListener('change', event => {
            const file = event.target.files[0];
            event.target.value = '';
            loadReference(role, file);
        });
        $(`${role}Remove`).addEventListener('click', () => {
            if (state.busy) return;
            clearReference(role);
            message('uploadStatus', `${roleLabels[role]} ছবি সরানো হয়েছে।`);
            $(`${role}File`).focus();
        });
        const drop = document.querySelector(`[data-drop-role="${role}"]`);
        for (const type of ['dragenter', 'dragover']) drop.addEventListener(type, event => {
            event.preventDefault();
            if (!state.busy) drop.classList.add('is-dragover');
        });
        drop.addEventListener('dragleave', event => {
            if (!drop.contains(event.relatedTarget)) drop.classList.remove('is-dragover');
        });
        drop.addEventListener('drop', event => {
            event.preventDefault();
            drop.classList.remove('is-dragover');
            if (state.busy) return;
            if (event.dataTransfer.files.length !== 1) {
                message('uploadStatus', 'একটি ঘরে একবারে একটি ছবি দিন।', true);
                return;
            }
            loadReference(role, event.dataTransfer.files[0]);
        });
    }
    // Do not accidentally navigate away (and lose images) when a file misses its drop zone.
    for (const type of ['dragover', 'drop']) window.addEventListener(type, event => {
        if ([...(event.dataTransfer?.types || [])].includes('Files')) event.preventDefault();
    });

    $('copyPrompt').addEventListener('click', async () => {
        const prompt = $('remixPrompt').value.trim();
        if (!prompt && !refs.size) {
            message('remixStatus', 'কপি করার আগে একটি প্রম্পট লিখুন অথবা রেফারেন্স দিন।', true);
            $('remixPrompt').focus();
            return;
        }
        const instructions = {
            subject: 'Use the subject reference for the main person, object, or character.',
            scene: 'Use the scene reference for the setting, layout, and lighting.',
            style: 'Use the style reference for the colors, medium, and visual style.'
        };
        const text = [prompt || 'Combine the references into one cohesive new image.',
            ...roles.filter(role => refs.has(role)).map(role => instructions[role]),
            `Aspect ratio: ${$('remixAspect').value}.`
        ].join('\n');
        try {
            await navigator.clipboard.writeText(text);
            message('remixStatus', 'প্রম্পট কপি হয়েছে। Whisk-এ ব্যবহার করলে রেফারেন্স ছবিগুলো সেখানে আলাদা করে দিতে হবে।');
        } catch {
            $('remixPrompt').focus();
            $('remixPrompt').select();
            message('remixStatus', 'ব্রাউজার কপি করার অনুমতি দেয়নি। নির্বাচিত প্রম্পট ম্যানুয়ালি কপি করুন।', true);
        }
    });

    function outputBlob(image) {
        if (!imageTypes.includes(image?.mimeType) || typeof image.data !== 'string' || image.data.length > 28_000_000) {
            throw new Error('সার্ভার থেকে সঠিক ছবি পাওয়া যায়নি।');
        }
        const bytes = Uint8Array.from(atob(image.data), character => character.charCodeAt(0));
        return new Blob([bytes], { type: image.mimeType });
    }
    $('remixForm').addEventListener('submit', async event => {
        event.preventDefault();
        if (state.busy || state.pendingUploads) return;
        if (!state.ready) {
            message('remixStatus', 'আগে সার্ভারের API সংযোগ সেটআপ করুন।', true);
            $('connectionDetails').open = true;
            return;
        }
        const prompt = $('remixPrompt').value.trim();
        if (!prompt && !refs.size) {
            message('remixStatus', 'অন্তত একটি রেফারেন্স ছবি অথবা প্রম্পট দিন।', true);
            $('remixPrompt').focus();
            return;
        }
        const accessCode = $('studioAccessCode').value.trim();
        if (!accessCode) {
            message('remixStatus', 'আপনার আলাদা Studio access code দিন। Gemini API key এখানে দেবেন না।', true);
            $('studioAccessCode').focus();
            return;
        }
        const payload = {
            prompt, aspectRatio: $('remixAspect').value,
            references: roles.filter(role => refs.has(role)).map(role => ({ role, mimeType: refs.get(role).mimeType, data: refs.get(role).data }))
        };
        const request = { controller: new AbortController(), cancelled: false, timedOut: false };
        state.request = request;
        state.busy = true;
        updateControls();
        message('remixStatus', 'ছবি তৈরি হচ্ছে। কিছু সময় লাগতে পারে…');
        let newURL;
        let focusAccess = false;
        const timer = setTimeout(() => { request.timedOut = true; request.controller.abort(); }, 130_000);
        try {
            const response = await fetch('/api/remix', {
                method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-Studio-Token': accessCode },
                body: JSON.stringify(payload), signal: request.controller.signal
            });
            let result;
            try { result = await response.json(); }
            catch { throw new Error('সার্ভারের উত্তর পড়া যায়নি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।'); }
            if (!response.ok) {
                focusAccess = response.status === 401;
                if (response.status === 503) checkConnection();
                throw new Error(typeof result.error === 'string' ? result.error.slice(0, 500) : 'ছবি তৈরি হয়নি। আবার চেষ্টা করুন।');
            }
            newURL = URL.createObjectURL(outputBlob(result.image));
            const decoded = new Image();
            decoded.src = newURL;
            try { await decoded.decode(); }
            catch { throw new Error('ফেরত আসা ছবিটি ব্রাউজারে খোলা যায়নি। আবার চেষ্টা করুন।'); }
            if (request.controller.signal.aborted) throw new Error('Cancelled');
            if (state.resultURL) URL.revokeObjectURL(state.resultURL);
            state.resultURL = newURL;
            newURL = null;
            $('remixResult').src = state.resultURL;
            $('remixResult').hidden = false;
            $('resultPlaceholder').hidden = true;
            $('resultActions').hidden = false;
            const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[result.image.mimeType];
            $('remixDownload').href = state.resultURL;
            $('remixDownload').download = `nahid-image-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
            $('resultMeta').textContent = `${decoded.naturalWidth} × ${decoded.naturalHeight} · ${extension.toUpperCase()}`;
            message('remixStatus', 'নতুন ছবি তৈরি হয়েছে। ডাউনলোড করে রাখুন; পেজ রিফ্রেশ করলে ছবিটি থাকবে না।');
        } catch (error) {
            if (request.cancelled) message('remixStatus', 'অপেক্ষা বন্ধ করা হয়েছে। Gemini ইতিমধ্যে কাজ শুরু করলে খরচ প্রযোজ্য হতে পারে। আপনার আগের কাজ অক্ষত আছে।');
            else if (request.timedOut) message('remixStatus', 'অপেক্ষার সময় শেষ। কিছুক্ষণ পরে আবার চেষ্টা করুন।', true);
            else message('remixStatus', error instanceof TypeError ? 'ইমেজ সার্ভারে সংযোগ করা যায়নি। নেটওয়ার্ক পরীক্ষা করুন।' : error.message, true);
        } finally {
            clearTimeout(timer);
            if (newURL) URL.revokeObjectURL(newURL);
            state.request = null;
            state.busy = false;
            updateControls();
            if (focusAccess) $('studioAccessCode').focus();
        }
    });
    $('cancelRemix').addEventListener('click', () => {
        if (state.request) {
            state.request.cancelled = true;
            state.request.controller.abort();
        }
    });
    $('resetRemix').addEventListener('click', () => {
        if (state.busy) return;
        const hasWork = refs.size || state.pendingUploads || $('remixPrompt').value || state.resultURL;
        if (hasWork && !window.confirm('এই স্টুডিওর রেফারেন্স, প্রম্পট ও তৈরি ছবি মুছবেন? দরকার হলে আগে ছবি ডাউনলোড করুন। অন্য স্টুডিওর কাজ মুছবে না।')) return;
        for (const role of roles) clearReference(role);
        if (state.resultURL) URL.revokeObjectURL(state.resultURL);
        state.resultURL = null;
        $('remixResult').hidden = true;
        $('remixResult').removeAttribute('src');
        $('remixDownload').removeAttribute('href');
        $('resultActions').hidden = true;
        $('resultPlaceholder').hidden = false;
        $('resultMeta').textContent = 'RESULT';
        $('remixPrompt').value = '';
        $('remixAspect').value = '1:1';
        saveDraft();
        message('uploadStatus', 'JPG, PNG বা WEBP বেছে নিন, অথবা ঘরে টেনে আনুন।');
        message('remixStatus', 'এই কাজ মুছে ফেলা হয়েছে। নতুনভাবে শুরু করুন।');
        $('remixPrompt').focus();
    });
    checkConnection();
})();
