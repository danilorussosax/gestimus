/// <reference path="../pb_data/types.d.ts" />

// Hardening valutazioni:
//   1. UNIQUE INDEX (candidato_fase, commissario, criterio) → previene
//      duplicati da doppio click / race condition.
//   2. createRule/updateRule: solo il proprio commissario (o admin).
//      Prima qualsiasi auth poteva sovrascrivere il voto di un altro.
//   3. deleteRule: solo admin/superadmin (invariato).
//
// Nota: il clamp dei valori voto (0..scala) è gestito dall'hook
// pb_hooks/valutazioni.pb.js perché lo schema PB non supporta vincoli
// dipendenti da un altro record (la scala è su `fasi`).

migrate((db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('valutazioni');

  const ownCommissario = 'commissario = @request.auth.commissario';
  const adminOrSuper = '@request.auth.role = "admin" || @request.auth.role = "superadmin"';

  c.createRule = '(' + ownCommissario + ') || (' + adminOrSuper + ')';
  c.updateRule = '(' + ownCommissario + ') || (' + adminOrSuper + ')';
  // deleteRule lasciato come da lockdown v1: solo admin/superadmin.

  // Aggiungi unique index (se non presente)
  const idxName = 'idx_valutazioni_unique_cf_comm_crit';
  const exists = (c.indexes || []).some(i => i.indexOf(idxName) !== -1);
  if (!exists) {
    c.indexes = (c.indexes || []).concat([
      'CREATE UNIQUE INDEX `' + idxName + '` ON `valutazioni` (`candidato_fase`, `commissario`, `criterio`)'
    ]);
  }

  dao.saveCollection(c);
}, (db) => {
  const dao = new Dao(db);
  const c = dao.findCollectionByNameOrId('valutazioni');
  c.createRule = '@request.auth.id != ""';
  c.updateRule = '@request.auth.id != ""';
  c.indexes = (c.indexes || []).filter(i => i.indexOf('idx_valutazioni_unique_cf_comm_crit') === -1);
  dao.saveCollection(c);
});
