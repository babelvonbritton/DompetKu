// DompetKu v1.0.2 — real-browser smoke test (Playwright).
// Run: SMOKE_URL=http://localhost:4173/ node scripts/smoke.mjs
// Uses the Playwright install from the Brewfolio tree (NODE_PATH).
import { chromium } from '/home/hatch/workspace/brewfolio-v110/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { unzipSync } from '/home/hatch/workspace/projects/dompetku/node_modules/fflate/esm/index.mjs';

const BASE = process.env.SMOKE_URL ?? 'http://localhost:4173/';
const OUT = '/home/hatch/workspace/dompetku-smoke';
mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// v1.0.2: Settings sections are collapsible and start folded. Expand one
// by its heading toggle; a no-op when it is already open.
async function expandSection(page, title) {
  const toggle = page.locator('.settings-section-toggle', { hasText: title });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
}

const browser = await chromium.launch();
try {
  // ---------- Mobile 390px ----------
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e)));
  // v1.0.0: fonts are self-hosted and a Content Security Policy limits
  // the app to its own origin plus Google's Gemini/Drive endpoints.
  // Any request to the old font hosts, or any CSP refusal, is a failure.
  const googleFontRequests = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
      googleFontRequests.push(url);
    }
  });
  const cspErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') {
      console.log('CONSOLE ERROR:', m.text());
      if (m.text().includes('Content Security Policy')) cspErrors.push(m.text());
    }
  });
  // v1.0.2: stub the Drive API so the Drive backup can be exercised
  // without a real Google sign-in (the token is seeded into IndexedDB
  // later, the same way a connected account leaves one behind).
  // A fetch override, not page.route: route interception breaks fetches
  // that go through the app's service worker (the favicon check failed
  // with "Failed to fetch" while a route was registered).
  await page.addInitScript(() => {
    const origFetch = window.fetch.bind(window);
    const calls = (window.__driveCalls = window.__driveCalls ?? []);
    window.fetch = async (...args) => {
      const url = String(args[0]);
      if (url.includes('www.googleapis.com')) {
        calls.push(`${args[1]?.method ?? 'GET'} ${url}`);
        if (url.includes('/drive/v3/files?')) {
          return new Response(JSON.stringify({ files: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.includes('/upload/drive/v3/files')) {
          return new Response(
            JSON.stringify({ id: 'smoke-file-id', modifiedTime: new Date().toISOString() }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('', { status: 404 });
      }
      return origFetch(...args);
    };
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });

  check('setup screen shows', await page.getByText('Buat dompet pertamamu').isVisible());
  await page.fill('#setup-name', 'Makan');
  await page.fill('#setup-budget', '2 juta');
  // Custom pickers are still native <select>s: choosing an option works
  // the same, and the value sticks.
  await page.selectOption('#setup-cycle', '25');
  await page.selectOption('#setup-warn', '70');
  check(
    'setup pickers accept a choice',
    (await page.locator('#setup-cycle').inputValue()) === '25' &&
      (await page.locator('#setup-warn').inputValue()) === '70',
  );
  await page.click('button[type="submit"]');
  await page.getByText('Sisa bulan ini').waitFor({ timeout: 5000 });
  // v0.2.8: browsers probe /favicon.ico on page load even with an SVG icon
  // declared — it must exist, or the console shows a bare 404.
  const faviconStatus = await page.evaluate(
    async () => (await fetch('/favicon.ico')).status,
  );
  check('favicon.ico served (no console 404)', faviconStatus === 200, `status=${faviconStatus}`);
  check('dashboard after setup', true);
  const balance = await page.locator('.balance-value').innerText();
  check('balance is Rp2.000.000', balance.includes('2.000.000'), balance);
  await page.screenshot({ path: `${OUT}/dashboard-390.png` });

  // Chat: key reminder + log expense
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByText('Pasang kunci API Gemini').waitFor({ timeout: 5000 });
  check('key reminder visible (no key set)', true);
  await page.fill('#chat-input', 'Makan siang 45rb');
  await page.getByRole('button', { name: 'Kirim pesan' }).click();
  await page.getByText('Sudah dicatat.').waitFor({ timeout: 5000 });
  check('expense logged via chat', true);
  const cardText = await page.locator('.msg.assistant .card').first().innerText();
  check('log card shows Rp45.000', cardText.includes('Rp45.000'), cardText.replace(/\n/g, ' | '));

  // v0.2.8: slash-command menu — type '/', suggestions appear, click one.
  await page.fill('#chat-input', '/');
  await page.locator('#slash-menu').waitFor({ timeout: 5000 });
  check('slash menu shows all 7 commands', (await page.locator('.slash-option').count()) === 7);
  await page.fill('#chat-input', '/si');
  await page.waitForTimeout(200);
  // '/si' matches /sisa and /catat ('siang' in its description).
  check('slash menu narrows to matching commands', (await page.locator('.slash-option').count()) === 2);
  await page.locator('.slash-option', { hasText: '/sisa' }).click();
  check('clicking a suggestion inserts it', (await page.locator('#chat-input').inputValue()) === '/sisa');
  await page.fill('#chat-input', '/');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  check('keyboard picks the first suggestion', (await page.locator('#chat-input').inputValue()) === '/catat ');
  await page.fill('#chat-input', '/catat ');
  check('menu closes once the command is chosen', (await page.locator('#slash-menu').count()) === 0);
  await page.fill('#chat-input', '');

  // Ask spending today
  await page.fill('#chat-input', 'Berapa pengeluaranku hari ini?');
  await page.getByRole('button', { name: 'Kirim pesan' }).click();
  await page.getByText('Pengeluaran hari ini: Rp45.000.').waitFor({ timeout: 5000 });
  check('ask spent today answers Rp45.000', true);

  // Ask budget left
  await page.fill('#chat-input', 'Berapa sisa anggaranku?');
  await page.getByRole('button', { name: 'Kirim pesan' }).click();
  await page.getByText('Rp1.955.000 lagi').waitFor({ timeout: 5000 });
  check('ask budget left answers Rp1.955.000', true);

  // Warning path: push past 80%
  await page.fill('#chat-input', 'Makan malam 1,6jt');
  await page.getByRole('button', { name: 'Kirim pesan' }).click();
  await page.getByText('Hati-hati', { exact: false }).first().waitFor({ timeout: 5000 });
  check('warn message appears past 80%', true);
  await page.screenshot({ path: `${OUT}/chat-390.png` });

  // Keyboard check: focus composer, it must stay inside the viewport.
  await page.click('#chat-input');
  const box = await page.locator('#chat-input').boundingBox();
  const viewport = page.viewportSize();
  check(
    'composer visible after focus',
    box !== null && viewport !== null && box.y + box.height <= viewport.height + 1,
    box ? `y=${Math.round(box.y)} h=${Math.round(box.height)} vh=${viewport?.height}` : 'no box',
  );
  const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute('content');
  check(
    'viewport uses interactive-widget=resizes-content',
    (viewportMeta ?? '').includes('interactive-widget=resizes-content'),
    viewportMeta ?? '',
  );

  // ---------- v0.2.8: second wallet + disambiguation ----------
  await page.getByRole('button', { name: 'Dompet', exact: true }).click();
  await page.getByRole('button', { name: '+ Tambah dompet' }).click();
  // The form ids contain the save label ("Buat dompet"), so use attribute selectors.
  await page.locator('[id="wf-name-Buat dompet"]').fill('Transportasi');
  await page.locator('[id="wf-budget-Buat dompet"]').fill('500rb');
  await page.selectOption('[id="wf-cycle-Buat dompet"]', '31');
  await page.selectOption('[id="wf-warn-Buat dompet"]', '70');
  check(
    'wallet form pickers accept a choice (cycle day 31)',
    (await page.locator('[id="wf-cycle-Buat dompet"]').inputValue()) === '31' &&
      (await page.locator('[id="wf-warn-Buat dompet"]').inputValue()) === '70',
  );
  await page.getByRole('button', { name: 'Buat dompet', exact: true }).click();
  await page.getByText('Transportasi', { exact: true }).first().waitFor({ timeout: 5000 });
  check('second wallet created', true);

  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.fill('#chat-input', 'Beli kopi 25rb');
  await page.getByRole('button', { name: 'Kirim pesan' }).click();
  await page.getByText('Masuk ke dompet mana?').waitFor({ timeout: 5000 });
  check('bot asks which wallet with two wallets', true);
  await page.getByRole('button', { name: 'Transportasi', exact: true }).click();
  await page.getByText('Sudah dicatat.').nth(2).waitFor({ timeout: 5000 });
  check('expense lands in the named wallet', true);
  await page.screenshot({ path: `${OUT}/chat-disambiguation-390.png` });

  // Dashboard warning strip (use the dashboard wording, not the chat
  // warning, which also contains "Makan sudah 82%").
  await page.getByRole('button', { name: 'Beranda', exact: true }).click();
  await page.getByText('Dompet Makan sudah 82% terpakai').waitFor({ timeout: 5000 });
  check('warning strip on dashboard', true);
  await page.getByText('Rp355.000 lagi').waitFor({ timeout: 5000 });
  check('wallet card shows Rp355.000 lagi', true);

  // History (wait for the tab to render through the view transition).
  await page.getByRole('button', { name: 'Riwayat', exact: true }).click();
  await page.getByText('Makan siang').waitFor({ timeout: 5000 });
  check('history shows Makan siang', true);
  check('history shows Makan malam', await page.getByText('Makan malam').isVisible());
  // The note drops filler verbs, so "Beli kopi 25rb" is stored as "kopi".
  // (Substring match: the note shares its span with the small meta line.)
  check('history shows kopi', await page.getByText('kopi').isVisible());

  // Settings: key guide + Drive section + local backup download
  await page.getByRole('button', { name: 'Pengaturan', exact: true }).click();
  // v1.0.2: sections start folded; the page reads as a short list of
  // headings, and each opens from its own toggle.
  await page.locator('.settings-section-toggle').first().waitFor({ timeout: 5000 });
  check(
    'settings sections start folded',
    (await page.locator('.settings-section-toggle').count()) === 6 &&
      (await page.locator('.settings-section-toggle[aria-expanded="true"]').count()) === 0,
  );
  await expandSection(page, 'Kunci API Gemini');
  check(
    'expanding a section shows its content',
    await page.locator('#api-key').isVisible(),
  );
  check(
    'API key guide link present',
    await page.getByRole('link', { name: 'aistudio.google.com/apikey' }).isVisible(),
  );
  // v0.2.8: the parser fallback toggle is locked on without a key.
  check(
    'parser fallback toggle is locked on without a key',
    (await page.locator('#parser-fallback').isDisabled()) &&
      (await page.locator('#parser-fallback').isChecked()),
  );
  // v0.2.8: the toggle is a compact native switch (40x24), not a
  // full-width pill — label + hint on the left, switch on the right.
  const switchBox = await page.locator('#parser-fallback').boundingBox();
  const switchAttrs = await page.evaluate(() => {
    const el = document.querySelector('#parser-fallback');
    return {
      role: el?.getAttribute('role'),
      hasSwitch: el?.hasAttribute('switch'),
    };
  });
  check(
    'parser toggle is a small switch',
    switchAttrs.role === 'switch' &&
      switchAttrs.hasSwitch === true &&
      (switchBox?.width ?? 999) <= 48 &&
      (switchBox?.height ?? 999) <= 32,
    `role=${switchAttrs.role} w=${Math.round(switchBox?.width ?? 0)} h=${Math.round(switchBox?.height ?? 0)}`,
  );
  // v0.2.8: the default model is the current cheap one (2.5 is limited to
  // keys that already used it — a fresh key gets a 404 for it).
  check(
    'default model is gemini-3.5-flash-lite',
    (await page.locator('#api-model').inputValue()) === 'gemini-3.5-flash-lite',
  );
  await expandSection(page, 'Tampilan awal');
  check(
    'launch tab choices present',
    (await page.getByText('Beranda', { exact: true }).count()) >= 1,
  );
  await expandSection(page, 'Google Drive');
  await page.getByText('Hubungkan Google Drive').waitFor({ timeout: 5000 });
  check('Drive section visible', true);
  check(
    'Drive backup/restore buttons present',
    (await page.getByRole('button', { name: 'Cadangkan ke Drive' }).isVisible()) &&
      (await page.getByRole('button', { name: 'Pulihkan dari Drive' }).isVisible()),
  );
  check(
    'Drive backup/restore still disabled while signed out',
    (await page.getByRole('button', { name: 'Cadangkan ke Drive' }).isDisabled()) &&
      (await page.getByRole('button', { name: 'Pulihkan dari Drive' }).isDisabled()),
  );
  // v0.2.8: Drive actions stack full-width — each button on its own line,
  // labels on one line, no squeeze.
  const driveBoxes = await Promise.all(
    ['Hubungkan Google Drive', 'Cadangkan ke Drive', 'Pulihkan dari Drive'].map(
      async (name) => (await page.getByRole('button', { name, exact: true }).boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 },
    ),
  );
  const stacked =
    driveBoxes[0].y < driveBoxes[1].y &&
    driveBoxes[1].y < driveBoxes[2].y &&
    driveBoxes.every((b) => b.width > 200);
  check('Drive actions stack full-width', stacked, driveBoxes.map((b) => `y=${Math.round(b.y)} w=${Math.round(b.width)}`).join(' '));
  const fileBtnBg = await page.evaluate(() => {
    const input = document.querySelector('#import-file');
    return input ? getComputedStyle(input, '::file-selector-button').backgroundColor : '';
  });
  check('file picker button wears the theme', fileBtnBg === 'rgb(12, 59, 46)', fileBtnBg);
  await page.screenshot({ path: `${OUT}/settings-390.png` });

  // v1.0.0: two password fields, 8-char alphanumeric rule, step progress,
  // and a plain-ZIP backup with a v3 manifest (no more DMPT envelope).
  await expandSection(page, 'Cadangkan & pulihkan');
  check(
    'backup has a confirmation field',
    (await page.locator('#export-pass-confirm').count()) === 1,
  );
  await page.fill('#export-pass', 'abc123');
  await page.fill('#export-pass-confirm', 'abc123');
  await page.getByRole('button', { name: 'Unduh cadangan' }).click();
  check(
    'short backup password is rejected',
    await page.getByText('Kata sandi minimal 8 karakter.').isVisible(),
  );
  await page.fill('#export-pass', 'rahasia123');
  await page.fill('#export-pass-confirm', 'rahasia124');
  await page.getByRole('button', { name: 'Unduh cadangan' }).click();
  check(
    'mismatched confirmation is rejected',
    await page.getByText('Konfirmasi kata sandi tidak cocok.').isVisible(),
  );
  await page.fill('#export-pass-confirm', 'rahasia123');
  const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
  await page.getByRole('button', { name: 'Unduh cadangan' }).click();
  const download = await downloadPromise;
  const backupPath = `${OUT}/dompetku-cadangan.dompetku`;
  await download.saveAs(backupPath);
  const backupBytes = readFileSync(backupPath);
  check(
    'backup download is a ZIP',
    backupBytes.subarray(0, 2).toString('ascii') === 'PK',
    `bytes=${backupBytes.length}`,
  );
  const backupFiles = unzipSync(backupBytes);
  const manifest = JSON.parse(
    new TextDecoder().decode(backupFiles['manifest.json']),
  );
  check(
    'backup manifest is format 3 with checksums',
    manifest.format === 'dompetku-backup' &&
      manifest.formatVersion === 3 &&
      manifest.encryption.iterations === 310000 &&
      typeof manifest.stores.wallets.sha256 === 'string',
    `format=${manifest.format} v=${manifest.formatVersion}`,
  );
  check(
    'export steps are shown',
    (await page.getByText('Mengemas cadangan').isVisible()) &&
      (await page.getByText('Memverifikasi cadangan').isVisible()),
  );

  // v1.0.0: importing the just-made backup finds the data up to date.
  await page.getByRole('button', { name: 'Pengaturan', exact: true }).click();
  await expandSection(page, 'Cadangkan & pulihkan');
  await page.fill('#import-pass', 'rahasia123');
  await page.setInputFiles('#import-file', backupPath);
  await page.getByText('Datamu sudah sama dengan cadangan').waitFor({ timeout: 15000 });
  check('identical backup shows the up-to-date toast', true);

  // v1.0.0: a changed backup opens the review dialog, not a silent replace.
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.fill('#chat-input', 'Beli teh 15rb');
  await page.getByRole('button', { name: 'Kirim pesan' }).click();
  await page.getByText('Masuk ke dompet mana?').waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Makan', exact: true }).click();
  await page.getByText('Sudah dicatat.').nth(3).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Pengaturan', exact: true }).click();
  await expandSection(page, 'Cadangkan & pulihkan');
  await page.fill('#import-pass', 'rahasia123');
  await page.setInputFiles('#import-file', backupPath);
  await page.getByRole('heading', { name: 'Pulihkan cadangan?' }).waitFor({ timeout: 15000 });
  check('review dialog opens for a differing backup', true);
  check(
    'review shows the counts on both sides',
    (await page.getByRole('cell', { name: '3', exact: true }).count()) >= 1,
  );
  await page.getByRole('button', { name: 'Batal', exact: true }).click();
  await page.getByRole('button', { name: 'Riwayat', exact: true }).click();
  await page.getByText('teh').waitFor({ timeout: 5000 });
  check('cancel keeps the current data', true);
  await page.getByRole('button', { name: 'Pengaturan', exact: true }).click();
  await expandSection(page, 'Cadangkan & pulihkan');
  await page.fill('#import-pass', 'rahasia123');
  await page.setInputFiles('#import-file', backupPath);
  await page.getByRole('heading', { name: 'Pulihkan cadangan?' }).waitFor({ timeout: 15000 });
  await page.getByLabel(/Simpan cadangan pengaman/).uncheck();
  await page.getByRole('button', { name: 'Pulihkan cadangan', exact: true }).click();
  await page.getByText('Cadangan dipulihkan.').waitFor({ timeout: 15000 });
  check('apply restores the backup', true);
  await page.getByRole('button', { name: 'Riwayat', exact: true }).click();
  await page.waitForTimeout(500);
  check(
    'the post-backup expense is gone after the restore',
    (await page.getByText('teh').count()) === 0,
  );

  // v1.0.2: Drive backup really uploads now (the fetch binding fix) and
  // reports in its own section — stubbed Drive API, token seeded the way
  // a connected account leaves one behind.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('dompetku');
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const getAll = store.getAll();
      getAll.onsuccess = () => {
        const rows = getAll.result;
        if (!rows.length) { reject(new Error('no settings row')); return; }
        store.put({ ...rows[0], driveAccessToken: 'smoke-token', driveTokenExpiresAt: Date.now() + 3600_000 });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      getAll.onerror = () => reject(getAll.error);
    };
    open.onerror = () => reject(open.error);
  }));
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Pengaturan', exact: true }).click();
  await expandSection(page, 'Google Drive');
  await page.getByText('Status: Terhubung').waitFor({ timeout: 5000 });
  await expandSection(page, 'Cadangkan & pulihkan');
  await page.fill('#export-pass', 'rahasia123');
  await page.fill('#export-pass-confirm', 'rahasia123');
  await expandSection(page, 'Google Drive');
  await page.getByRole('button', { name: 'Cadangkan ke Drive' }).click();
  await page.getByText('Cadangan tersimpan di Google Drive.').waitFor({ timeout: 15000 });
  check('Drive backup reports success in its section', true);
  const driveCalls = await page.evaluate(() => window.__driveCalls ?? []);
  check(
    'Drive backup really called the Drive API',
    driveCalls.some((c) => c.includes('/upload/drive/v3/files')),
    driveCalls.join(' | '),
  );
  check(
    'Drive backup updates the last-backup date',
    ((await page.locator('section[aria-labelledby="drive-heading"] p').first().textContent()) ?? '').includes('cadangan terakhir'),
  );

  // v1.0.0: About carries the version and the copyright.
  await page.getByRole('button', { name: 'Pengaturan', exact: true }).click();
  await expandSection(page, 'Tentang');
  check(
    'About shows DompetKu 1.0.2',
    await page.getByText('DompetKu 1.0.2').isVisible(),
  );
  check(
    'About shows the copyright',
    await page.getByText('© 2026 Alzam A. Hak cipta dilindungi.').isVisible(),
  );

  await expandSection(page, 'Privasi');
  await page.getByRole('button', { name: 'Baca kebijakan privasi' }).click();
  check(
    'privacy policy page opens',
    await page.getByText('Kebijakan Privasi').isVisible(),
  );
  check(
    'privacy covers Drive backup',
    await page.getByText('Cadangan Google Drive').isVisible(),
  );

  // v0.2.8: category customization moved out of Settings into the chat
  // settings sheet (gear button in the chat header).
  check(
    'categories no longer live in Settings',
    (await page.getByText('Kategori', { exact: true }).count()) === 0,
  );

  // v0.2.8: category customization — add Jajan in the sheet, use it in
  // chat, delete it from the sheet.
  await page.getByRole('button', { name: 'Kembali' }).click();
  await page.getByRole('button', { name: 'Pengaturan', exact: true }).click();
  await expandSection(page, 'Google Drive');
  // The Drive account is still connected from the v1.0.2 backup block
  // above, so the Hubungkan button is gone — the status line proves the
  // section is open.
  await page.getByText('Status: Terhubung').waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByRole('button', { name: 'Pengaturan chat' }).click();
  await page.getByRole('heading', { name: 'Pengaturan chat' }).waitFor({ timeout: 5000 });
  check('chat settings sheet opens from the gear button', true);
  await page.fill('#category-new-name', 'Jajan');
  await page.getByRole('button', { name: 'Tambah kategori' }).click();
  await page.locator('.category-list li', { hasText: 'Jajan' }).waitFor({ timeout: 5000 });
  check('custom category Jajan added', true);
  await page.getByRole('button', { name: 'Tutup pengaturan chat' }).click();
  await page.getByRole('button', { name: 'Pengaturan chat' }).waitFor({ state: 'visible', timeout: 5000 });
  await page.fill('#chat-input', 'Beli jajan 20rb');
  await page.getByRole('button', { name: 'Kirim pesan' }).click();
  // Two disambiguation prompts exist by now (the earlier 'teh' one from
  // the v1.0.0 restore flow), so wait for the newest one.
  await page.getByText('Masuk ke dompet mana?').last().waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Makan', exact: true }).click();
  await page.getByText('Makan · Jajan').waitFor({ timeout: 5000 });
  check('expense lands in the custom category', true);
  await page.getByRole('button', { name: 'Riwayat', exact: true }).click();
  await page.getByText('Jajan · Makan', { exact: false }).first().waitFor({ timeout: 5000 });
  check('history shows the custom category', true);
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByRole('button', { name: 'Pengaturan chat' }).click();
  await page.locator('.category-list li', { hasText: 'Jajan' }).waitFor({ timeout: 5000 });
  const jajanRow = page.locator('.category-list li', { hasText: 'Jajan' });
  await jajanRow.getByRole('button', { name: 'Hapus', exact: true }).click();
  await jajanRow.getByRole('button', { name: /^Yakin hapus\?/ }).click();
  await page.locator('.category-list li', { hasText: 'Jajan' }).waitFor({ state: 'detached', timeout: 5000 });
  check('custom category deleted', true);
  await page.getByRole('button', { name: 'Tutup pengaturan chat' }).click();
  await page.getByRole('button', { name: 'Riwayat', exact: true }).click();
  await page.getByText('Lainnya · Makan', { exact: false }).first().waitFor({ timeout: 5000 });
  check('deleted category moves its expenses to Lainnya', true);

  // v0.2.8: clear chat — messages go, expenses stay.
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.fill('#chat-input', 'Makan siang 45rb');
  await page.getByRole('button', { name: 'Kirim pesan' }).click();
  await page.locator('.card-title', { hasText: 'Makan siang' }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Pengaturan chat' }).click();
  await page.getByRole('button', { name: 'Hapus riwayat chat' }).click();
  await page.getByRole('heading', { name: 'Hapus semua pesan?' }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'Hapus semua' }).click();
  await page.getByText('Halo. Tulis pengeluaranmu').waitFor({ timeout: 5000 });
  check('clear chat empties the chat', true);
  await page.getByRole('button', { name: 'Riwayat', exact: true }).click();
  await page.getByText('Makan siang', { exact: false }).first().waitFor({ timeout: 5000 });
  check('clear chat keeps the expenses', true);

  // v0.2.8: a price question is not a spending report. Without a key the
  // parser must send it to guided help, never to an expense summary.
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.fill('#chat-input', 'rata rata harga sushi berapa?');
  await page.getByRole('button', { name: 'Kirim pesan' }).click();
  await page.getByText('Aku belum paham kalimat itu').waitFor({ timeout: 5000 });
  const lastReply = await page.locator('.msg.assistant p').last().textContent();
  check(
    'price question gets guided help, not a spending report',
    (lastReply ?? '').includes('belum paham'),
  );

  // v1.0.0: no request ever leaves for the old font hosts, and the CSP
  // never refused anything during the whole run.
  check(
    'no request to Google Fonts (fonts are self-hosted)',
    googleFontRequests.length === 0,
    googleFontRequests.join(', '),
  );
  check(
    'no Content Security Policy refusal',
    cspErrors.length === 0,
    cspErrors.join(' | '),
  );

  // ---------- Desktop 1280px (same context: data must persist) ----------
  const page2 = await ctx.newPage();
  await page2.setViewportSize({ width: 1280, height: 800 });
  await page2.goto(BASE, { waitUntil: 'networkidle' });
  check('desktop loads dashboard (persisted)', await page2.getByText('Sisa bulan ini').isVisible());
  await page2.screenshot({ path: `${OUT}/dashboard-1280.png` });
  await ctx.close();
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.log('Failed:', failed.map((f) => f.name).join(', '));
  process.exitCode = 1;
}
