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
- [ ] PocketBase migrations
- [ ] PocketBase hooks
- [ ] Script di deploy
- [ ] Documentazione

## Check-list

- [ ] La CI passa (lint JS + bash + migration check)
- [ ] Ho testato localmente con `./scripts/start-local-multitenant.sh`
- [ ] Se ho toccato lo **schema PocketBase**, ho creato una **nuova migration** (non modificato quelle esistenti)
- [ ] Se ho aggiunto chiavi `t('...')` ho aggiunto le traduzioni in IT (le altre lingue cadono su IT)
- [ ] Se ho modificato gli **script di deploy**, ho aggiornato `DEPLOY-IONOS.md` di conseguenza
- [ ] Se ho aggiunto un **hook PB**, l'ho testato in isolamento (errore non blocca la transazione del record)

## Test eseguiti

<!-- Descrivi cosa hai verificato manualmente -->

## Screenshot (se UI)

<!-- Drag&drop di screenshot prima/dopo se servono -->

## Note per il deploy

<!-- C'è qualcosa di non automatico da fare al deploy? Migration manuale? Restart? -->
