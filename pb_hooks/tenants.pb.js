/// <reference path="../pb_data/types.d.ts" />

// Cifra/decifra la SMTP password della collection `tenants` (piattaforma).
//
// Modello: la password viene salvata cifrata con AES-256-GCM via $security.encrypt
// usando la chiave letta da env `GESTIMUS_SECRET_KEY` (esattamente 32 byte).
// Formato a riposo: stringa prefissata `enc:v1:<cipher>`. Se la chiave non è
// configurata, il save passa con warning (compat con istanze già esistenti).
//
// Lettura in chiaro avviene tramite l'endpoint admin
// `POST /api/admin/tenants/:id/smtp-decrypt` consumato da `scripts/apply-ente-smtp.sh`.
//
// IMPORTANTE: in PocketBase Goja le funzioni top-level NON sono nello scope di
// callback hook e route handler — tutta la logica DEVE essere inline.
onRecordBeforeCreateRequest((e) => {
  try {
    const p = e.record.get('smtp_password');
    if (!p) return;
    const s = String(p);
    if (s.indexOf('enc:v1:') === 0) return; // già cifrato
    const key = ($os.getenv('GESTIMUS_SECRET_KEY') || '').toString();
    if (!key || key.length < 16) {
      console.warn('GESTIMUS_SECRET_KEY non impostata: smtp_password salvata in chiaro');
      return;
    }
    try {
      e.record.set('smtp_password', 'enc:v1:' + $security.encrypt(s, key));
    } catch (encErr) {
      console.warn('smtp_password encrypt failed:', encErr && encErr.message || encErr);
    }
  } catch (err) {
    console.warn('smtp encrypt beforeCreate hook error:', err && err.message || err);
  }
}, 'tenants');

onRecordBeforeUpdateRequest((e) => {
  try {
    const p = e.record.get('smtp_password');
    if (!p) return;
    const s = String(p);
    if (s.indexOf('enc:v1:') === 0) return;
    const key = ($os.getenv('GESTIMUS_SECRET_KEY') || '').toString();
    if (!key || key.length < 16) {
      console.warn('GESTIMUS_SECRET_KEY non impostata: smtp_password salvata in chiaro');
      return;
    }
    try {
      e.record.set('smtp_password', 'enc:v1:' + $security.encrypt(s, key));
    } catch (encErr) {
      console.warn('smtp_password encrypt failed:', encErr && encErr.message || encErr);
    }
  } catch (err) {
    console.warn('smtp encrypt beforeUpdate hook error:', err && err.message || err);
  }
}, 'tenants');

// ============================================================================
// Auto-propagazione del piano: dopo che il super admin salva tenants, chiama
// l'endpoint /api/admin/apply-plan del PB del singolo tenant per applicare i
// nuovi limiti in tenant_config. Lo shared secret è GESTIMUS_SECRET_KEY,
// replicata sull'env del tenant dal provision-tenant.sh.
//
// IMPORTANTE: nei callback `onRecord*AfterRequest` di PocketBase Goja le
// funzioni top-level del file NON sono nel parent scope dell'eval interno →
// la logica DEVE essere inline dentro la callback stessa. Per evitare drift
// tra create/update teniamo entrambe identiche, copia-incollo. Fallback
// manuale resta `scripts/apply-ente-plan.sh` per i tenant offline.
// ============================================================================
onRecordAfterCreateRequest((e) => {
  try {
    const rec = e.record;
    if (!rec) return;
    const slug = rec.get('slug') || '';
    const porta = Number(rec.get('porta_pb'));
    if (!porta) return;
    const key = ($os.getenv('GESTIMUS_SECRET_KEY') || '').toString();
    if (!key || key.length < 16) {
      console.warn('plan auto-propagation skipped: GESTIMUS_SECRET_KEY non impostata o troppo corta');
      return;
    }
    const payload = JSON.stringify({
      piano:                  rec.get('piano') || 'trial',
      piano_inizio:           rec.get('piano_inizio') || '',
      piano_scadenza:         rec.get('piano_scadenza') || '',
      limit_concorsi:         Number(rec.get('limit_concorsi')) || 0,
      limit_iscritti_annui:   Number(rec.get('limit_iscritti_annui')) || 0,
      ppe_setup_per_concorso: Number(rec.get('ppe_setup_per_concorso')) || 0,
      ppe_per_iscritto:       Number(rec.get('ppe_per_iscritto')) || 0,
      grace_giorni:           0,
    });
    try {
      const res = $http.send({
        url: 'http://127.0.0.1:' + porta + '/api/admin/apply-plan',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Gestimus-Key': key },
        body: payload,
        timeout: 5,
      });
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log('plan propagated to tenant', slug, '→', rec.get('piano'));
      } else {
        console.warn('plan propagation FAILED for', slug, '→ HTTP', res.statusCode, res.raw);
      }
    } catch (httpErr) {
      console.warn('plan propagation http error for', slug, ':', httpErr && httpErr.message || httpErr);
    }
  } catch (err) {
    console.warn('plan auto-propagate outer error:', err && err.message || err);
  }
}, 'tenants');

