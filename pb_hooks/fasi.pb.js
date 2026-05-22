/// <reference path="../pb_data/types.d.ts" />

// Hook di integrità per la collection `fasi`.
//
// Regola: un commissario può modificare una fase SOLO se è il presidente
// della commissione assegnata a quella fase. admin/superadmin hanno pieni
// privilegi (configurano i concorsi). Senza questo hook un presidente di
// Comm. A potrebbe chiamare direttamente
//   PATCH /api/collections/fasi/records/<faseId> {"stato":"IN_CORSO"}
// avviando o concludendo una fase di Comm. B, perché la access rule è
// "authRequired" e non valida la presidenza.
//
// NOTA: in PocketBase Goja le funzioni top-level NON sono nello scope delle
// callback hook → la logica DEVE essere inline.

onRecordBeforeUpdateRequest((e) => {
  try {
    const auth = e.httpContext && e.httpContext.get('authRecord');
    if (!auth) return; // niente auth → la rule pubblica già blocca
    const role = auth.get('role');
    if (role === 'admin' || role === 'superadmin') return; // privilegi pieni

    const commissarioId = auth.get('commissario');
    if (!commissarioId) {
      throw new BadRequestError('Non sei autorizzato a modificare questa fase.');
    }

    const fase = e.record;
    const commissioneId = fase.get('commissione');
    if (!commissioneId) {
      // Fase senza commissione assegnata: solo admin può toccarla.
      throw new BadRequestError('Solo un amministratore può modificare una fase senza commissione assegnata.');
    }

    let commissione;
    try { commissione = $app.dao().findRecordById('commissioni', commissioneId); }
    catch (err) { throw new BadRequestError('Commissione associata alla fase non trovata.'); }

    const presidenteId = commissione.get('presidente');
    if (!presidenteId || String(presidenteId) !== String(commissarioId)) {
      throw new BadRequestError('Solo il presidente della commissione di questa fase può modificarla.');
    }
  } catch (err) {
    if (err && err.message && (
      err.message.indexOf('Non sei autorizzato') !== -1 ||
      err.message.indexOf('Solo un amministratore') !== -1 ||
      err.message.indexOf('Commissione associata') !== -1 ||
      err.message.indexOf('Solo il presidente') !== -1
    )) throw err;
    console.warn('fasi beforeUpdate hook error:', err && err.message || err);
  }
}, 'fasi');

// Le create/delete di fasi restano riservate ad admin/superadmin via le
// collection rules (configurate nelle migrations). Qui blocchiamo comunque
// un eventuale tentativo di create da utente commissario, per coerenza.
onRecordBeforeCreateRequest((e) => {
  try {
    const auth = e.httpContext && e.httpContext.get('authRecord');
    if (!auth) return;
    const role = auth.get('role');
    if (role === 'admin' || role === 'superadmin') return;
    throw new BadRequestError('Solo un amministratore può creare una fase.');
  } catch (err) {
    if (err && err.message && err.message.indexOf('Solo un amministratore') !== -1) throw err;
    console.warn('fasi beforeCreate hook error:', err && err.message || err);
  }
}, 'fasi');
