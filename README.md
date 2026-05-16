# Serenity AI

Serenity AI is the WhatsApp booking and staff dashboard system for Serenity Royale Hospital.

## Repository Map

- `apps/admin-dashboard/` - Next.js staff dashboard for bookings, urgent messages, patients, chats, reports, and hospital setup.
- `packages/functions/` - Supabase Edge Functions and shared booking, notification, WhatsApp, calendar, and email logic.
- `packages/supabase/migrations/` - Application database migrations maintained with the codebase.
- `supabase/` - Supabase CLI config, remote baseline migrations, and the `functions` symlink used by Supabase deploy commands.
- `tests/` - Playwright smoke and live-safe regression tests.
- `docs/operations/` - live handoff, deployment notes, and current project status.
- `docs/qa/` - dashboard action inventory and release checklists.
- `docs/readiness/` - provider readiness notes for Meta and Twilio backup.
- `docs/archive/` - old proposals, compliance drafts, and historical reference material.
- `Serenity Video Demo/` - Remotion demo video project and its media assets.
- `Agent skills/` - user-owned private operating files. Do not edit, move, or clean this folder during repository hygiene work.

## Current Live Services

- Dashboard: `https://admin-dashboard-wine-rho.vercel.app`
- Supabase project ref: `iwkkhuozhfzmpvroprpv`
- Live WhatsApp provider: Meta Cloud API
- Backup WhatsApp provider: Twilio

## Common Commands

```bash
npm run test:unit
npm run test:integration
npm run type-check -w apps/admin-dashboard
npm run lint -w apps/admin-dashboard
npm run build -w apps/admin-dashboard
npm run test:smoke
```

Load local environment files before live smoke checks:

```bash
set -a
source .env.local
source apps/admin-dashboard/.env.local
set +a
export SMOKE_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL"
export SMOKE_SUPABASE_FUNCTIONS_URL="${NEXT_PUBLIC_SUPABASE_URL%/}/functions/v1"
export SMOKE_SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY"
export RUN_LIVE_SMOKE=1
npm run test:smoke
```

## Documentation

- Live handoff: `docs/operations/AI_HANDOFF.md`
- Deployment notes: `docs/operations/DEPLOYMENT.md`
- Project status: `docs/operations/PROJECT_STATUS.md`
- Dashboard QA checklist: `docs/qa/DASHBOARD_ACTION_INVENTORY.md`

Secrets, passwords, and tokens must stay in runtime platforms or local ignored env files only.
