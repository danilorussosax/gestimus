/// <reference path="../pb_data/types.d.ts" />

// Hook server-side per `valutazioni`:
//   1. Clamp voto in [0, fase.scala] (default scala=10).
//   2. Blocca create/update se la fase è CONCLUSA (snapshot delle medie:
//      una volta chiusa la fase, i voti non si toccano più).
//
// NOTA: in PocketBase Goja le funzioni top-level NON sono nello scope delle
// callback hook → la logica DEVE essere inline. Le 2 callback sono identiche.

onRecordBeforeCreateRequest((e) => {
  try {
    const rec = e.record;
    const cfId = rec.get('candidato_fase');
    if (!cfId) return;
    let cf, fase;
    try { cf = $app.dao().findRecordById('candidati_fase', cfId); } catch (err) { return; }
    if (!cf) return;
    try { fase = $app.dao().findRecordById('fasi', cf.get('fase')); } catch (err) { return; }
    if (!fase) return;

    if (fase.get('stato') === 'CONCLUSA') {
      throw new BadRequestError('La fase è conclusa: non è possibile modificare i voti.');
    }

    const scala = Number(fase.get('scala')) || 10;
    let voto = Number(rec.get('voto'));
    if (!Number.isFinite(voto)) {
      throw new BadRequestError('Voto non valido.');
    }
    if (voto < 0) voto = 0;
    if (voto > scala) voto = scala;
    rec.set('voto', voto);
  } catch (err) {
    if (err && err.message && (err.message.indexOf('fase è conclusa') !== -1 || err.message.indexOf('Voto non valido') !== -1)) throw err;
    console.warn('valutazioni beforeCreate hook error:', err && err.message || err);
  }
}, 'valutazioni');

onRecordBeforeUpdateRequest((e) => {
  try {
    const rec = e.record;
    const cfId = rec.get('candidato_fase');
    if (!cfId) return;
    let cf, fase;
    try { cf = $app.dao().findRecordById('candidati_fase', cfId); } catch (err) { return; }
    if (!cf) return;
    try { fase = $app.dao().findRecordById('fasi', cf.get('fase')); } catch (err) { return; }
    if (!fase) return;

    if (fase.get('stato') === 'CONCLUSA') {
      throw new BadRequestError('La fase è conclusa: non è possibile modificare i voti.');
    }

    const scala = Number(fase.get('scala')) || 10;
    let voto = Number(rec.get('voto'));
    if (!Number.isFinite(voto)) {
      throw new BadRequestError('Voto non valido.');
    }
    if (voto < 0) voto = 0;
    if (voto > scala) voto = scala;
    rec.set('voto', voto);
  } catch (err) {
    if (err && err.message && (err.message.indexOf('fase è conclusa') !== -1 || err.message.indexOf('Voto non valido') !== -1)) throw err;
    console.warn('valutazioni beforeUpdate hook error:', err && err.message || err);
  }
}, 'valutazioni');
