// scripts/take-screenshots.mjs
//
// Cattura gli screenshot dell'app Gestimus per il manuale admin.
//
// Prerequisiti:
//   - PocketBase ente1 attivo (http://ente1.test:8000)
//   - Seed dati eseguito: `node scripts/seed-demo-manual.js`
//   - Playwright installato (`@playwright/test`)
//
// Uso:
//   node scripts/take-screenshots.mjs
//
// Output: PNG in docs/screenshots/

import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(PROJECT_ROOT, 'docs', 'screenshots');
const BASE = process.env.APP_BASE || 'http://ente1.test:8000';
const ADMIN_EMAIL = 'admin@ente1.test';
const ADMIN_PWD = 'admin123';
const COM_EMAIL = 'commissario@demo.local';
const COM_PWD = 'Demo1234!';

fs.mkdirSync(OUT_DIR, { recursive: true });

function out(name) { return path.join(OUT_DIR, name); }

async function snap(page, name) {
  const file = out(name);
  await page.screenshot({ path: file, fullPage: false });
  console.log('  · ' + name);
}

async function setItalian(page) {
  await page.evaluate(() => { try { localStorage.setItem('gc_lang', 'it'); } catch {} });
}

async function login(page, email, password) {
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
  // Se già loggato, logout
  const logout = page.locator('button:has-text("Esci"), [data-action="logout"]').first();
  if (await logout.count().catch(() => 0)) {
    try { await logout.click({ timeout: 1500 }); } catch {}
    await page.waitForTimeout(500);
  }
  await setItalian(page);
  await page.reload({ waitUntil: 'networkidle' });
  // Trova form login
  await page.waitForSelector('input[type="email"], input[name="email"], input[name="identity"]', { timeout: 8000 });
  const emailInp = page.locator('input[type="email"], input[name="email"], input[name="identity"]').first();
  await emailInp.fill(email);
  const pwdInp = page.locator('input[type="password"]').first();
  await pwdInp.fill(password);
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.locator('button[type="submit"], button:has-text("Accedi"), button:has-text("Entra")').first().click(),
  ]);
  await page.waitForTimeout(800);
}

async function enterAdminWithConcorso(page) {
  // Va su home, clicca tile Admin, poi clicca [data-pick] sul concorso selector.
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const adminTile = page.locator('[data-action="role-admin"]').first();
  if (await adminTile.count().catch(() => 0)) {
    await adminTile.click({ timeout: 2000 });
    await page.waitForTimeout(800);
  }
  // Ora siamo su renderConcorsoSelector → pulsanti [data-pick="<id>"]
  const pick = page.locator('[data-pick]').first();
  if (await pick.count().catch(() => 0)) {
    await pick.click({ timeout: 2000 });
    await page.waitForTimeout(900);
  }
}

async function logout(page) {
  // Apri il menu utente se presente, poi click su Esci
  const menuToggle = page.locator('[data-user-menu], button:has(svg)').first();
  // Strategia rapida: vai a #/ poi cerca pulsante Esci visibile
  await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const tryButtons = [
    'button:has-text("Esci")',
    'button:has-text("Logout")',
    '[data-action="logout"]',
  ];
  for (const sel of tryButtons) {
    const btn = page.locator(sel).first();
    if (await btn.count().catch(() => 0)) {
      try { await btn.click({ timeout: 1500 }); await page.waitForTimeout(600); return; } catch {}
    }
  }
  // Fallback: pulisci storage e ricarica
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
  await page.reload({ waitUntil: 'networkidle' });
}

// Stato per ricordare l'ultimo tab impostato (evita di settare lo stesso tab di
// nuovo, che fa scattare il fallback in app.js che resetta role=null).
let _lastTab = null;

async function goAdminTab(page, tab) {
  // Cambia la hash SENZA navigare (evita reload completo): triggera hashchange
  // → render() che porta al tab voluto, mantenendo lo stato in-memory di db.
  // Workaround per bug app.js: se l'HTML del root non cambia (es. siamo già
  // sul tab) viene fatto fallback su home + setRole(null), perdendo lo stato.
  // Strategia: passiamo SEMPRE per un tab "ponte" diverso sia dall'attuale che
  // dal target, prima di andare al target.
  const allTabs = ['fasi', 'sezioni', 'commissari', 'commissioni', 'iscrizioni', 'candidati', 'risultati', 'audit'];
  const bridge = allTabs.find(t => t !== tab && t !== _lastTab) || 'sezioni';
  await page.evaluate((b) => { location.hash = `#/admin?tab=${b}`; }, bridge);
  await page.waitForTimeout(400);
  await page.evaluate((t) => { location.hash = `#/admin?tab=${t}`; }, tab);
  await page.waitForTimeout(900);
  _lastTab = tab;
}

