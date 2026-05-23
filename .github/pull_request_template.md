<!--
Grazie per il contributo. Compila la check-list prima di chiedere review.
-->

## Cosa cambia

<!-- 1-3 frasi: cosa fa questa PR e perché -->

## Tipo di modifica

- [ ] 🐛 Bug fix (non breaking)
- [ ] ✨ Nuova feature (non breaking)
- [ ] 💥 Breaking change (richiede coordinamento deploy)
- [ ] 📚 Documentazione
- [ ] 🔧 Refactor (no change funzionale)
- [ ] 🛠 Infra / DevOps

## Aree dell'app toccate

- [ ] Super admin
- [ ] Admin ente
- [ ] Commissario
- [ ] Iscrizione pubblica
- [ ] Schema Drizzle / migrazioni SQL
- [ ] Route Fastify / middleware / RLS
- [ ] Script di deploy
- [ ] Documentazione

## Check-list

- [ ] La CI passa (`npm run lint` server + i18n coverage)
- [ ] Ho testato localmente con `npm run dev` nel pacchetto `server/`
- [ ] Se ho toccato lo **schema Drizzle**, ho aggiunto una **nuova migration incrementale** in `server/scripts/migrations/` (non modificato quelle esistenti)
- [ ] Se ho aggiunto chiavi `t('...')` ho aggiunto le traduzioni in IT (le altre lingue cadono su IT)
- [ ] Se ho modificato gli **script di deploy**, ho aggiornato `DEPLOY-IONOS.md` di conseguenza
- [ ] Se ho aggiunto/modificato **policy RLS** o **trigger DB**, ho aggiornato i test in `server/tests/rls/` o `server/tests/crud/`

## Test eseguiti

<!-- Descrivi cosa hai verificato manualmente -->

## Screenshot (se UI)

<!-- Drag&drop di screenshot prima/dopo se servono -->

## Note per il deploy

<!-- C'è qualcosa di non automatico da fare al deploy? Migration manuale? Restart? -->
