/// <reference path="../pb_data/types.d.ts" />

// Hook di protezione per la collection `accounts`.
//
// Problema risolto: la updateRule v2 permette self-update (per cambio password).
// Senza questo hook, un commissario autenticato potrebbe fare
//   PATCH /api/collections/accounts/records/<own_id> {"role":"admin"}
// e promuoversi admin → privilege escalation.
//
// Soluzione: se l'utente che esegue l'update NON è admin/superadmin, vietare
// la modifica dei campi sensibili (role, attivo, commissario, email, verified).
// Self-update di password/nome/cognome resta consentito.

onRecordBeforeUpdateRequest((e) => {
  try {
    const auth = e.httpContext && e.httpContext.get('authRecord');
    if (!auth) return; // niente auth → la rule pubblica già blocca
    const role = auth.get('role');
    if (role === 'admin' || role === 'superadmin') return; // privilegi pieni

    // Self-update di un non-admin: rifiuta cambi sui campi sensibili.
    const sensitive = ['role', 'attivo', 'commissario', 'email', 'verified'];
    const before = e.record.originalCopy();
    for (const field of sensitive) {
      const oldVal = before.get(field);
      const newVal = e.record.get(field);
      // Confronto tollerante (relation può essere stringa o oggetto)
      const o = oldVal == null ? '' : String(oldVal);
      const n = newVal == null ? '' : String(newVal);
      if (o !== n) {
        throw new BadRequestError('Campo "' + field + '" non modificabile da utente non-admin');
      }
    }
  } catch (err) {
    if (err && err.message && err.message.indexOf('non modificabile') !== -1) throw err;
    // Errori inattesi: log e prosegui (fail-open per non rompere reset password).
    console.warn('accounts beforeUpdate hook error:', err && err.message || err);
  }
}, 'accounts');
