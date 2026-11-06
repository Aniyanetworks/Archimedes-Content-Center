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
| `11-delivery-check` | Every 15 min | Reads GHL delivery counts for sent campaigns and flags failed or partial delivery |

Change these files by editing `frontend/scripts/build-n8n.mjs` and running `npm run build:n8n` in `frontend/`.

## Setup

1. Create these credentials in n8n, then select them on the nodes that show a missing credential:
   - **Archemedies** (Supabase API): the project URL and the legacy `service_role` key
   - **Archimedes SMTP** (SMTP): the mailbox that sends review invites and alerts
   - **GHL Phase 0 Test Token** (Header Auth): `Authorization: Bearer <token>` for the **test** subaccount only
2. In every workflow's **Config** node, set `supabaseUrl`. Set the notification sender under **Pause and safety** in the admin app: workflows 04, 05 and 09 read it from Supabase, and stop with a clear error until it is set.
3. Run workflow 01 by hand and read its output (see Phase 0 below).
4. Turn on 10, then 09, then 02 to 08. Sending stays simulated until `ghl_dry_run` is switched off under **Pause and safety**.

Tenant GHL tokens live in Supabase Vault, not in n8n. Store each one as `ghl_<location id>`:

```sql
select vault.create_secret('<private integration token>', 'ghl_<location id>');
```

## Phase 0 results

Tested on 6 November 2026 against the Archimedes Home ServiceGenius subaccount, with a Private Integration Token, sending only to one internal test contact.

| Action | Endpoint (`Version: v3`, `services.leadconnectorhq.com`) | Result |
| --- | --- | --- |
| Create draft | `POST /emails/locations/{id}/campaigns/emails` | Works. Stored HTML is byte-for-byte identical, including `{{email.unsubscribe_link}}` and accents |
| Schedule | `POST .../campaigns/emails/{id}/schedule` | Works with `scheduleType: scheduled` and `sendAt` as `YYYY-MM-DD hh:mm AM` |
| Schedule again | same | Refused with 409, so a repeated call cannot double-send |
| Read state | `GET .../campaigns/emails/{id}` | Works. Returns status, sender and subject, but not the send time |
| Find after a lost response | `GET .../campaigns/emails?search=` | Works. Search matches the idempotency key in the name |
| Cancel | `DELETE .../campaigns/emails/{id}` | Works on a scheduled campaign. GHL keeps it in the list with status `cancelled`, and workflow 07 ignores those |

Still to confirm with a real send to the test contact:

- [x] `sendAt` is read in `timeZone`: a send set for 07:17 AM US/Eastern went out at 12:17:07 UTC, moving through `scheduled`, `processing` and `sent`
- [x] **Delivery check built:** workflow 11 reads `GET /emails/schedule?showStats=true&name=<idempotency key>` (`Version: 2021-07-28`), compares delivered with total, and flags failures on the dashboard with an alert. Timing comes from the `delivery_check_after_minutes` and `delivery_recheck_hours` settings
- [ ] **Delivery:** the 6 November test was marked `sent` by the campaign, but its email record shows `failed`, `5.7.1 Rejected due to high probability of spam`. The sending domain was not verified, so GHL rewrote the From address to its shared domain (`amail.msgsndrlj.com`). Campaign status `sent` does not mean delivered: the engine needs a delivery check, and each tenant needs a verified sending domain
- [ ] The unsubscribe link is replaced with a working link
- [ ] A cancelled campaign never sends: the 13 November 2026 test should not arrive
- [ ] Tag audiences (`recipients.type: tag`) use tag IDs and honor unsubscribes

Published rate limits: 100 requests per 10 seconds and 200,000 per day, per app per location. Not available on every account is still possible, so check each subaccount type.

Not built: delivery metric ingestion (the statistics endpoints could not be confirmed) and OAuth token refresh (use Private Integration Tokens to begin with).
