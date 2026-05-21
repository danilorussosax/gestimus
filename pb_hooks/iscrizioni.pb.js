/// <reference path="../pb_data/types.d.ts" />

// Hooks server-side per il flusso iscrizioni auto-service.
// NOTA: ogni handler PocketBase è eseguito in un runtime Goja isolato →
// le funzioni dichiarate a livello di file NON sono accessibili dagli handler.
// Per riusare codice tra hook, usa require() (vedi pb_hooks/_lib_email.js) oppure
// inline come fatto qui per semplicità.

// ============================================================================
// 1) Dopo create: invia email "iscrizione ricevuta" al partecipante.
// ============================================================================
onModelAfterCreate((e) => {
  try {
    const rec = e.model;
    console.log('iscrizione created:', rec.id);
    const settings = $app.settings();
    const fromName = (settings.meta && settings.meta.senderName) || 'Concorso Musicale';
    const fromAddr = (settings.meta && settings.meta.senderAddress) || 'noreply@example.com';
    const appUrl   = (settings.meta && settings.meta.appUrl) || '';
    const verifyUrl = appUrl + '/#/iscrizione/conferma?t=' + rec.get('token_verifica');
    const body = '<p>Ciao ' + rec.get('nome') + ' ' + rec.get('cognome') + ',</p>'
      + '<p>Abbiamo ricevuto la tua iscrizione. Conferma la tua email cliccando il link:</p>'
      + '<p><a href="' + verifyUrl + '">' + verifyUrl + '</a></p>'
      + '<p style="font-size:11px;color:#999;margin-top:24px">Numero pratica: ' + rec.id + '</p>';
    const message = new MailerMessage({
      from: { name: fromName, address: fromAddr },
      to:   [{ address: rec.get('email') }],
      subject: 'Iscrizione ricevuta · ' + rec.get('nome') + ' ' + rec.get('cognome'),
      html: body,
    });
    try { $app.newMailClient().send(message); } catch (mailErr) { console.warn('email send failed:', mailErr && mailErr.message || mailErr); }
  } catch (err) {
    console.warn('iscrizione afterCreate hook error:', err && err.message || err);
  }
}, 'iscrizioni');

