# Webhooks and live updates

Both provide the same events as `GET /api/v1/changes`. They deliver each business-data entry from the audit log, filtered by the caller's fund permissions (the all-areas scope, see `docs/permissions-model.md`). Both use a trigger on `aenderung` (migration 0089, code in `apps/api/src/ereignisse/quelle.ts`) and are part of the core HTTP API (see `docs/open-core.md`).

## Event

```json
{
  "id": "2b1c…",
  "at": "2026-11-26T10:15:00.123456Z",
  "actor": "<user ID or system>",
  "actorName": "…",
  "action": "aendern",
  "table": "beteiligung",
  "recordId": "…",
  "fundId": "…",
  "before": { "…": "…" },
  "after": { "…": "…" }
}
```

`table` and `action` use the audit log identifiers (database names), as in the changes endpoint.

## Webhooks (`/api/v1/webhooks`)

| Method and path | Effect |
|---|---|
| `POST /webhooks` `{ url, description?, tables? }` | Create an endpoint. The response includes `secret` once. |
| `GET /webhooks`, `GET /webhooks/{id}` | List or read your own endpoints. Global admins see all endpoints. |
| `PATCH /webhooks/{id}` `{ url?, description?, tables?, active? }` | Update, disable or re-enable the endpoint. |
| `DELETE /webhooks/{id}` | Delete the endpoint. |
| `POST /webhooks/{id}/rotate-secret` | Issue a new secret, returned once in the response. |
| `POST /webhooks/{id}/test` | Queue a test event (`type: "ping"`). |
| `GET /webhooks/{id}/deliveries?limit=&cursor=` | Read delivery history (status, attempts, HTTP status, error code and duration, with no payloads). |

- **Owner.** The user or API key that creates the endpoint owns it. Deliveries include events visible to that owner **at delivery time**. The endpoint disables itself when the user is deactivated or the key expires or is revoked. Each owner can have up to 20 endpoints. Global admins can view, disable or delete every endpoint. Only the owner can change the destination.
- **Destinations.** The URL must use `https`, a hostname and port 443 or a port of 1024 or higher. Every resolved address must be public. Local, private, link-local and reserved addresses are rejected, including those embedded in IPv6. The application checks on creation, on update and before every attempt, then connects to the exact address it checked. A 3xx response counts as a failed delivery. Self-hosters can allow internal destinations with `WEBHOOK_PRIVATE_ZIELE=1`.
- **Message.** The delivery is a `POST` with JSON `{ id, type: "change" | "ping", createdAt, webhookId, data }` and the headers `Carraway-Signature`, `Carraway-Event-Id`, `Carraway-Delivery-Id` and `Carraway-Webhook-Id`. A 2xx response within 10 seconds counts as a successful delivery.
- **Retries.** Up to eight attempts, starting with a 30-second delay that doubles each time up to one hour. Five consecutive deliveries that exhaust retries disable the endpoint (`disabledReason: "too_many_failures"`). Messages can arrive out of order or more than once. Receivers deduplicate using `Carraway-Event-Id` and sort by `data.at`.
- **Delivery log.** The log retains entries for 30 days and omits payloads, headers, signatures and response bodies.

### Verify the signature

The header uses `Carraway-Signature: t=<Unix seconds>,v1=<hex>`, where `v1 = HMAC-SHA256(secret, "<t>.<raw body>")`. The receiver recalculates the signature, compares it in constant time and discards messages whose `t` differs from its clock by more than five minutes.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function pruefe(secret, kopf, rumpf) {
  const teile = Object.fromEntries(kopf.split(",").map((t) => t.split("=", 2)));
  if (Math.abs(Date.now() / 1000 - Number(teile.t)) > 300) return false;
  const erwartet = createHmac("sha256", secret).update(`${teile.t}.${rumpf}`).digest("hex");
  return teile.v1?.length === 64 && timingSafeEqual(Buffer.from(erwartet), Buffer.from(teile.v1));
}
```

## Live updates (`wss://…/api/v1/live`)

- **Authentication** works as for other routes. Use a browser session with an `Origin` in `APP_ORIGIN` or `Authorization: Bearer cwk_…` without an `Origin`. The endpoint ignores keys in the URL. Requests without a WebSocket upgrade receive 426 `upgrade_required`.
- **Client messages.** `{"type":"subscribe","tables":["beteiligung"]}` (or `["*"]`), `{"type":"unsubscribe","tables":[…]}`, `{"type":"ping"}`.
- **Server messages.** `ready`, `subscribed` (with `tables`), `change` (with `data` as above), `pong` and `error` (with `code` set to `invalid_message` or `invalid_table`).
- **Limits.** Messages are limited to 4 KiB and 60 per minute. Each user or key can open at most five connections (429 `live_connection_limit`). The server disconnects clients that fall behind (buffer over 1 MiB) with 1013.
- The server rechecks **permissions** every 30 seconds. When authentication ends, it closes with 4401 (unauthenticated) or 4403.
- Live updates are notifications with no delivery guarantee. After reconnecting, the client retrieves missed changes through `/changes`.
