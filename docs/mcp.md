# Connect Carraway to an AI client

With managed hosting, an AI client can read funds, metrics and other business data through the Model Context Protocol (MCP). The endpoint is `https://<hosting-domain>/api/v1/mcp`. The client must support **Streamable HTTP** and allow a custom `Authorization` header.

## Setup

1. Create a dedicated API key for the client in key management. The `read` permission is sufficient for each fund the client needs. The key works until its configured expiry date and can be revoked in key management.
2. Add an HTTP MCP server in the AI client and enter the HTTPS address of your Carraway installation. Set `Authorization: Bearer <API key>` in the client's secret store. Enter the plaintext key only there.
3. Connect and load the tools. Use `list_funds` to see which funds the key can access. Then call, for example, `get_fund_metric` with a returned `fundId`, `metric: "nav"` and an as-of date such as `asOf: "2026-06-30"`. The result contains the value, currency and calculation steps for that date.

The following example uses the **editor-managed** MCP configuration in VS Code (`mcp.json`). Replace the placeholder domain with your own hosting domain. At startup, the editor prompts for the key and masks it. The Copilot harness uses its own configuration format with environment variables. [VS Code MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)

```json
{
  "inputs": [
    { "id": "carrawayKey", "type": "promptString", "description": "Carraway API key", "password": true }
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

## Tools

| Tool | Result and parameters |
|---|---|
| `list_funds` | Visible funds with ID, name, short name and currency. |
| `get_fund_metric` | One value for `fundId` and `metric` (`nav`, `tvpi`, `dpi`, `rvpi` or `irr`), with its unit and calculation steps. A missing value remains `null`. |
| `get_portfolio` | Consolidated totals for visible funds in home currency and one page of individual funds. Totals cover the entire visible portfolio. |
| `list_investments` | A fund's investments with ID, company, commitment, invested capital, proceeds and multiple. |
| `list_transactions` | Transactions for an `investmentId`, with value date, amount and reversal flag. |
| `get_cap_table` | Undiluted and fully diluted share totals and one page of permitted positions for an `investmentId`. |
| `search_records` | Ranked results for `q` (2 to 100 characters) and the selected `type` from `deals`, `people`, `organizations` and `documents`. Document results include file name, page and a text snippet. |
| `list_changes` | Changes since `since` or from `cursor`, with timestamp, action, table identifier, record ID and fund ID. As with `GET /changes`, table and action identifiers come from the audit log. |

Fund metrics, the portfolio, investments and transactions accept an as-of date (`asOf`) and an optional knowledge date (`knowledgeDate`, an ISO timestamp with timezone). The cap table accepts an as-of date.

Lists return 10 rows by default and at most 20. For the next page, send the returned `nextCursor` unchanged as `cursor` with the same filters. For `list_changes`, keep the cursor even after the last page to resume later. Search returns the best matches up to `limit`. Refine the search term to find other matches.

## Permissions and limits

Each tool call uses the current API key and passes the permission checks of the corresponding HTTP route, including fund access, areas and visibility of linked records. The first version is read-only. A write action would require a preview and a human confirmation verifiably tied to that specific change.

Document snippets, names and calculation descriptions come from business data and may include instructions from other parties. Clients should treat them as data. Every tool reads from a fixed set of API routes. The tools exclude key management, file downloads and arbitrary destinations. The client and its AI provider receive the retrieved data according to the client's configuration.

The limit is 60 transport requests per minute per key and API process. On HTTP 429, `Retry-After` gives the wait in seconds. Each POST request carries a single JSON-RPC message of up to 16 KiB. A tool result is limited to 64 KiB and an internally read HTTP response to 4 MiB. On `result_too_large`, narrow the query or use the HTTP API directly.

The transport is stateless. Each request must supply the bearer key. HTTP 401 means authentication is missing or invalid. On HTTP 403, check fund permissions, host and origin. The reverse proxy must forward the public `Host`, including any non-default port. If supplied, the `Origin` must be listed exactly in `APP_ORIGIN`. Native clients can omit it. GET and DELETE on the transport return 405 to authorised clients. Individual calls use neither the HTTP batch endpoint nor an `Idempotency-Key`.

The access log records route patterns, status codes, durations and technical identifiers. It omits arguments, search text, response bodies and bearer keys.

## SDK

The hosting API uses `@modelcontextprotocol/server` 2.4.0 from the official TypeScript SDK. The package lists Apache-2.0. Its licence file notes that some contributions remain under MIT while relicensing is in progress. [TypeScript SDK and licence](https://github.com/modelcontextprotocol/typescript-sdk)
