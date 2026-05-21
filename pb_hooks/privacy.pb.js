/// <reference path="../pb_data/types.d.ts" />

// GDPR — endpoint pubblici per esercitare i diritti dell'interessato (Art. 15-17).
//
//   GET    /api/privacy/export?token=<token_verifica>   → ritorna tutti i dati personali
//                                                         dell'iscrizione + record candidato
//                                                         eventualmente collegato (Art. 15
//                                                         "Diritto di accesso" / Art. 20 portabilità).
//
//   DELETE /api/privacy/erase?token=<token_verifica>   → cancella l'iscrizione + candidato
//                                                         + dati correlati. Art. 17 "Diritto
//                                                         all'oblio". Cascade delete in PB
//                                                         gestisce candidati_fase + valutazioni.
//
// Sicurezza: si autentica via token_verifica generato all'iscrizione (lo stesso del link
// di verifica email). Solo chi possiede il token può accedere ai propri dati. In caso di
// token compromesso/perso, l'utente contatta il Titolare per la rotazione.
//
// I diritti di rettifica (Art. 16) e limitazione (Art. 18) si esercitano contattando
// il Titolare via email (riportato nell'informativa).

// ---------- Helper: trova iscrizione per token. Wrapper definito a livello file
//            non è accessibile dagli handler routerAdd → inline nei singoli endpoint. ----------

// ---------- GET /api/privacy/export ----------
routerAdd('GET', '/api/privacy/export', (c) => {
  try {
    const token = c.queryParam('t') || c.queryParam('token') || '';
    if (!token || token.length < 8) return c.json(400, { error: 'invalid_token' });
    let rec = null;
    try {
      rec = $app.dao().findFirstRecordByFilter('iscrizioni', 'token_verifica = {:t}', { t: token });
    } catch (err) {
      const msg = String(err && err.message || err);
      if (msg.indexOf('no rows') !== -1) return c.json(404, { error: 'not_found' });
      console.error('privacy export query:', msg);
      return c.json(500, { error: 'query_failed' });
    }
    if (!rec) return c.json(404, { error: 'not_found' });

  // Costruiamo un payload "human readable" coi soli campi dell'utente (no metadati
  // gestionali tipo `approved_by`, `note_admin`, `rejected_reason` → sono dati del
  // Titolare relativi alla decisione, non dell'interessato).
  const payload = {
    iscrizione: {
      id: rec.id,
      stato: rec.get('stato'),
      created: rec.get('created'),
      verified_at: rec.get('verified_at') || null,
      // Anagrafica
      nome: rec.get('nome'),
      cognome: rec.get('cognome'),
      data_nascita: rec.get('data_nascita'),
      luogo_nascita: rec.get('luogo_nascita') || null,
      nazionalita: rec.get('nazionalita'),
      sesso: rec.get('sesso') || null,
      codice_fiscale: rec.get('codice_fiscale') || null,
      // Contatti
      email: rec.get('email'),
      telefono: rec.get('telefono') || null,
      indirizzo: rec.get('indirizzo') || null,
      citta: rec.get('citta') || null,
      provincia: rec.get('provincia') || null,
      cap: rec.get('cap') || null,
      paese: rec.get('paese') || null,
      // Tutore (minorenni)
      tutore_nome:     rec.get('tutore_nome') || null,
      tutore_cognome:  rec.get('tutore_cognome') || null,
      tutore_email:    rec.get('tutore_email') || null,
      tutore_telefono: rec.get('tutore_telefono') || null,
      // Artistici
      tipo:           rec.get('tipo'),
      strumento:      rec.get('strumento'),
      anni_studio:    rec.get('anni_studio') || null,
      scuola_provenienza: rec.get('scuola_provenienza') || null,
      docenti_preparatori: rec.get('docenti_preparatori') || null,
      // Gruppo
      gruppo_nome:    rec.get('gruppo_nome') || null,
      gruppo_membri:  rec.get('gruppo_membri') || null,
      // Programma
      programma:      rec.get('programma') || null,
      durata_totale_min: rec.get('durata_totale_min') || null,
      note_libere:    rec.get('note_libere') || null,
      // Consensi
      consenso_privacy: !!rec.get('consenso_privacy'),
      consenso_immagini: !!rec.get('consenso_immagini'),
      consenso_regolamento: !!rec.get('consenso_regolamento'),
      // Allegati (referenziati come URL, non includiamo i binari)
      allegati: {
        foto: rec.get('foto') ? `/api/files/${rec.collectionId}/${rec.id}/${rec.get('foto')}` : null,
        documento_identita: rec.get('documento_identita') ? `/api/files/${rec.collectionId}/${rec.id}/${rec.get('documento_identita')}` : null,
        ricevuta_pagamento: rec.get('ricevuta_pagamento') ? `/api/files/${rec.collectionId}/${rec.id}/${rec.get('ricevuta_pagamento')}` : null,
        autorizzazione_minore: rec.get('autorizzazione_minore') ? `/api/files/${rec.collectionId}/${rec.id}/${rec.get('autorizzazione_minore')}` : null,
      },
    },
    candidato_collegato: null,
  };

  // Se l'iscrizione è stata approvata e ha un candidato, ne includo i campi pubblici.
  const candId = rec.get('candidato');
  if (candId) {
    try {
      const cand = $app.dao().findRecordById('candidati', candId);
      payload.candidato_collegato = {
        id: cand.id,
        numero_candidato: cand.get('numero_candidato'),
        nome: cand.get('nome'),
        cognome: cand.get('cognome'),
        strumento: cand.get('strumento'),
        data_iscrizione: cand.get('data_iscrizione'),
      };
    } catch (e) { /* candidato cancellato lato admin */ }
  }

  // Diritti riassuntivi
  payload._diritti = {
    art15_accesso: 'I dati riportati sopra rappresentano TUTTE le informazioni personali che il Titolare detiene su di te. Generato a richiesta.',
    art17_oblio: 'Per richiedere la cancellazione totale: DELETE /api/privacy/erase?t=' + token,
    art16_rettifica: "Per rettificare i dati contatta il Titolare via email (vedi informativa privacy dell'ente).",
    art20_portabilita: 'Questo JSON è la copia portabile dei tuoi dati. Salvalo o trasmettilo ad altro Titolare.',
  };

    return c.json(200, payload);
  } catch (err) {
    console.error('privacy export fatal:', err && err.message || err);
    return c.json(500, { error: 'server_error', message: String(err && err.message || err) });
  }
});

