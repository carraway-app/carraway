# Carraway mit einem KI-Client verbinden

Im Managed Hosting kann ein KI-Client Fonds, Kennzahlen und weitere Geschäftsdaten über das Model Context Protocol (MCP) lesen. Die Adresse lautet `https://<Hosting-Domain>/api/v1/mcp`. Der Client braucht Unterstützung für **Streamable HTTP** und einen frei konfigurierbaren `Authorization`-Header.

## Einrichtung

1. In der Schlüsselverwaltung einen eigenen API-Schlüssel für diesen Client anlegen. Für die gewünschten Fonds genügt jeweils die Berechtigung `read`. Der Zugang läuft bis zum eingestellten Ablaufdatum und lässt sich über die Schlüsselverwaltung widerrufen.
2. Im KI-Client einen HTTP-MCP-Server anlegen und die HTTPS-Adresse der eigenen Carraway-Installation eintragen. Den Header `Authorization: Bearer <API-Schlüssel>` über die Geheimnisverwaltung des Clients setzen. Den Klartextschlüssel ausschließlich dort eingeben.
3. Verbinden und die Werkzeugliste laden. Mit `list_funds` prüfen, welche Fonds der Schlüssel sieht. Anschließend etwa `get_fund_metric` mit einer zurückgegebenen `fundId`, `metric: "nav"` und einem Stichtag wie `asOf: "2026-06-30"` aufrufen. Das Ergebnis enthält Wert, Währung und die Rechenschritte zu diesem Stichtag.

Beispiel für die **editorverwaltete** MCP-Konfiguration von VS Code (`mcp.json`). Die Platzhalter-Domain durch die eigene Hosting-Domain ersetzen. Beim Start fragt der Editor den Schlüssel verdeckt ab. Für den Copilot-Harness gilt dessen eigenes Konfigurationsformat mit Umgebungsvariablen. [MCP-Konfigurationsreferenz für VS Code](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)

```json
{
  "inputs": [
    { "id": "carrawayKey", "type": "promptString", "description": "Carraway-API-Schlüssel", "password": true }
  ],
  "servers": {
    "carraway": {
      "type": "http",
      "url": "https://funds.example.org/api/v1/mcp",
      "headers": { "Authorization": "Bearer ${input:carrawayKey}" }
    }
  }
}
```

## Werkzeuge

| Werkzeug | Ergebnis und Parameter |
|---|---|
| `list_funds` | Sichtbare Fonds mit ID, Name, Kurzname und Währung. |
| `get_fund_metric` | Ein Wert für `fundId` und `metric` (`nav`, `tvpi`, `dpi`, `rvpi` oder `irr`) mit Einheit und Rechenschritten. Ein fehlender Wert bleibt `null`. |
| `get_portfolio` | Konsolidierte Summen der sichtbaren Fonds in Hauswährung und eine Seite der einzelnen Fonds. Die Summen beziehen sich auf das gesamte sichtbare Portfolio. |
| `list_investments` | Beteiligungen eines Fonds mit ID, Unternehmen, Zusage, investiertem Kapital, Rückflüssen und Multiple. |
| `list_transactions` | Vorgänge einer `investmentId` mit Wertstellung, Betrag und Stornokennzeichen. |
| `get_cap_table` | Unverwässerte und voll verwässerte Gesamtzahl der Anteile sowie eine Seite der zulässigen Positionen für eine `investmentId`. |
| `search_records` | Rangfolge zu `q` (2 bis 100 Zeichen) für den gewählten `type` aus `deals`, `people`, `organizations` und `documents`. Dokumenttreffer enthalten Dateiname, Seite und Textausschnitt. |
| `list_changes` | Änderungen seit `since` oder ab `cursor` mit Zeitpunkt, Aktion, Tabellenkennung, Datensatz- und Fonds-ID. Tabellen- und Aktionskennungen stammen wie bei `GET /changes` aus dem Änderungsprotokoll. |

Die Fondskennzahlen, das Portfolio, Beteiligungen und Vorgänge akzeptieren einen Stichtag `asOf` und einen optionalen Wissensstand `knowledgeDate` (ISO-Zeitpunkt mit Zeitzone). Beim Cap Table lässt sich der Stichtag angeben.

Listen liefern standardmäßig zehn und höchstens zwanzig Zeilen. Für die nächste Seite den zurückgegebenen `nextCursor` unverändert als `cursor` mit denselben Filtern senden. Bei `list_changes` dient der Cursor auch nach der letzten Seite zum späteren Weiterlesen. Die Suche liefert die besten Treffer bis zum angegebenen `limit`. Für weitere Treffer den Suchbegriff präzisieren.

## Rechte und Grenzen

Jeder Werkzeugaufruf durchläuft mit dem aktuellen API-Schlüssel die Rechteprüfung der jeweiligen HTTP-Route einschließlich Fonds, Bereichen und Sichtbarkeit verknüpfter Datensätze. Die erste Version bietet ausschließlich Lesezugriffe. Schreibaktionen erfordern eine Vorschau und eine Bestätigung durch eine Person, die nachweisbar für genau diese Änderung gilt.

Dokumentausschnitte, Namen und Rechentexte stammen aus Geschäftsdaten und können fremde Anweisungen enthalten. Der Client soll sie als Daten behandeln. Alle Werkzeuge lesen von fest vorgegebenen API-Routen. Schlüsselverwaltung, Dateidownload und beliebige Zieladressen gehören nicht zum Werkzeugangebot. Der Client und sein KI-Anbieter erhalten die abgerufenen Daten entsprechend der Client-Konfiguration.

Pro Schlüssel und API-Prozess gelten 60 Transportanfragen pro Minute. Bei HTTP 429 nennt `Retry-After` die Wartezeit in Sekunden. Jede POST-Anfrage enthält eine einzelne JSON-RPC-Nachricht mit höchstens 16 KiB. Ein Werkzeugergebnis ist auf 64 KiB begrenzt, eine intern gelesene HTTP-Antwort auf 4 MiB. Bei `result_too_large` den Umfang der Abfrage eingrenzen oder die HTTP-API direkt verwenden.

Der Transport arbeitet ohne Sitzung. Für jede Anfrage gilt der Bearer-Schlüssel erneut. HTTP 401 bedeutet fehlende oder ungültige Anmeldung. Bei HTTP 403 die Fondsfreigabe sowie Host und Origin prüfen. Der Reverse-Proxy muss den öffentlichen `Host` einschließlich eines abweichenden Ports durchreichen. Ein mitgesendeter `Origin` muss genau in `APP_ORIGIN` stehen. Native Clients können den Origin weglassen. GET und DELETE am Transport antworten für berechtigte Clients mit 405. Einzelaufrufe verwenden weder den HTTP-Stapel noch einen `Idempotency-Key`.

Das Zugriffsprotokoll erfasst Routenmuster, Status, Laufzeit und technische Kennungen. Argumente, Suchtexte, Antwortinhalte und der Bearer-Schlüssel werden nicht protokolliert.

## SDK

Die Hosting-API verwendet `@modelcontextprotocol/server` 2.4.0 aus dem offiziellen TypeScript-SDK. Das Paket nennt Apache-2.0. Seine Lizenzdatei weist während der Umlizenzierung auf weiterhin MIT-lizenzierte Beiträge hin. [TypeScript-SDK und Lizenz](https://github.com/modelcontextprotocol/typescript-sdk)
