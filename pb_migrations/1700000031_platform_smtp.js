/// <reference path="../pb_data/types.d.ts" />

// Configurazione SMTP centralizzata sulla piattaforma (super admin).
// Crea una collection singleton `platform_settings` che contiene le credenziali
// SMTP usate dal super admin per propagarle ai PB dei singoli tenant tramite
// l'admin API (vedi scripts/propagate-smtp.sh + UI gestione Enti).
//
// Sicurezza:
//   - Solo superadmin può leggere/modificare (rule)
//   - La password viene memorizzata in chiaro (limite di PB) → indispensabile
//     che la collection sia readable SOLO da superadmin

migrate((db) => {
  const dao = new Dao(db);
  // Idempotente: se la collection esiste già, salta.
  try {
    dao.findCollectionByNameOrId('platform_settings');
    return;
  } catch (e) { /* not found, create */ }

  const adminOnly = '@request.auth.role = "superadmin"';
  const c = new Collection({
    name: 'platform_settings',
    type: 'base',
    listRule:   adminOnly,
    viewRule:   adminOnly,
    createRule: adminOnly,
    updateRule: adminOnly,
    deleteRule: null,
    schema: [
      // SMTP
      new SchemaField({ name: 'smtp_enabled',   type: 'bool', options: {} }),
      new SchemaField({ name: 'smtp_host',      type: 'text', options: { max: 200 } }),
      new SchemaField({ name: 'smtp_port',      type: 'number', options: { min: 1, max: 65535, noDecimal: true } }),
      new SchemaField({ name: 'smtp_username',  type: 'text', options: { max: 200 } }),
      new SchemaField({ name: 'smtp_password',  type: 'text', options: { max: 500 } }),
      new SchemaField({ name: 'smtp_tls',       type: 'select', options: { maxSelect: 1, values: ['none', 'starttls', 'tls'] } }),
      new SchemaField({ name: 'sender_address', type: 'email', options: {} }),
      new SchemaField({ name: 'sender_name',    type: 'text', options: { max: 100 } }),
      // Branding generale per la piattaforma (opzionale, separato da `enti` dei tenant)
      new SchemaField({ name: 'app_url',        type: 'text', options: { max: 300 } }),
      // Stato propagazione
      new SchemaField({ name: 'last_propagated_at', type: 'date', options: {} }),
      new SchemaField({ name: 'last_propagation_result', type: 'text', options: { max: 2000 } }),
    ],
  });
  dao.saveCollection(c);
}, (db) => {
  const dao = new Dao(db);
  try { dao.deleteCollection(dao.findCollectionByNameOrId('platform_settings')); } catch (e) {}
});