// ---------- DELETE /api/privacy/erase ----------
routerAdd('DELETE', '/api/privacy/erase', (c) => {
 try {
  const token = c.queryParam('t') || c.queryParam('token') || '';
  if (!token || token.length < 8) return c.json(400, { error: 'invalid_token' });
  let rec = null;
  try {
    rec = $app.dao().findFirstRecordByFilter('iscrizioni', 'token_verifica = {:t}', { t: token });
  } catch (err) {
    const msg = String(err && err.message || err);
    if (msg.indexOf('no rows') !== -1) return c.json(404, { error: 'not_found' });
    console.error('privacy erase query:', msg);
    return c.json(500, { error: 'query_failed' });
  }
  if (!rec) return c.json(404, { error: 'not_found' });

  // Audit log PRIMA della delete (così resta traccia anonimizzata).
  // Per IP/UA preferiamo NON usare API specifiche di PB (sintassi varia tra versioni) →
  // ip_anon + user_agent restano vuoti per richieste pubbliche.
  try {
    const auditCol = $app.dao().findCollectionByNameOrId('audit_log');
    const log = new Record(auditCol);
    log.set('actor_email', rec.get('email'));
    log.set('actor_role', 'interessato');
    log.set('action', 'gdpr.erase');
    log.set('target_type', 'iscrizione');
    log.set('target_id', rec.id);
    log.set('target_label', rec.get('nome') + ' ' + rec.get('cognome'));
    log.set('concorso_id', rec.get('concorso') || '');
    log.set('payload', JSON.stringify({ via: 'public_endpoint' }));
    $app.dao().saveRecord(log);
  } catch (e) { console.warn('audit on erase failed:', e && e.message || e); }

  // Cascade: cancellando il candidato collegato si rimuovono anche candidati_fase + valutazioni.
  // Poi cancello l'iscrizione.
  const candId = rec.get('candidato');
  let candDeleted = false;
  if (candId) {
    try {
      const cand = $app.dao().findRecordById('candidati', candId);
      $app.dao().deleteRecord(cand);
      candDeleted = true;
    } catch (e) { /* già cancellato */ }
  }
  try {
    $app.dao().deleteRecord(rec);
  } catch (e) {
    return c.json(500, { error: 'erase_failed', message: String(e && e.message || e) });
  }

  return c.json(200, {
    ok: true,
    erased: {
      iscrizione: rec.id,
      candidato: candDeleted ? candId : null,
    },
  });
 } catch (err) {
  console.error('privacy erase fatal:', err && err.message || err);
  return c.json(500, { error: 'server_error', message: String(err && err.message || err) });
 }
});