async function ensureActiveConcorso(page) {
  await page.goto(`${BASE}/#/admin`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  // Se è il selector, clicca sulla prima card
  const selectorCard = page.locator('[data-action="select-concorso"], a:has-text("Concorso")').first();
  if (await selectorCard.count().catch(() => 0)) {
    try {
      const btn = page.locator('button:has-text("Apri"), a:has-text("Apri"), [data-concorso-id]').first();
      if (await btn.count().catch(() => 0)) {
        await btn.click({ timeout: 1500 });
        await page.waitForTimeout(800);
      }
    } catch {}
  }
}

(async () => {
  const errs = [];
  const skip = [];
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // -------- 01: login --------
  try {
    await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
    // Pulisci eventuali sessioni precedenti e setta lingua IT
    await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('gc_lang', 'it'); } catch {} });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('input[type="email"], input[name="email"], input[name="identity"]', { timeout: 8000 });
    await snap(page, '01-login.png');
  } catch (e) { errs.push(['01-login', e.message]); }

  // -------- Login admin --------
  await login(page, ADMIN_EMAIL, ADMIN_PWD);

  // -------- 02: home admin (dashboard tile) --------
  try {
    await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await snap(page, '02-home-admin.png');
  } catch (e) { errs.push(['02-home-admin', e.message]); }

  // -------- 03: concorso selector --------
  try {
    // Va su home, clicca tile Admin senza aprire il concorso
    await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const adminTile = page.locator('[data-action="role-admin"]').first();
    if (await adminTile.count().catch(() => 0)) {
      await adminTile.click({ timeout: 2000 });
      await page.waitForTimeout(800);
    }
    // Ora siamo su /admin senza concorso → renderConcorsoSelector
    await snap(page, '03-concorso-selector.png');
  } catch (e) { errs.push(['03-concorso-selector', e.message]); }

  // -------- Entra nel concorso per i tab successivi --------
  await enterAdminWithConcorso(page);

  // -------- 04: sidebar admin (parte di pagina con sidebar visibile) --------
  try {
    await goAdminTab(page, 'fasi');
    await snap(page, '04-sidebar-admin.png');
  } catch (e) { errs.push(['04-sidebar-admin', e.message]); }

  // -------- 05: sezioni tab --------
  try {
    await goAdminTab(page, 'sezioni');
    await snap(page, '05-sezioni-tab.png');
  } catch (e) { errs.push(['05-sezioni-tab', e.message]); }

  // -------- 06: commissari tab --------
  try {
    await goAdminTab(page, 'commissari');
    await snap(page, '06-commissari-tab.png');
  } catch (e) { errs.push(['06-commissari-tab', e.message]); }

  // -------- 07: commissioni tab --------
  try {
    await goAdminTab(page, 'commissioni');
    await snap(page, '07-commissioni-tab.png');
  } catch (e) { errs.push(['07-commissioni-tab', e.message]); }

  // -------- 08: fasi vista raggruppata (gruppo Pianoforte con sotto-fasi) --------
  try {
    await goAdminTab(page, 'fasi');
    // Scroll al gruppo Pianoforte se presente
    const piano = page.locator('h3:has-text("Pianoforte"), [data-group-key*="w2qfpt"]').first();
    if (await piano.count().catch(() => 0)) {
      await piano.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
    }
    await snap(page, '08-fasi-vista-raggruppata.png');
  } catch (e) { errs.push(['08-fasi-vista-raggruppata', e.message]); }

  // -------- 09: fasi guida aperta (<details> in cima) --------
  try {
    await goAdminTab(page, 'fasi');
    await page.evaluate(() => {
      // Apri tutti i <details> nella tab fasi (la guida è il primo)
      document.querySelectorAll('details').forEach(d => d.setAttribute('open', ''));
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, 0));
    await snap(page, '09-fasi-guida-aperta.png');
  } catch (e) { errs.push(['09-fasi-guida-aperta', e.message]); }

  // -------- 10/11/12: wizard fase --------
  // Per innescare il wizard "vuoto" (con i 4 template), serve un GRUPPO vuoto.
  // Strategia: crea una sezione "Sezione DEMO" senza fasi via API, poi clicca su
  // "Configura fasi" nella tab fasi.
  let demoSezId = null;
  try {
    // Crea sezione DEMO via API admin
    const auth = await (await fetch(`${BASE}/api/collections/accounts/auth-with-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: ADMIN_EMAIL, password: ADMIN_PWD }),
    })).json();
    const tok = auth.token;
    // Recupera concorso attivo
    const concs = await (await fetch(`${BASE}/api/collections/concorsi/records?perPage=1`, {
      headers: { Authorization: tok },
    })).json();
    const concorsoId = concs.items[0].id;
    // Cerca o crea sezione DEMO
    const sez = await (await fetch(`${BASE}/api/collections/sezioni/records?filter=${encodeURIComponent(`concorso="${concorsoId}" && nome="Sezione DEMO"`)}`, {
      headers: { Authorization: tok },
    })).json();
    if (sez.items.length) {
      demoSezId = sez.items[0].id;
    } else {
      const r = await (await fetch(`${BASE}/api/collections/sezioni/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: tok },
        body: JSON.stringify({ concorso: concorsoId, nome: 'Sezione DEMO', ordine: 99 }),
      })).json();
      demoSezId = r.id;
    }
  } catch (e) {
    console.warn('  ⚠ Crea sezione DEMO fallita:', e.message);
  }

  if (demoSezId) {
    try {
      await goAdminTab(page, 'fasi');
      // Trova la card "Sezione DEMO" e clicca "Configura fasi"
      const demoCard = page.locator('h3:has-text("Sezione DEMO")').first();
      await demoCard.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const wizardBtn = demoCard.locator('xpath=ancestor::section//button[contains(., "Configura fasi") or contains(., "Wizard")]').first();
      if (await wizardBtn.count().catch(() => 0)) {
        await wizardBtn.click({ timeout: 2000 });
      } else {
        // Fallback: trova qualsiasi data-group-action=wizard relativo a DEMO
        const altBtn = page.locator('[data-group-action="wizard"]').first();
        if (await altBtn.count().catch(() => 0)) await altBtn.click({ timeout: 2000 });
      }
      await page.waitForSelector('[data-wiz-templates]', { timeout: 5000 });
      await page.waitForTimeout(400);
      // 10: step 1 (template default)
      await snap(page, '10-fasi-wizard-template.png');

      // 11: clicca "Eliminatoria + Semifinale + Finale" per avere 3 righe
      try {
        const tplBtn = page.locator('[data-wiz-tpl="elim_semi_fin"]').first();
        await tplBtn.click();
        await page.waitForTimeout(300);
      } catch {}
      // Scroll a step 2
      const step2 = page.locator('[data-wiz-items]').first();
      await step2.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await snap(page, '11-fasi-wizard-lista.png');

      // 12: scroll a step 3 (configurazione comune) DENTRO il modal
      await page.evaluate(() => {
        // Trova lo scroll container del modal (di solito il body) e scrolla
        // verso la sezione step 3 (data-modo-cards o data-metodo-cards).
        const target = document.querySelector('[data-metodo-cards]') || document.querySelector('[data-modo-cards]');
        if (target) {
          // Scroll del modal body invece che dell'intera pagina
          let container = target.parentElement;
          while (container && container !== document.body) {
            const cs = getComputedStyle(container);
            if (/(auto|scroll)/.test(cs.overflowY)) { container.scrollTop = target.offsetTop - 100; break; }
            container = container.parentElement;
          }
          target.scrollIntoView({ block: 'center' });
        }
      });
      await page.waitForTimeout(400);
      await snap(page, '12-fasi-wizard-shared.png');

      // Chiudi modale
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      const closeBtn = page.locator('button[aria-label="Chiudi"], button:has-text("Annulla"), [data-modal-close]').first();
      if (await closeBtn.count().catch(() => 0)) {
        try { await closeBtn.click({ timeout: 1000 }); } catch {}
      }
    } catch (e) {
      errs.push(['10/11/12-wizard', e.message]);
    }
  } else {
    skip.push('10-11-12 wizard: impossibile creare sezione DEMO');
  }

  // -------- 13: batch edit modal --------
  try {
    await goAdminTab(page, 'fasi');
    const editShared = page.locator('button:has-text("Configurazione condivisa")').first();
    if (await editShared.count().catch(() => 0)) {
      await editShared.scrollIntoViewIfNeeded();
      await editShared.click({ timeout: 2000 });
      await page.waitForTimeout(600);
      await snap(page, '13-fasi-batch-edit.png');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    } else {
      skip.push('13-fasi-batch-edit: nessun gruppo con >1 sotto-fase visibile');
    }
  } catch (e) { errs.push(['13-fasi-batch-edit', e.message]); }

  // -------- 14: delete group confirm --------
  try {
    await goAdminTab(page, 'fasi');
    // Cerca un pulsante "Elimina gruppo" (gruppo di Pianoforte)
    const delBtn = page.locator('[data-group-action="delete-group"]').first();
    if (await delBtn.count().catch(() => 0)) {
      await delBtn.scrollIntoViewIfNeeded();
      await delBtn.click({ timeout: 2000 });
      await page.waitForTimeout(600);
      await snap(page, '14-fasi-delete-group.png');
      // NON confermare la delete
      const cancel = page.locator('button:has-text("Annulla"), [data-modal-close]').first();
      if (await cancel.count().catch(() => 0)) { try { await cancel.click({ timeout: 1000 }); } catch {} }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    } else {
      skip.push('14-fasi-delete-group: nessun pulsante elimina gruppo trovato');
    }
  } catch (e) { errs.push(['14-fasi-delete-group', e.message]); }

  // -------- 15: card override (drift) --------
  // Forziamo un drift: aggiorniamo una sotto-fase di Pianoforte con scala diversa
  try {
    const auth2 = await (await fetch(`${BASE}/api/collections/accounts/auth-with-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: ADMIN_EMAIL, password: ADMIN_PWD }),
    })).json();
    const tok2 = auth2.token;
    // Trova Pianoforte
    const allSez = await (await fetch(`${BASE}/api/collections/sezioni/records?perPage=50`, { headers: { Authorization: tok2 } })).json();
    const piano = allSez.items.find(s => s.nome === 'Pianoforte');
    if (piano) {
      const allFasi = await (await fetch(`${BASE}/api/collections/fasi/records?perPage=50`, { headers: { Authorization: tok2 } })).json();
      const pianoFasi = allFasi.items.filter(f => Array.isArray(f.sezioni) && f.sezioni.includes(piano.id));
      const semi = pianoFasi.find(f => f.nome === 'Semifinale');
      if (semi && semi.scala !== 25) {
        await fetch(`${BASE}/api/collections/fasi/records/${semi.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: tok2 },
          body: JSON.stringify({ scala: 25 }),
        });
      }
    }
    await goAdminTab(page, 'fasi');
    const pianoCard = page.locator('h3:has-text("Pianoforte")').first();
    if (await pianoCard.count().catch(() => 0)) {
      await pianoCard.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
    }
    await snap(page, '15-fasi-card-override.png');
  } catch (e) { errs.push(['15-fasi-card-override', e.message]); }

  // -------- 16: iscrizioni tab --------
  try {
    await goAdminTab(page, 'iscrizioni');
    await snap(page, '16-iscrizioni-tab.png');
  } catch (e) { errs.push(['16-iscrizioni-tab', e.message]); }

  // -------- 18: candidati tab --------
  try {
    await goAdminTab(page, 'candidati');
    await snap(page, '18-candidati-tab.png');
  } catch (e) { errs.push(['18-candidati-tab', e.message]); }

  // -------- 19: risultati riepilogo --------
  try {
    await goAdminTab(page, 'risultati');
    await snap(page, '19-risultati-riepilogo.png');
  } catch (e) { errs.push(['19-risultati-riepilogo', e.message]); }

  // -------- 20: verbale generatore con dropdown --------
  try {
    await goAdminTab(page, 'risultati');
    // Scrolla la pagina (non solo l'elemento) fino al blocco verbale
    await page.evaluate(() => {
      const block = document.querySelector('[data-verbale-block]') ||
                    document.querySelector('select[data-verbale-fase]')?.closest('[data-verbale-block]');
      if (block) {
        window.scrollTo({ top: block.getBoundingClientRect().top + window.scrollY - 80, behavior: 'instant' });
      } else {
        // Fallback: scroll a fondo pagina
        window.scrollTo(0, document.body.scrollHeight);
      }
    });
    await page.waitForTimeout(400);
    const sel = page.locator('select[data-verbale-fase]').first();
    if (await sel.count().catch(() => 0)) {
      await sel.click();
      await page.waitForTimeout(300);
    } else {
      skip.push('20-verbale: nessun selettore visibile (no fasi?)');
    }
    await snap(page, '20-risultati-verbale.png');
    await page.keyboard.press('Escape');
  } catch (e) { errs.push(['20-risultati-verbale', e.message]); }

  // -------- 21: audit --------
  try {
    await goAdminTab(page, 'audit');
    await snap(page, '21-audit-log.png');
  } catch (e) { errs.push(['21-audit-log', e.message]); }

  // -------- 17: form pubblico iscrizione (no auth) --------
  try {
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p2 = await ctx2.newPage();
    await p2.goto(`${BASE}/#/iscrizione`, { waitUntil: 'networkidle' });
    await p2.evaluate(() => { try { localStorage.setItem('gc_lang', 'it'); } catch {} });
    await p2.reload({ waitUntil: 'networkidle' });
    await p2.waitForTimeout(1000);
    await p2.screenshot({ path: out('17-iscrizione-form-pubblico.png'), fullPage: false });
    console.log('  · 17-iscrizione-form-pubblico.png');
    await ctx2.close();
  } catch (e) { errs.push(['17-iscrizione-form-pubblico', e.message]); }

  // -------- Cleanup: ripristina scala originale di Semifinale (drift) --------
  try {
    const auth3 = await (await fetch(`${BASE}/api/collections/accounts/auth-with-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: ADMIN_EMAIL, password: ADMIN_PWD }),
    })).json();
    const tok3 = auth3.token;
    const allSez = await (await fetch(`${BASE}/api/collections/sezioni/records?perPage=50`, { headers: { Authorization: tok3 } })).json();
    const piano = allSez.items.find(s => s.nome === 'Pianoforte');
    if (piano) {
      const allFasi = await (await fetch(`${BASE}/api/collections/fasi/records?perPage=50`, { headers: { Authorization: tok3 } })).json();
      const semi = allFasi.items.find(f => f.nome === 'Semifinale' && Array.isArray(f.sezioni) && f.sezioni.includes(piano.id));
      if (semi && semi.scala !== 10) {
        await fetch(`${BASE}/api/collections/fasi/records/${semi.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: tok3 },
          body: JSON.stringify({ scala: 10 }),
        });
      }
    }
  } catch {}

  // -------- 22/23: commissario eval + presidente panel --------
  try {
    const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p3 = await ctx3.newPage();
    await p3.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
    await p3.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('gc_lang', 'it'); } catch {} });
    await p3.reload({ waitUntil: 'networkidle' });
    await p3.waitForSelector('input[type="email"], input[name="email"], input[name="identity"]', { timeout: 8000 });
    await p3.locator('input[type="email"], input[name="email"], input[name="identity"]').first().fill(COM_EMAIL);
    await p3.locator('input[type="password"]').first().fill(COM_PWD);
    await Promise.all([
      p3.waitForLoadState('networkidle'),
      p3.locator('button[type="submit"], button:has-text("Accedi"), button:has-text("Entra")').first().click(),
    ]);
    await p3.waitForTimeout(1500);
    await p3.goto(`${BASE}/#/commissario`, { waitUntil: 'networkidle' });
    await p3.waitForTimeout(1500);

    // 23: pannello presidente in alto (Anna è presidente).
    await p3.evaluate(() => window.scrollTo(0, 0));
    await p3.waitForTimeout(400);
    await snap(p3, '23-presidente-panel.png');

    // 22: vista valutazione — scrolla giù per arrivare alla card del candidato.
    await p3.evaluate(() => {
      const card = document.querySelector('[data-quick-score], [data-candidate-card]') ||
                   Array.from(document.querySelectorAll('h2, h3')).find(h => /QUICK SCORE|punteggio|Federico|007|Tecnica/i.test(h.textContent));
      if (card) card.scrollIntoView({ block: 'start' });
      else window.scrollTo(0, 800);
    });
    await p3.waitForTimeout(400);
    await snap(p3, '22-commissario-eval.png');

    await ctx3.close();
  } catch (e) { errs.push(['22-23-commissario', e.message]); }

  // -------- 24: manuale in-app (tab dell'amministrazione) --------
  try {
    // Vai su un tab "ponte" per evitare il fallback in app.js poi al manuale
    await page.evaluate(() => { location.hash = '#/admin?tab=sezioni'; });
    await page.waitForTimeout(500);
    await page.evaluate(() => { location.hash = '#/admin?tab=manuale'; });
    await page.waitForTimeout(1500);
    await snap(page, '24-manuale-in-app.png');
  } catch (e) { errs.push(['24-manuale-in-app', e.message]); }

  await browser.close();

  console.log('\n--- ERRORI ---');
  errs.forEach(([n, m]) => console.log(`✗ ${n}: ${m}`));
  console.log('\n--- SKIP ---');
  skip.forEach(s => console.log(`· ${s}`));
  console.log(`\nFatto. Output: ${OUT_DIR}`);
})();
