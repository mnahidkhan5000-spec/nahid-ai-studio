(() => {
    'use strict';
    const editor = document.getElementById('htmlCode');
    const preview = document.getElementById('htmlPreview');
    const status = document.getElementById('htmlStatus');
    const storageKey = 'nahid-html-studio-draft';
    const page = (title, content) => `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 20px; background: #eef2ff; color: #172554; font-family: system-ui, sans-serif; }
  main { max-width: 600px; margin: auto; padding: 32px; background: white; border-radius: 20px; box-shadow: 0 12px 40px #17255418; }
  h1 { line-height: 1.3; }
  p { line-height: 1.8; color: #475569; }
  a { display: inline-block; padding: 12px 20px; background: #2563eb; color: white; border-radius: 10px; text-decoration: none; }
  .tag { color: #2563eb; font-weight: bold; }
</style>
</head>
<body>
<main>
${content}
</main>
</body>
</html>`;
    const templates = {
        welcome: page('আমার ওয়েব পেজ', '  <p class="tag">NAHID AI STUDIO</p>\n  <h1>আমার নতুন ওয়েব পেজে স্বাগতম!</h1>\n  <p>এই লেখা বদলে আপনার নিজের HTML ডিজাইন তৈরি করুন। রং, শিরোনাম ও স্টাইল পরিবর্তন করে প্রিভিউ দেখুন।</p>\n  <a href="#details">আরও জানুন</a>\n  <p id="details">এখানে আপনার বিস্তারিত তথ্য লিখুন।</p>'),
        portfolio: page('আমার পোর্টফোলিও', '  <p class="tag">আমার পরিচয়</p>\n  <h1>হ্যালো, আমি নাহিদ</h1>\n  <p>আমি নতুন ডিজাইন ও প্রযুক্তি নিয়ে কাজ করতে ভালোবাসি।</p>\n  <h2>আমার দক্ষতা</h2>\n  <ul><li>ওয়েব ডিজাইন</li><li>HTML ও CSS</li><li>সৃজনশীল কাজ</li></ul>\n  <h2>যোগাযোগ</h2>\n  <p>এখানে আপনার যোগাযোগের তথ্য লিখুন।</p>'),
        landing: page('আমার প্রোডাক্ট', '  <p class="tag">নতুন কালেকশন</p>\n  <h1>আপনার আইডিয়া, সুন্দর একটি পেজ</h1>\n  <p>আপনার পণ্য বা সেবার বিশেষ সুবিধাগুলো এখানে তুলে ধরুন।</p>\n  <h2>কেন আমাদের বেছে নেবেন?</h2>\n  <ul><li>সহজ ব্যবহার</li><li>আধুনিক ডিজাইন</li><li>মোবাইল উপযোগী</li></ul>\n  <a href="#contact">বিস্তারিত দেখুন</a>\n  <p id="contact">অর্ডার বা যোগাযোগের নির্দেশনা এখানে লিখুন।</p>')
    };
    function saveDraft() {
        try {
            localStorage.setItem(storageKey, editor.value);
            return true;
        } catch (_) {
            return false;
        }
    }
    function render() {
        // No allow-scripts or allow-same-origin: user HTML cannot access the app.
        preview.srcdoc = editor.value;
        status.textContent = saveDraft()
            ? 'প্রিভিউ আপডেট হয়েছে। কোড এই ব্রাউজারে সংরক্ষিত আছে।'
            : 'প্রিভিউ আপডেট হয়েছে। ব্রাউজারে সংরক্ষণ সম্ভব হয়নি; ফাইল ডাউনলোড করে রাখুন।';
    }
    let initial = templates.welcome;
    try {
        const saved = localStorage.getItem(storageKey);
        if (saved !== null) initial = saved;
    } catch (_) { /* Storage may be disabled by the browser. */ }
    editor.value = initial;
    render();
    editor.addEventListener('input', () => {
        const saved = saveDraft();
        status.textContent = saved
            ? 'কোড সংরক্ষিত হয়েছে। পরিবর্তন দেখতে প্রিভিউ দেখুন চাপুন।'
            : 'সংরক্ষণ সম্ভব হয়নি। পরিবর্তন দেখতে প্রিভিউ দেখুন চাপুন।';
    });
    document.getElementById('renderHtml').addEventListener('click', render);
    document.getElementById('loadTemplate').addEventListener('click', () => {
        if (editor.value.trim() && !window.confirm('বর্তমান কোডের জায়গায় টেমপ্লেট বসাবেন? দরকার হলে আগে ডাউনলোড করুন।')) return;
        editor.value = templates[document.getElementById('htmlTemplate').value];
        render();
    });
    document.getElementById('clearHtml').addEventListener('click', () => {
        if (editor.value && !window.confirm('সব HTML কোড মুছে ফেলবেন?')) return;
        editor.value = '';
        render();
        editor.focus();
    });
    document.getElementById('downloadHtml').addEventListener('click', () => {
        if (!editor.value.trim()) {
            status.textContent = 'ডাউনলোড করার আগে HTML কোড লিখুন।';
            return;
        }
        const url = URL.createObjectURL(new Blob([editor.value], { type: 'text/html;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'nahid-web-page.html';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        status.textContent = 'HTML ফাইল ডাউনলোডের অনুরোধ পাঠানো হয়েছে।';
    });
    document.getElementById('htmlFile').addEventListener('change', async (event) => {
        const input = event.target;
        const file = input.files[0];
        if (!file) return;
        if (!/\.html?$/i.test(file.name) || file.size > 1024 * 1024) {
            status.textContent = '১ MB বা তার কম সাইজের .html বা .htm ফাইল বেছে নিন।';
            input.value = '';
            return;
        }
        if (editor.value.trim() && !window.confirm('বর্তমান কোডের জায়গায় ফাইলের কোড বসাবেন?')) {
            input.value = '';
            return;
        }
        try {
            editor.value = await file.text();
            render();
        } catch (_) {
            status.textContent = 'ফাইল পড়া সম্ভব হয়নি। আবার চেষ্টা করুন।';
        }
        input.value = '';
    });
})();
