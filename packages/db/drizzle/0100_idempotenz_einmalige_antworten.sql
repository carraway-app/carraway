-- Einmalige Antworten entfernen, die Reservierung bis zum Ablauf erhalten.
UPDATE idempotenz_schluessel
SET antwort = NULL, antwort_hash = NULL, inhaltstyp = NULL
WHERE antwort IS NOT NULL AND (
  rtrim(pfad, '/') IN ('/api-keys', '/value-keys', '/webhooks', '/account/recovery-codes',
    '/account/two-factor/restart', '/settings/calendar-link', '/mailbox/oauth/start')
  OR pfad ~ '/(rotate-secret|metric-requests|renew-link|send-email)/?$'
  -- Ein Stapel speichert die Ergebnisse der Einzelaufrufe ohne deren Pfade.
  OR (rtrim(pfad, '/') = '/batch' AND antwort ~ '("(secret|token|totpUri|recoveryCodes)"\s*:|"key"\s*:\s*"cw[kw]_|[?&]state=)')
);
