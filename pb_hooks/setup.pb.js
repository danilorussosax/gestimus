/// <reference path="../pb_data/types.d.ts" />

// Endpoint pubblico (no auth) per il "primo avvio" del tenant:
// ritorna SOLO un booleano che indica se esiste almeno un account con ruolo
// admin/superadmin. Non espone email, id o altri dati sensibili.
//
// Usato dalla pagina di login per nascondere/mostrare il pannello
// "Primo avvio — nessun admin trovato".

routerAdd('GET', '/api/setup/has-admin', (c) => {
  try {
    const items = $app.dao().findRecordsByFilter(
      'accounts',
      'role = "admin" || role = "superadmin"',
      '',
      1,
      0,
    );
    const hasAdmin = items && items.length > 0;
    return c.json(200, { hasAdmin });
  } catch (err) {
    console.warn('has-admin probe error:', err && err.message || err);
    // In caso di errore, ritorna conservativo "true" per NON mostrare il pannello
    // e cosi non confondere l'utente con istruzioni che non gli servono.
    return c.json(200, { hasAdmin: true });
  }
});

// ============================================================================
// POST /api/setup/create-admin
// Crea il PRIMO admin del tenant. Idempotente: rifiuta se esiste già un admin
// (impedisce attacchi di registrazione di admin da remoto in tenant attivi).
// Body JSON: { email: string, password: string, nome?: string, cognome?: string, role?: 'admin' | 'superadmin' }
// Usato dal super admin (pannello Gestione Enti) per provisioning rapido.
// ============================================================================
routerAdd('POST', '/api/setup/create-admin', (c) => {
  // Parse body
  let body = {};
  try { body = $apis.requestInfo(c).data || {}; } catch (e) {
    return c.json(400, { error: 'invalid_body' });
  }
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const nome = String(body.nome || '').trim();
  const cognome = String(body.cognome || '').trim();
  const role = (body.role === 'superadmin') ? 'superadmin' : 'admin';

  if (!email || !email.includes('@')) return c.json(400, { error: 'invalid_email' });
  if (!password || password.length < 6) return c.json(400, { error: 'password_too_short' });

  // Idempotenza/sicurezza: se esiste già un admin/superadmin, rifiuta.
  try {
    const existing = $app.dao().findRecordsByFilter(
      'accounts',
      'role = "admin" || role = "superadmin"',
      '',
      1,
      0,
    );
    if (existing && existing.length > 0) {
      return c.json(409, { error: 'admin_already_exists', message: 'Un account admin esiste già su questo tenant. Per crearne un altro, usa la UI admin web dopo aver fatto login.' });
    }
  } catch (e) {
    console.warn('check existing admin failed:', e && e.message || e);
    // Se il check fallisce, NON creare l'account (sicurezza).
    return c.json(500, { error: 'check_failed' });
  }

  // Crea l'account.
  // Nota: `accounts` è una auth-collection PB → richiede `username` esplicito
  // (la REST API lo autogenera, ma il DAO no). Lo deriviamo da local-part email
  // + suffisso random per evitare collisioni.
  try {
    const col = $app.dao().findCollectionByNameOrId('accounts');
    const rec = new Record(col);
    const localPart = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() || 'admin';
    const suffix = Math.random().toString(36).slice(2, 8);
    rec.set('username', localPart + '_' + suffix);
    rec.set('email', email);
    rec.set('emailVisibility', true);
    rec.set('verified', true);
    rec.set('role', role);
    rec.set('nome', nome);
    rec.set('cognome', cognome);
    rec.set('attivo', true);
    rec.setPassword(password);
    $app.dao().saveRecord(rec);
    return c.json(200, {
      ok: true,
      id: rec.id,
      email: rec.get('email'),
      role: rec.get('role'),
    });
  } catch (err) {
    const msg = String(err && err.message || err);
    console.error('create-admin failed:', msg);
    if (msg.indexOf('UNIQUE') !== -1 || msg.indexOf('unique') !== -1) {
      return c.json(409, { error: 'email_taken' });
    }
    return c.json(500, { error: 'create_failed', message: msg });
  }
});
