# Demo accounts (local development only)

> **For local development only.** The names, addresses, passwords and TOTP secrets below are fictional and public.
> They provide no protection and must never be used in production, on a reachable server or in a customer environment.
> The seed script rejects `CARRAWAY_UMGEBUNG=echt`.
>
> The seed script (`pnpm db:seed`) generates this file. Make changes in the generator.

Sign in with the email address and password, then enter the six-digit code from an authenticator app. Enter the secret
as its key (Base32, SHA-1, 6 digits, 30 seconds). To calculate a code without an app, run, for example,
`oathtool --totp -b <secret>`, substituting the TOTP secret.

| Name | Email | Password | TOTP secret | Role |
|---|---|---|---|---|
| Vera Beispiel | `vera@beispiel.example` | `Demo-Lokal-Verwaltung-1` | `KRSXG5CTMVRXEZLUKN2XAZLSNFXGO4TF` | Admin on all funds: users, roles, period lock and API keys |
| Frieda Beispiel | `frieda@beispiel.example` | `Demo-Lokal-Freigabe-1` | `MZRWC3TFOJQXIZLTONSWY2LUMVZGKZLB` | Approver: can review and approve (first person in the four-eyes workflow) |
| Friedrich Beispiel | `friedrich@beispiel.example` | `Demo-Lokal-Freigabe-2` | `MZRWI2LEMJSWK5DSOVZWK4TTNFXGM3DB` | Approver: second person in the four-eyes workflow |
| Berta Beispiel | `berta@beispiel.example` | `Demo-Lokal-Bearbeitung-1` | `MJSXEYLSMNXGG33NNRSWC5DFMZRXGZLT` | Editor: records data without approval rights |
| Bernd Beispiel | `bernd@beispiel.example` | `Demo-Lokal-Ansicht-1` | `MJSXEZLOMFZGK43FNZSWO3DPNRSXE2LO` | Viewer on the first fund only |
| Rita Beispiel | `rita@beispiel.example` | `Demo-Lokal-Kontakte-1` | `OJUXIYJAMJSWS43QNFSWYIDLN5XHIYLL` | Relationship Management group: maintains contacts and has no access to finance, deals or accounting |
| Carl Beispiel | `carl@beispiel.example` | `Demo-Lokal-Controlling-1` | `MNQXE3BAMJSWS43QNFSWYIDDN5XHI4TP` | Fondsmanagement und Controlling group (editor on the first fund only), with a viewer override on the second fund |

Recovery codes (each works once in place of a TOTP code): `demo-verw-0001`, `demo-verw-0002`; `demo-frei-0001`, `demo-frei-0002`; `demo-frei-0003`, `demo-frei-0004`; `demo-bear-0001`, `demo-bear-0002`; `demo-ansi-0001`, `demo-ansi-0002`; `demo-kont-0001`, `demo-kont-0002`; `demo-cont-0001`, `demo-cont-0002`.

## Try four-eyes approval

1. As Berta (editor), calculate an interest run.
2. As Frieda (approver), review it.
3. Try to approve as Frieda. The request is rejected (`four_eyes_violated`) because one person cannot both review and approve.
4. Approve as Friedrich (approver). The request succeeds.

The seed script assigns roles based on the demo data. Vera is an admin on all funds, Frieda and Friedrich are
approvers, Berta is an editor and Bernd can see only the first fund.

## Try roles and groups

The seed script creates example roles and user groups (Administration → Roles and groups, see `docs/permissions-model.md`).
- **Investmentmanagement** (Investments and dealflow across all funds): Level editor, roles Investments, funds follow the central setting
- **Fondsmanagement und Controlling** (Finance and reports for the first fund): Level editor, roles Finanzen und Berichte, fund 1 only
- **Relationship Management** (Manage contacts without access to financial data): Level editor, roles Kontakte, funds follow the central setting

Rita belongs to Relationship Management and sees only contacts. Carl belongs to Fondsmanagement und Controlling (first fund)
and has a direct viewer override on the second fund. The other accounts belong to no group and keep all areas.

## LP portal accounts

The two investor accounts have no fund role and only see the managed hosting portal at `/portal`. They see their own capital
account, approved reports and capital call and distribution notices. All internal pages and routes are blocked. Sign in as above
with the password and then the TOTP code. The interface takes the investor to the portal after sign-in.

| Name | Email | Password | TOTP secret | Access |
|---|---|---|---|---|
| Ilse Beispiel | `ilse.lp@beispiel.example` | `Demo-Lokal-Portal-1` | `OJXXK3TFNZ2GK4TSMVZGK3DFNZSWIZLT` | Investor portal account: sees only the first demo investor’s account |
| Ingo Beispiel | `ingo.lp@beispiel.example` | `Demo-Lokal-Portal-2` | `PFXGK5BAOBSXEYLSNFXHGZLTMVWGK3TF` | Investor portal account: sees only the second demo investor’s account |

Recovery codes: `demo-port-0001`, `demo-port-0002`; `demo-port-0003`, `demo-port-0004`.

Notices appear in the portal once an approver approves them for a fund movement
(`POST /api/v1/funds/:id/movements/:movementId/notices/approve`). The approver must be someone other than the person who recorded the movement.
