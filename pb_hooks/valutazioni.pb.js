/// <reference path="../pb_data/types.d.ts" />

// Hook server-side per `valutazioni`:
//   1. Clamp voto in [0, fase.scala] (default scala=10).
//   2. Blocca create/update se la fase è CONCLUSA (snapshot delle medie:
//      una volta chiusa la fase, i voti non si toccano più).

function checkAndClamp(rec) {
  const cfId = rec.get('candidato_fase');
  if (!cfId) return;
  let cf, fase;
  try { cf = $app.dao().findRecordById('candidati_fase', cfId); } catch (e) { return; }
  if (!cf) return;
  try { fase = $app.dao().findRecordById('fasi', cf.get('fase')); } catch (e) { return; }
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
}

onRecordBeforeCreateRequest((e) => {
  checkAndClamp(e.record);
}, 'valutazioni');

onRecordBeforeUpdateRequest((e) => {
  checkAndClamp(e.record);
}, 'valutazioni');
