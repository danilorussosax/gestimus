/// <reference path="../pb_data/types.d.ts" />

// Collection `tenant_config` (singleton) — replica locale, su OGNI PocketBase
// tenant, del piano commerciale assegnato dal super admin sulla piattaforma.
//
// Modello: il super admin gestisce i piani su `tenants` (sul PB platform).
// Per consentire ai PB tenant di applicare il gating server-side senza chiamare
// in remoto il platform a ogni create, replichiamo localmente i campi piano in
// questa collection. La propagazione avviene tramite `scripts/apply-ente-plan.sh`.
//
// Una sola riga per istanza (singleton). Se la collection è vuota, l'hook
// `pb_hooks/tenant_config.pb.js` lascia passare tutto (fail-open: utile per dev).

migrate((db) => {
  const dao = new Dao(db);

  // Idempotente: se esiste già, skip.
  try {
    dao.findCollectionByNameOrId('tenant_config');
    return;
  } catch {}

  const cfg = new Collection({
    name: 'tenant_config',
    type: 'base',
    // Solo admin/superadmin leggono/scrivono. Il client non deve mai toccarla:
    // viene popolata server-side dallo script di propagazione che usa il token admin.
    listRule:   '@request.auth.role = "admin" || @request.auth.role = "superadmin"',
    viewRule:   '@request.auth.role = "admin" || @request.auth.role = "superadmin"',
    createRule: '@request.auth.role = "admin" || @request.auth.role = "superadmin"',
    updateRule: '@request.auth.role = "admin" || @request.auth.role = "superadmin"',
    deleteRule: null,
    schema: [
      new SchemaField({ name: 'piano', type: 'select', required: true, options: { maxSelect: 1, values: ['trial', 'starter', 'pro', 'ultra', 'ppe'] } }),
      // Data di attivazione del piano corrente. Il counter "iscritti annui"
      // gira sul ciclo annuale dall'anniversario di questa data, non sull'anno
      // solare (es. piano attivato il 15 marzo → ciclo 15 mar → 14 mar).
      new SchemaField({ name: 'piano_inizio',          type: 'date',   options: {} }),
      new SchemaField({ name: 'piano_scadenza',        type: 'date',   options: {} }),
      new SchemaField({ name: 'limit_concorsi',        type: 'number', options: { min: 0, noDecimal: true } }),
      new SchemaField({ name: 'limit_iscritti_annui',  type: 'number', options: { min: 0, noDecimal: true } }),
      new SchemaField({ name: 'ppe_setup_per_concorso', type: 'number', options: { min: 0, noDecimal: false } }),
      new SchemaField({ name: 'ppe_per_iscritto',       type: 'number', options: { min: 0, noDecimal: false } }),
      // Grace period in giorni dopo la scadenza prima di bloccare (default 0).
      new SchemaField({ name: 'grace_giorni',          type: 'number', options: { min: 0, noDecimal: true } }),
      // Timestamp dell'ultima propagazione dal platform.
      new SchemaField({ name: 'applied_at',            type: 'date',   options: {} }),
    ],
  });
  dao.saveCollection(cfg);
}, (db) => {
  const dao = new Dao(db);
  try {
    dao.deleteCollection(dao.findCollectionByNameOrId('tenant_config'));
  } catch {}
});
