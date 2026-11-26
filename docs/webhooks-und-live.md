# Webhooks und Live-Aktualisierung

Beide liefern dieselben Ereignisse wie die Änderungsabfrage `GET /api/v1/changes`: jede Zeile des Änderungsprotokolls an Geschäftsdaten,
gefiltert nach den Fondsrechten des Zugangs (Bereich „alle“, siehe `docs/rechte-modell.md`). Gemeinsame Quelle ist ein Trigger auf `aenderung`
(Migration 0089, Code in `apps/api/src/ereignisse/quelle.ts`). Beide gehören zum Kern (HTTP-API, `docs/open-core.md`).

## Ereignis

```json
{
  "id": "2b1c…",
  "at": "2026-11-26T10:15:00.123456Z",
  "actor": "<Benutzer-ID oder system>",
  "actorName": "…",
  "action": "aendern",
  "table": "beteiligung",
  "recordId": "…",
  "fundId": "…",
  "before": { "…": "…" },
  "after": { "…": "…" }
}
```

`table` und `action` tragen die Kennungen des Protokolls (Namen der Datenbank), wie in der Änderungsabfrage.

## Webhooks (`/api/v1/webhooks`)

| Methode und Pfad | Wirkung |
|---|---|
| `POST /webhooks` `{ url, description?, tables? }` | Endpunkt anlegen; Antwort enthält einmalig `secret` |
| `GET /webhooks`, `GET /webhooks/{id}` | eigene Endpunkte (globale Verwalter: alle) |
| `PATCH /webhooks/{id}` `{ url?, description?, tables?, active? }` | ändern, ab- oder wieder einschalten |
| `DELETE /webhooks/{id}` | löschen |
| `POST /webhooks/{id}/rotate-secret` | neues Geheimnis, einmalig in der Antwort |
| `POST /webhooks/{id}/test` | Testereignis (`type: "ping"`) über die Warteschlange |
| `GET /webhooks/{id}/deliveries?limit=&cursor=` | Zustellprotokoll (Status, Versuche, HTTP-Status, Fehlercode, Dauer; keine Nutzdaten) |

- **Eigentümer** ist der Zugang, der den Endpunkt anlegt: eine Person oder ein API-Schlüssel. Zugestellt wird, was dieser Zugang **zum
  Zeitpunkt der Zustellung** sieht; endet der Zugang (Person deaktiviert, Schlüssel widerrufen oder abgelaufen), schaltet sich der Endpunkt ab.
  Höchstens 20 Endpunkte je Zugang. Globale Verwalter sehen alle Endpunkte und können sie abschalten oder löschen, aber nicht umleiten.
- **Ziele:** nur `https`, Hostname statt IP-Adresse, Port 443 oder ab 1024. Jede aufgelöste Adresse muss öffentlich sein (keine lokalen,
  privaten, Link-Local- oder reservierten Bereiche, auch nicht eingebettet in IPv6); geprüft beim Anlegen, beim Ändern und vor jedem Versuch,
  verbunden wird mit genau der geprüften Adresse. Weiterleitungen werden nicht verfolgt (3xx gilt als Fehlschlag). `WEBHOOK_PRIVATE_ZIELE=1`
  erlaubt Selbsthostern interne Ziele.
- **Nachricht:** `POST` mit JSON `{ id, type: "change" | "ping", createdAt, webhookId, data }` und den Kopfzeilen `Carraway-Signature`,
  `Carraway-Event-Id`, `Carraway-Delivery-Id`, `Carraway-Webhook-Id`. Antwort 2xx innerhalb von 10 Sekunden gilt als zugestellt.
- **Wiederholung:** bis zu 8 Versuche mit wachsender Wartezeit (30 Sekunden, verdoppelt, höchstens eine Stunde). Nach 5 endgültig
  gescheiterten Zustellungen in Folge wird der Endpunkt abgeschaltet (`disabledReason: "too_many_failures"`). Die Reihenfolge ist nicht
  garantiert, eine Nachricht kann doppelt ankommen: Empfänger entfernen Doppelte über `Carraway-Event-Id` und ordnen nach `data.at`.
- **Protokoll:** 30 Tage, ohne Nutzdaten, Kopfzeilen, Signaturen oder Antworttexte.

### Signatur prüfen

`Carraway-Signature: t=<Unix-Sekunden>,v1=<hex>` mit `v1 = HMAC-SHA256(secret, "<t>.<roher Rumpf>")`. Der Empfänger rechnet nach,
vergleicht in konstanter Zeit und verwirft Nachrichten, deren `t` mehr als fünf Minuten von der eigenen Uhr abweicht.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function pruefe(secret, kopf, rumpf) {
  const teile = Object.fromEntries(kopf.split(",").map((t) => t.split("=", 2)));
  if (Math.abs(Date.now() / 1000 - Number(teile.t)) > 300) return false;
  const erwartet = createHmac("sha256", secret).update(`${teile.t}.${rumpf}`).digest("hex");
  return teile.v1?.length === 64 && timingSafeEqual(Buffer.from(erwartet), Buffer.from(teile.v1));
}
```

## Live-Aktualisierung (`wss://…/api/v1/live`)

- **Anmeldung** wie bei jeder Route: Sitzung (Browser; `Origin` muss zu `APP_ORIGIN` gehören) oder `Authorization: Bearer cwk_…`
  (ohne `Origin`). Ein Schlüssel in der Adresse gilt nicht. Ohne WebSocket antwortet die Route 426 `upgrade_required`.
- **Nachrichten des Clients:** `{"type":"subscribe","tables":["beteiligung"]}` (oder `["*"]`), `{"type":"unsubscribe","tables":[…]}`,
  `{"type":"ping"}`.
- **Nachrichten des Servers:** `ready`, `subscribed` (mit `tables`), `change` (mit `data` wie oben), `pong`, `error` (mit `code`:
  `invalid_message`, `invalid_table`).
- **Grenzen:** Nachrichten höchstens 4 KiB und 60 je Minute, höchstens 5 Verbindungen je Person bzw. Schlüssel (429
  `live_connection_limit`), Client ohne Mitlesen (über 1 MiB Puffer) wird getrennt (1013).
- **Rechte** werden alle 30 Sekunden neu ermittelt; endet die Anmeldung, schließt der Server mit 4401 (nicht angemeldet) bzw. 4403.
- Live ist ein Hinweis, keine lückenlose Zustellung. Nach einem neuen Aufbau holt der Client Verpasstes über `/changes` nach.
