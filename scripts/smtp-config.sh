#!/usr/bin/env bash
# smtp-config.sh — Configura SMTP su PocketBase e invia email welcome.
#
# PocketBase supporta SMTP nativo via flag CLI:
#   --smtpHost      (es. smtp.gmail.com)
#   --smtpPort      (es. 587)
#   --smtpUsername
#   --smtpPassword
#
# Per Gmail serve una "App Password" da https://myaccount.google.com/apppasswords
#
# Usage:
#   ./scripts/smtp-config.sh <tenant-slug> <smtp-host> <smtp-user> <smtp-pass>
#
# Dopo la configurazione, PocketBase invia email per:
#   - Richieste di reset password
#   - Verifica email (se abilitato)
#   - Webhook email-to-record

echo "Per inviare email in produzione, aggiungi al servizio systemd:"
echo ""
echo "  Environment=\"PB_SMTP_HOST=smtp.example.com\""
echo "  Environment=\"PB_SMTP_PORT=587\""
echo "  Environment=\"PB_SMTP_USERNAME=noreply@example.com\""
echo "  Environment=\"PB_SMTP_PASSWORD=your-password\""
echo ""
echo "E aggiungi al comando ExecStart:"
echo "  --smtpHost=\${PB_SMTP_HOST} \\"
echo "  --smtpPort=\${PB_SMTP_PORT} \\"
echo "  --smtpUsername=\${PB_SMTP_USERNAME} \\"
echo "  --smtpPassword=\${PB_SMTP_PASSWORD} \\"
echo ""
echo "Esempio per deploy/systemd/pb@.service:"
cat <<'SERVICEEXAMPLE'

[Service]
EnvironmentFile=/etc/pb/%i.env
EnvironmentFile=/etc/pb/smtp.env
ExecStart=/srv/pb/pocketbase serve \
    --http=127.0.0.1:${PORT} \
    --dir=/srv/pb/data/%i \
    --migrationsDir=/srv/pb/pb_migrations \
    --smtpHost=${PB_SMTP_HOST} \
    --smtpPort=${PB_SMTP_PORT} \
    --smtpUsername=${PB_SMTP_USERNAME} \
    --smtpPassword=${PB_SMTP_PASSWORD}
SERVICEEXAMPLE