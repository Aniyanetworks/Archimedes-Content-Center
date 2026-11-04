# Archimedes Content Center

React admin dashboard, content editor and client review portal. There is no Node backend: the app is static files, data goes through Supabase with RLS, and the review endpoints are Supabase Edge Functions.

```
src/        React app (/admin for staff, /review/:token for clients)
supabase/   Database migrations, seed data, Edge Functions
templates/  The five MJML master designs
scripts/    Build tools: templates and n8n JSON
tests/      Spec section 14 scenarios against the real SQL
```

## Run it

```
npm install
npm run dev
```

With no Supabase keys it runs in demo mode with sample data held in the browser tab. Open `/review/demo` after signing in, by client-side navigation, to see the portal.

## Connect Supabase

1. Run in order: `supabase/migrations/0001_schema.sql`, `0002_engine.sql`, `0003_review_config.sql`, `0004_test_mode.sql`, `supabase/seed/reference.sql`, `supabase/seed/templates.sql`.
2. Deploy both functions with `--no-verify-jwt`, because each checks its own token:
   ```
   supabase functions deploy review --no-verify-jwt
   supabase functions deploy review-issue --no-verify-jwt
   ```
3. Create a staff user in Supabase Auth, then give it a role:
   ```sql
   insert into staff_roles (user_id, role) values ('<auth user id>', 'admin');
   ```
4. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Never the service role key.
5. When the site is deployed, set the `portal_url` row in `system_settings` to its address, so review links and CORS use it. The signing secret is generated in Vault automatically.

Deploy to Vercel or Netlify as a static site. `vercel.json` and `public/_redirects` handle routing.

## Commands

- `npm test`: database rules, review functions and all five templates
- `npm run build`: type-check and production build
- `npm run build:templates`: after changing `templates/`. To publish a design change, raise `VERSION` in the script so sent campaigns stay reproducible
- `npm run build:n8n`: regenerates `../n8n/*.json`

## Test mode

A new install starts in test mode. Under **Pause and safety**, admins can load sample data, send a test batch now, and reset everything. Reset removes test data including the audit log, and keeps staff, plans and templates. **Go live** is one-way: it permanently disables reset and restores full audit protection.

## Safe by default

A new install cannot reach real subscribers: `ghl_dry_run` and `safe_test_mode` are on, tenants start in test mode, and live dispatch stays blocked until a daily send cap is set.

## Waiting on Archimedes signoff (spec section 16)

Set as working values in `supabase/seed/reference.sql`: the Essentials template pair, final design names, and the Hospitality plan, which stays test-only until its terms are confirmed. The Protection Report still needs comparing against the original Equinox `.msg`, which was not in the files provided.
