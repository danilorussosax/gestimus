/// <reference path="../pb_data/types.d.ts" />

// Cifra/decifra la SMTP password della collection `tenants` (piattaforma).
//
// Modello: la password viene salvata cifrata con AES-256-GCM via $security.encrypt
// utilizzando la chiave letta da env `GESTIMUS_SECRET_KEY` (32+ char raccomandati).
// Formato a riposo: stringa prefissata `enc:v1:<cipher>`. Se la chiave non è
// configurata o la cifratura fallisce, lasciamo passare il valore in chiaro con
// un warning a log — preferibile a impedire il save su istanze già esistenti.
//
// Lettura in chiaro avviene tramite l'endpoint admin
// `POST /api/admin/tenants/:id/smtp-decrypt` consumato da `scripts/apply-ente-smtp.sh`.

const PREFIX = 'enc:v1:';

function getKey() {
  try {
    const k = $os.getenv('GESTIMUS_SECRET_KEY') || '';
    if (k.length >= 16) return k;
  } catch (e) {}
  return '';
}

function encryptIfPlain(val) {
  if (!val) return val;
  const s = String(val);
  if (s.indexOf(PREFIX) === 0) return s; // già cifrata
  const key = getKey();
  if (!key) {
    console.warn('GESTIMUS_SECRET_KEY non impostata: smtp_password salvata in chiaro');
    return s;
  }
  try {
    return PREFIX + $security.encrypt(s, key);
  } catch (err) {
    console.warn('smtp_password encrypt failed:', err && err.message || err);
    return s;
  }
}

function decryptIfNeeded(val) {
  if (!val) return '';
  const s = String(val);
  if (s.indexOf(PREFIX) !== 0) return s; // legacy plain
  const key = getKey();
  if (!key) throw new Error('GESTIMUS_SECRET_KEY non impostata: impossibile decifrare smtp_password');
  return $security.decrypt(s.slice(PREFIX.length), key);
}

onRecordBeforeCreateRequest((e) => {
  const p = e.record.get('smtp_password');
  if (p) e.record.set('smtp_password', encryptIfPlain(p));
}, 'tenants');

onRecordBeforeUpdateRequest((e) => {
  // Solo se il campo è stato esplicitamente toccato e non è già cifrato.
  const p = e.record.get('smtp_password');
  if (p) e.record.set('smtp_password', encryptIfPlain(p));
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
  try {
    const plain = decryptIfNeeded(rec.get('smtp_password'));
    return c.json(200, { smtp_password: plain });
  } catch (err) {
    return c.json(500, { error: 'decrypt_failed', message: String(err && err.message || err) });
  }
}, $apis.requireAdminOrRecordAuth('accounts'));
