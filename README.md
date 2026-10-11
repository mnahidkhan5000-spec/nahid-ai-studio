# Nahid AI Studio

একই অ্যাপে চারটি আলাদা কাজের জায়গা। ট্যাব বদলালে চলতি কাজ মুছবে না।

- **01 · Google Whisk:** আসল [Google Whisk](https://labs.google/fx/tools/whisk) নতুন ট্যাবে খোলে। এটি embed, proxy, Google login integration বা Whisk API নয়। Google-এর অ্যাকাউন্ট/দেশ/সেবার শর্ত প্রযোজ্য।
- **02 · নিজস্ব Image Studio:** Subject / Scene / Style রেফারেন্স, বাংলা/ইংরেজি নির্দেশনা, অনুপাত, প্রিভিউ ও ডাউনলোড। এটি স্বাধীন Gemini-ভিত্তিক workflow, Google Whisk নয়। ছবি ছাড়াও শুধু প্রম্পট দিয়ে অনুরোধ করা যায়।
- **আগের ইমেজ টুল:** পুরোনো Pollinations-নির্ভর generator রাখা আছে; এর বাহ্যিক সেবা বা পুরোনো quality/upscale দাবিগুলো এই আপডেটের পরীক্ষার আওতাভুক্ত নয়।
- **HTML স্টুডিও:** আগের editor, templates, import/download ও sandboxed preview অক্ষত আছে।

## চালু করুন

Node.js **22.9 বা নতুন** দরকার। সার্ভারের কোনো runtime npm dependency নেই।

```sh
cp .env.example .env
# নিজের সার্ভারে .env সম্পাদনা করুন (আসল key কখনো Git বা চ্যাটে দেবেন না)।
npm start
```

`http://localhost:3000`-এ অ্যাপ খুলুন। সার্ভার ডিফল্টে `0.0.0.0`-তে bind করে। Live preview-তে সরবরাহ করা HTTPS ঠিকানা ব্যবহার করুন। সব browser API request relative (`/api/...`), তাই ব্রাউজার sandbox-এর localhost-এ কল করে না।

### Image Studio-র একবারের সেটআপ

`.env` বা hosting provider-এর server-side environment settings-এ দিন:

| Variable | ব্যবহার |
| --- | --- |
| `GEMINI_API_KEY` | নিজের Gemini API key; নির্বাচিত image model-এর অনুমতি ও প্রয়োজনমতো billing/quota থাকতে হবে। ব্রাউজারে এটি লিখবেন না। |
| `GEMINI_IMAGE_MODEL` | ডিফল্ট `gemini-3.1-flash-image`; `generateContent`, image input/output ও `imageConfig.aspectRatio` সমর্থন করে এমন উপলভ্য Gemini image model বাছুন। |
| `STUDIO_ACCESS_TOKEN` | **আলাদা**, কমপক্ষে ১৬ অক্ষরের random access code। এই code-টিই অ্যাপের “Studio access code” ঘরে দেবেন, API key নয়। |
| `PORT` / `HOST` | ডিফল্ট `3000` / `0.0.0.0`। |

আলাদা access code তৈরি করতে নিজের terminal-এ চালান:

```sh
node -p "require('node:crypto').randomBytes(24).toString('hex')"
```

দুই secret এবং বৈধ model configuration ছাড়া server generation চালু করে না। সেটিংস বদলালে সার্ভার restart করে অ্যাপে **আবার পরীক্ষা করুন** চাপুন। Status indicator শুধু server configuration জানায়; provider key, model access ও quota প্রথম generation request-এ যাচাই হয়।

Gemini API key নিজের [Google AI Studio](https://aistudio.google.com/apikey) থেকে নিন। Provider reference: [Gemini image-generation docs](https://ai.google.dev/gemini-api/docs/image-generation) এবং [Google-এর image cookbook](https://github.com/google-gemini/cookbook/blob/main/quickstarts/Get_Started_Nano_Banana.ipynb)। Model availability/শর্ত বদলালে উপযুক্ত image model সেট করুন; কোনো free usage বা নির্দিষ্ট quality/resolution-এর নিশ্চয়তা নেই।

### Hosting ও সীমাবদ্ধতা

- **GitHub Pages বা শুধু `index.html` খুলে paid API চালানো যায় না।** সেখানে Whisk shortcut, reference previews, prompt drafting/copy এবং HTML editor চলবে; generation-এর জন্য Node backend প্রয়োজন। Node app হিসেবে frontend ও backend একই origin-এ deploy করুন।
- নিজের server থেকে `https://generativelanguage.googleapis.com`-এ outbound access লাগবে। এই Arena sandbox-এর outbound allowlist-এ Gemini নেই, তাই এখানে provider call বাস্তবে যাচাই করা যায়নি। UI/HTTP flow mock provider দিয়ে পরীক্ষা করা হয়েছে, live image generation দাবি করা হচ্ছে না।
- Internet-facing deployment-এ **HTTPS** ব্যবহার করুন। Access code শুধু আপনার বিশ্বাসযোগ্য ব্যবহারকারীদের দিন; এটি user-account system নয়। আলাদা user accounts, per-user billing, durable/distributed rate limiting বা বড় public service এই app-এ নেই।
- এই backend একসঙ্গে ১টি এবং প্রতি ১০ মিনিটে সর্বোচ্চ ১০টি generation attempt নেয় (প্রতি server process-এ shared limit)। Cancel/error হলেও provider কাজ শুরু করে থাকলে খরচ হতে পারে। ১ মিনিটে ২০টি ভুল access code হলে সাময়িকভাবে access requests বন্ধ হয়।
- ১২০ সেকেন্ডের provider timeout; client disconnect/cancel-এ upstream request abort করার চেষ্টা হয়। Provider-এ শুরু হওয়া কাজ/খরচ ফেরত যাওয়ার নিশ্চয়তা নেই।
- API key শুধু provider request-এর header-এ যায়। Browser শুধু আলাদা Studio access code পাঠায়, সেটিও localStorage-এ রাখা হয় না। Static serving একটি allowlist ব্যবহার করে: `.env`, `.git`, backend source ও অন্য repository files HTTP দিয়ে পাওয়া যায় না।
- `.env` কখনো commit করবেন না। Key ফাঁস হলে provider-এ গিয়ে তা revoke/rotate করুন।

## ব্যবহার

1. **নিজস্ব Image Studio** খুলুন। ইচ্ছেমতো Subject, Scene ও Style-এর একটি করে JPG/PNG/WEBP দিন, বা drag-and-drop করুন। কোনো role বাধ্যতামূলক নয়।
2. প্রতিটি ছবি সর্বোচ্চ ৫ MB। Browser preview-র জন্য প্রতি পাশে সর্বোচ্চ ৮১৯২ px এবং মোট সর্বোচ্চ ২৪ megapixel। Server MIME, base64 ও file signature যাচাই করে; original bytes provider-এ পাঠায়।
3. নির্দেশনা লিখুন (সর্বোচ্চ ২০০০ অক্ষর), অনুপাত বাছুন। API ছাড়া **প্রম্পট কপি**-ও ব্যবহার করা যায়। Whisk-এ নিলে ছবিগুলো সেখানে আলাদাভাবে upload করতে হবে।
4. API সেটআপ থাকলে Studio access code দিন, **ছবি তৈরি করুন** চাপুন। শুধু তখনই ছবি ও প্রম্পট server হয়ে Gemini-তে যায়। Google-এর data policies প্রযোজ্য; অনুমতিসহ ছবি ব্যবহার করুন।
5. ছবি তৈরি হলে প্রকৃত পাওয়া dimensions দেখাবে। **ছবি ডাউনলোড করুন** দিয়ে provider-এর ছবিই নামবে; কোনো ভুয়া upscaling বা watermark removal যোগ করা হয় না।
6. ইচ্ছেমতো tab বদলান। দুই studio-র অ্যাকাউন্ট/ছবি/history স্বয়ংক্রিয়ভাবে sync হয় না।

**Persistence:** প্রম্পট ও অনুপাত browser-local; HTML draft তার নিজস্ব storage key-তে থাকে। Upload ও output images শুধু চলতি পেজের memory-তে; tab বদলালে থাকে, reload/close করলে থাকে না। এই app server-এ ছবি/প্রম্পটের file বা request log রাখে না (hosting/provider-এর আলাদা retention policies থাকতে পারে)। “এই কাজ মুছুন” শুধু Image Studio-র কাজ পরিষ্কার করে।

## Tests

```sh
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:ui
```

Backend tests use Node's built-in test runner and **mock Gemini responses**, never live credentials or billable requests. Browser tests run the real app/server, mock provider configuration/generation when needed, and cover tab switching, files, drafts, validation, cancellation, errors, downloads, mobile layout, and the existing HTML sandbox.

An already-installed Chromium can be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium npm run test:ui`. No browser/test artifacts belong in Git.

## Font attribution

`assets/NotoSansBengali.ttf` is the unmodified variable Noto Sans Bengali font from [Google Fonts](https://github.com/google/fonts/tree/main/ofl/notosansbengali). Copyright 2022 The Noto Project Authors; licensed under SIL OFL 1.1, included at `assets/OFL-NotoSansBengali.txt`. It is served locally; no third-party font request is needed.