onRecordAfterUpdateRequest((e) => {
  try {
    const rec = e.record;
    if (!rec) return;
    const slug = rec.get('slug') || '';
    const porta = Number(rec.get('porta_pb'));
    if (!porta) return;
    const key = ($os.getenv('GESTIMUS_SECRET_KEY') || '').toString();
    if (!key || key.length < 16) {
      console.warn('plan auto-propagation skipped: GESTIMUS_SECRET_KEY non impostata o troppo corta');
      return;
    }
    const payload = JSON.stringify({
      piano:                  rec.get('piano') || 'trial',
      piano_inizio:           rec.get('piano_inizio') || '',
      piano_scadenza:         rec.get('piano_scadenza') || '',
      limit_concorsi:         Number(rec.get('limit_concorsi')) || 0,
      limit_iscritti_annui:   Number(rec.get('limit_iscritti_annui')) || 0,
      ppe_setup_per_concorso: Number(rec.get('ppe_setup_per_concorso')) || 0,
      ppe_per_iscritto:       Number(rec.get('ppe_per_iscritto')) || 0,
      grace_giorni:           0,
    });
    try {
      const res = $http.send({
        url: 'http://127.0.0.1:' + porta + '/api/admin/apply-plan',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Gestimus-Key': key },
        body: payload,
        timeout: 5,
      });
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log('plan propagated to tenant', slug, '→', rec.get('piano'));
      } else {
        console.warn('plan propagation FAILED for', slug, '→ HTTP', res.statusCode, res.raw);
      }
    } catch (httpErr) {
      console.warn('plan propagation http error for', slug, ':', httpErr && httpErr.message || httpErr);
    }
  } catch (err) {
    console.warn('plan auto-propagate outer error:', err && err.message || err);
  }
}, 'tenants');

// ============================================================================
// Endpoint privato: ritorna la config piano da applicare al PB del tenant.
// Richiede auth con role=superadmin. Usato da `scripts/apply-ente-plan.sh`.
// ============================================================================
routerAdd('POST', '/api/admin/tenants/:id/plan-for-apply', (c) => {
  const auth = c.get('authRecord');
  if (!auth || auth.get('role') !== 'superadmin') {
    return c.json(403, { error: 'forbidden' });
  }
  const id = c.pathParam('id');
  let rec;
  try {
    rec = $app.dao().findRecordById('tenants', id);
  } catch (err) {
    return c.json(404, { error: 'tenant_not_found' });
  }
  return c.json(200, {
    piano: rec.get('piano') || 'trial',
    piano_inizio: rec.get('piano_inizio') || '',
    piano_scadenza: rec.get('piano_scadenza') || '',
    limit_concorsi: Number(rec.get('limit_concorsi')) || 0,
    limit_iscritti_annui: Number(rec.get('limit_iscritti_annui')) || 0,
    ppe_setup_per_concorso: Number(rec.get('ppe_setup_per_concorso')) || 0,
    ppe_per_iscritto: Number(rec.get('ppe_per_iscritto')) || 0,
    grace_giorni: 0,
  });
}, $apis.requireAdminOrRecordAuth('accounts'));

// ============================================================================
// Endpoint privato: ritorna la SMTP password in chiaro per un tenant.
// Richiede auth con role=superadmin. Usato da `scripts/apply-ente-smtp.sh`.
// ============================================================================
routerAdd('POST', '/api/admin/tenants/:id/smtp-decrypt', (c) => {
  // Auth check: solo superadmin
  const auth = c.get('authRecord');
  if (!auth || auth.get('role') !== 'superadmin') {
    return c.json(403, { error: 'forbidden' });
  }
  const id = c.pathParam('id');
  let rec;
  try {
    rec = $app.dao().findRecordById('tenants', id);
  } catch (err) {
    return c.json(404, { error: 'tenant_not_found' });
  }
  // Inline decryptIfNeeded (le funzioni top-level non sono nello scope del
  // routerAdd handler in PocketBase Goja).
  try {
    const val = rec.get('smtp_password');
    if (!val) return c.json(200, { smtp_password: '' });
    const s = String(val);
    if (s.indexOf('enc:v1:') !== 0) {
      // Legacy: già in chiaro
      return c.json(200, { smtp_password: s });
    }
    const key = ($os.getenv('GESTIMUS_SECRET_KEY') || '').toString();
    if (!key || key.length < 16) {
      return c.json(500, { error: 'decrypt_failed', message: 'GESTIMUS_SECRET_KEY non impostata: impossibile decifrare smtp_password' });
    }
    const plain = $security.decrypt(s.slice('enc:v1:'.length), key);
    return c.json(200, { smtp_password: plain });
  } catch (err) {
    return c.json(500, { error: 'decrypt_failed', message: String(err && err.message || err) });
  }
}, $apis.requireAdminOrRecordAuth('accounts'));