// ============================================================================
// 2) Dopo update: gestisce transizione di stato.
//    - stato=approved && candidato vuoto  → crea record in `candidati` + email
//    - stato=rejected                     → email con motivo
//    - stato=email_verified               → email di conferma verifica
// ============================================================================
onModelAfterUpdate((e) => {
  try {
    const rec = e.model;
    const stato = rec.get('stato');

    if (stato === 'approved' && !rec.get('candidato')) {
      // ----- Crea il record candidato dalla iscrizione approvata -----
      try {
        const candCol = $app.dao().findCollectionByNameOrId('candidati');
        const cand = new Record(candCol);
        cand.set('concorso', rec.get('concorso'));
        cand.set('nome', rec.get('nome'));
        cand.set('cognome', rec.get('cognome'));
        cand.set('strumento', rec.get('strumento'));
        cand.set('data_nascita', rec.get('data_nascita'));
        cand.set('nazionalita', rec.get('nazionalita'));
        cand.set('tipo', rec.get('tipo') || 'individuale');
        cand.set('data_iscrizione', new Date().toISOString());
        // Numero progressivo: conta candidati esistenti del concorso.
        const existing = $app.dao().findRecordsByFilter('candidati', 'concorso = {:c}', '', 0, 0, { c: rec.get('concorso') });
        cand.set('numero_candidato', (existing.length || 0) + 1);
        // Docenti preparatori
        try {
          const doc = rec.get('docenti_preparatori');
          if (doc) cand.set('docenti_preparatori', typeof doc === 'string' ? doc : JSON.stringify(doc));
        } catch (e2) { /* skip docenti */ }
        // Sezione + categoria (relation single → array per il candidato)
        const sezId = rec.get('sezione');
        if (sezId) cand.set('sezioni', [sezId]);
        const catId = rec.get('categoria');
        if (catId) cand.set('categorie', [catId]);

        $app.dao().saveRecord(cand);

        // Linka il candidato all'iscrizione (no ricorsione: il check `!candidato` lo previene).
        rec.set('candidato', cand.id);
        $app.dao().saveRecord(rec);
        console.log('candidato created from iscrizione', rec.id, '→', cand.id);
      } catch (createErr) {
        console.error('approve iscrizione → create candidato failed:', createErr && createErr.message || createErr);
      }
    }

    // ----- Notifiche email per ogni transizione -----
    if (stato === 'approved' || stato === 'rejected' || stato === 'email_verified') {
      try {
        const settings = $app.settings();
        const fromName = (settings.meta && settings.meta.senderName) || 'Concorso Musicale';
        const fromAddr = (settings.meta && settings.meta.senderAddress) || 'noreply@example.com';
        let subject = 'Aggiornamento iscrizione';
        let body = '<p>Ciao ' + rec.get('nome') + ' ' + rec.get('cognome') + ',</p>';
        if (stato === 'approved') {
          subject = 'Iscrizione approvata';
          body += '<p>La tua iscrizione al concorso è stata approvata.</p><p>Riceverai a breve i dettagli sulla data della tua audizione.</p>';
        } else if (stato === 'rejected') {
          subject = 'Aggiornamento sulla tua iscrizione';
          const reason = rec.get('rejected_reason') || '';
          body += '<p>Purtroppo la tua iscrizione non è stata accolta.</p>' + (reason ? '<p>Motivo: ' + reason + '</p>' : '');
        } else if (stato === 'email_verified') {
          subject = 'Email verificata · iscrizione confermata';
          body += '<p>La tua email è stata verificata correttamente. L\'iscrizione è ora in attesa di revisione.</p>';
        }
        body += '<p style="font-size:11px;color:#999;margin-top:24px">Numero pratica: ' + rec.id + '</p>';
        const message = new MailerMessage({
          from: { name: fromName, address: fromAddr },
          to:   [{ address: rec.get('email') }],
          subject: subject,
          html: body,
        });
        try { $app.newMailClient().send(message); } catch (mailErr) { console.warn('email send failed:', mailErr && mailErr.message || mailErr); }
      } catch (mailBuildErr) {
        console.warn('email build failed:', mailBuildErr && mailBuildErr.message || mailBuildErr);
      }
    }
  } catch (err) {
    console.warn('iscrizione afterUpdate hook error:', err && err.message || err);
  }
}, 'iscrizioni');

// ============================================================================
// 3) Endpoint pubblico GET /api/iscrizione/conferma?t=TOKEN
//    Trova l'iscrizione col token, marca email_verified, ritorna dati base.
// ============================================================================
routerAdd('GET', '/api/iscrizione/conferma', (c) => {
  const token = c.queryParam('t') || '';
  if (!token || token.length < 8) {
    return c.json(400, { error: 'invalid_token' });
  }
  let rec = null;
  try {
    rec = $app.dao().findFirstRecordByFilter('iscrizioni', 'token_verifica = {:t}', { t: token });
  } catch (err) {
    const msg = String(err && err.message || err);
    if (msg.indexOf('no rows') !== -1) return c.json(404, { error: 'not_found' });
    console.error('iscrizione conferma query:', err);
    return c.json(500, { error: 'server_error' });
  }
  if (!rec) return c.json(404, { error: 'not_found' });
  try {
    if (rec.get('stato') === 'pending') {
      rec.set('stato', 'email_verified');
      rec.set('verified_at', new Date().toISOString());
      $app.dao().saveRecord(rec);
    }
    return c.json(200, {
      ok: true,
      stato: rec.get('stato'),
      nome: rec.get('nome'),
      cognome: rec.get('cognome'),
      concorso_id: rec.get('concorso'),
    });
  } catch (err) {
    console.error('iscrizione conferma update:', err);
    return c.json(500, { error: 'server_error' });
  }
});
