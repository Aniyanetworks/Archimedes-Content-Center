# n8n workflows

Import these into n8n, or use the copies already uploaded to the instance. All are inactive until you turn them on.

| File | Runs | Job |
|---|---|---|
| `01-phase0-ghl-proof` | Manual | Phase 0: create, schedule, read back and delete one campaign in a GHL **test** subaccount |
| `02-edition-queue` | Every 5 min | Creates a campaign per eligible tenant for each approved edition |
| `03-render-route` | Every 5 min | Renders HTML, stores the hash, routes to automatic or client review |
| `04-review-invites` | Every 5 min | Emails the signed review link |
| `05-review-deadlines` | Every 15 min | Holds missed deadlines and notifies the reviewer |
| `06-dispatch` | Every 5 min | Creates and schedules campaigns in GHL |
| `07-reconcile` | Every 15 min | Resolves unknown outcomes, records sent or failed |
| `08-emergency-cancel` | Every 5 min | Deletes canceled or paused campaigns from GHL |
| `09-ops-alerts` | Every 15 min | Emails alerts to operations |
| `10-error-handler` | On workflow error | Audit log entry and alert |

Change these files by editing `frontend/scripts/build-n8n.mjs` and running `npm run build:n8n` in `frontend/`.

## Setup

1. Create these credentials in n8n, then select them on the nodes that show a missing credential:
   - **Archemedies** (Supabase API): the project URL and the legacy `service_role` key
   - **Archimedes SMTP** (SMTP): the mailbox that sends review invites and alerts
   - **GHL Phase 0 Test Token** (Header Auth): `Authorization: Bearer <token>` for the **test** subaccount only
2. In every workflow's **Config** node, set `supabaseUrl`. In email nodes, set the From address.
3. Run workflow 01 by hand and read its output (see Phase 0 below).
4. Turn on 10, then 09, then 02 to 08. Sending stays simulated until `ghl_dry_run` is switched off under **Pause and safety**.

Tenant GHL tokens live in Supabase Vault, not in n8n. Store each one as `ghl_<location id>`:

```sql
select vault.create_secret('<private integration token>', 'ghl_<location id>');
```

## Phase 0 must pass before any live send

These came from GHL's public docs and have not been run against a real account:

| Action | Endpoint (`Version: v3`, `services.leadconnectorhq.com`) | Confirm in Phase 0 |
|---|---|---|
| Create draft | `POST /emails/locations/{id}/campaigns/emails` | HTML is stored unchanged; required scope (older doc pages say `emails/schedule.write`) |
| Schedule | `POST .../campaigns/emails/{id}/schedule` | `sendAt` format (the docs only show `2026-04-01 09:00 AM`) and that it is read in `timeZone` |
| Read state | `GET .../campaigns/emails/{id}` | Status values match what workflow 07 expects |
| Find after a lost response | `GET .../campaigns/emails?search=` | Search matches the idempotency key inside the name |
| Cancel | `DELETE .../campaigns/emails/{id}` | **Works on a scheduled campaign.** The docs do not say, and emergency cancel depends on it |
| Audience | `recipients.type: tag`, `tagIds` | IDs or names; suppression and unsubscribes are honored |
| Unsubscribe link | `{{email.unsubscribe_link}}` in the HTML | GHL resolves this merge tag |

Published rate limits: 100 requests per 10 seconds and 200,000 per day, per app per location. Not available on every account is still possible, so check each subaccount type.

Not built: delivery metric ingestion (the statistics endpoints could not be confirmed) and OAuth token refresh (use Private Integration Tokens to begin with).
