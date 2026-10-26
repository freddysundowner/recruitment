# Recruitment Agency System

Runs an overseas recruitment agency from a candidate's first registration to their deployment and follow-up abroad: candidates and documents, employers and job orders, a gated nine-stage pipeline, visa and travel, contracts, the money (costs the agency fronts, employer invoices, candidate fees, M-Pesa), messages, reports, and portals for candidates and employers.

One codebase serves two products:

- **Shared service.** Many agencies on one installation, each walled off from the others, on subscription plans, with self-service signup, billing, and a console for the platform owner.
- **Single-agency install.** One agency on its own server, unlocked by a signed activation key, with no billing or platform layer.

Built with Next.js 16, TypeScript, Tailwind and PostgreSQL.

## Run it on your computer

You need Node 24+ and Docker.

```bash
npm install
cp .env.example .env.local      # then set SESSION_SECRET to a long random string
npm run db:up                   # PostgreSQL on port 5434
npm run migrate                 # creates the tables
npm run seed                    # demo agencies, staff, employers, candidates (development only)
npm run dev -- -p 3100          # the website
npm run worker                  # in a second terminal: sends messages and reminders
```

Open http://localhost:3100. Sign-ins created by `npm run seed` (all use the password `Password123!`, except the platform owner):

| Who | Where | Email |
| --- | --- | --- |
| Agency admin | `/login` | admin@demo.test |
| Recruiter, documentation officer, finance officer | `/login` | recruiter@, docs@, finance@demo.test |
| Employer (two companies) | `/login` | employer@alnoor.test, employer@gulfcare.test |
| A second agency, to see isolation | `/login` | admin@other.test |
| Candidates | `/c/demo` | register with any phone; the code is shown on screen in test mode |
| Platform owner | `/platform/login` | platform@demo.test / `PlatformDemo123!` (you set up two-step sign-in on first use) |

`MPESA_MODE=mock` and `PORTAL_DEV_OTP=true` in `.env.local` make M-Pesa and sign-in codes work without Safaricom or an SMS provider. Never run `npm run seed` against a real database.

## A guided experience

- **A front page** for visitors (`/`), with the product, plans and a free trial. Agencies sign themselves up at `/signup` and are in a working workspace in under a minute.
- **A "what next?" dialog** appears after every important action, for agency staff, employers and candidates alike. After adding a candidate it suggests uploading documents or matching a job; after moving a candidate to a stage it explains what that stage needs and links straight to the right section. The suggestions live in `src/lib/next-steps.ts`.
- **A setup checklist and a "needs your attention" list** on the dashboard, so an agency always knows the next useful thing to do.
- **Sample data** (`/getting-started`): ten candidates at different stages, three employers and three jobs, with documents, costs, a contract, an interview and a complaint, so a new agency can try everything before entering real records. It is removed in one click, and sample people are never messaged or charged.

## What it does

**Agency staff**
- Candidates: registration with recorded consent, duplicate detection by ID number and phone, CSV import, search, documents with expiry alerts and a verification queue, complaints, data requests.
- Employers and job orders: vetting checks, who-pays-costs per job order, quantity limits, requests from employers that staff approve.
- Pipeline of nine stages, defined as data. Gates block a move until the rules are met: verified documents (or the destination country's checklist), fees paid, job order assigned, employer vetted, **candidate's and employer's contract copies agree** (a mismatch flags possible contract substitution), visa approved, orientation done, arrival confirmed. Only an admin can override, with a logged reason. The vetting and contract-comparison gates can be switched off in Settings > Pipeline (new workspaces start with them off).
- One page per candidate. It opens with a "Do this now" panel that ticks off what the next stage needs, with a button that unlocks when nothing is missing; documents, contract, visa and travel, appointments, money, messages and history sit below as sections that open themselves when they matter. The sidebar has six items (Home, To do, Candidates, Employers and jobs, Money, Settings); related pages are tabs. "To do" gathers documents to check, applicants, due check-ins, appointments, complaints, stuck candidates and privacy requests in one list.
- Visa and travel, appointments, follow-up check-ins scheduled automatically after deployment, country checklists.
- Money: cost ledger with reversals instead of edits, candidate fee charges and receipts, employer invoices in other currencies with the exchange rate stored, **cash exposure** (money out for employer-paid placements not yet repaid), receivables, profit per worker, M-Pesa collection from the placement page.
- Reports and CSV exports (spreadsheet-safe), including a deployment register. Messages log. Audit trail.

**Candidates** (`/c/<agency>`, built for phones): phone and one-time-code sign-in, self-registration, progress tracker and what to do next, upload documents, apply for jobs, see fees and receipts, pay with M-Pesa, raise complaints and follow them, download or ask to delete their information.

**Employers** (`/employer`): review shortlisted candidates (no phone or ID shown), request interviews, select or decline with a reason, record their signed contract terms, request workers, see invoices and payments.

**Platform owner** (`/platform`): agencies, plans and prices, subscription payments, record bank payments, extend trials, suspend, read-only support access with a reason shown in the agency's own log, administrators. Agencies pay by M-Pesa or card on their Billing page.

## How it is kept safe

- **Agency walls in the database.** Every table has `tenant_id` and row-level security. The app signs in to the database as a role that is not the owner and cannot bypass the wall.
- **Candidate and employer walls too.** A candidate's session can reach only that candidate's rows, an employer's only its own jobs, enforced by the database, so a forgotten filter in code cannot leak data. Tests prove it. Deleting a candidate at their request removes their details, documents, messages and name from the audit trail, and keeps the money records without a name.
- **Append-only records.** Costs, payments, stage history, contracts and the audit log cannot be edited or deleted by the app.
- **Sensitive data.** ID and passport numbers and saved API secrets are encrypted (AES-256-GCM) with a keyed hash for search and duplicate checks. Documents are private, served only to signed-in people who may see them, with every view logged. Uploads are checked for real file type and optionally virus scanned.
- **Sign-in.** Two-step sign-in (authenticator app and recovery codes), required for the platform owner and optional or required by agencies. Throttled attempts. Candidates use one-time codes that expire, lock after 5 wrong tries, and are stored only as hashes.
- **Payments.** M-Pesa callbacks carry a secret per request, are ignored if repeated, and a success for a different amount is held, not trusted. Stripe webhooks are signature-checked. A payment reference can only be recorded once.
- **Support access** is read-only, time-limited, and visible to the agency.

## Tests

```bash
npm test
```

84 tests run against the local database and roll back everything they touch. They cover agency, candidate and employer isolation; every pipeline gate and the override rules; M-Pesa and Stripe handling; one-time codes; two-step codes (against the official RFC test vector); encryption; plans, limits and the grace period; activation keys; and CSV safety.

If `vitest` says "Cannot find native binding" on macOS, npm skipped an optional package: `npm i -D --no-save @rolldown/binding-darwin-x64` (or `-arm64`).

## End-to-end test

With the app running (`npm run dev`) and the demo data seeded:

```bash
npm run e2e
```

`e2e/journey.mjs` drives a real browser through a brand-new agency: sign-up, employer and vetting, job order, a candidate through all nine stages with documents, contract, visa and arrival, money, an employer portal login, every sidebar and settings page, and a candidate registering. `e2e/platform-and-mobile.mjs` opens the platform console and checks the main pages at phone width. Both need Chromium from a Playwright install (`npx playwright-core install chromium`) and create a fresh agency each run.

## Settings reference

All are in `.env.example` and `.env.prod.example`. The important ones: `SESSION_SECRET`, `FIELD_ENCRYPTION_KEY` (back this up), `APP_URL`, `TENANT_MODE` (`single` for one agency), `LICENSE_PUBLIC_KEY`, provider keys for SMS, WhatsApp, email, M-Pesa and Stripe, and storage and scanning options.

## Selling single installs

```bash
npm run license:keys                                                       # once: your signing key
npm run license:issue -- --customer "Acme Recruiters" --perpetual --users 10
npm run license:issue -- --customer "Acme Recruiters" --days 365 --users 10 --updates-days 365
```

Your private key lives in `~/.recruitment-licence/`, never on a customer's server. Put the printed public key in the customer's `LICENSE_PUBLIC_KEY`. Keys are checked offline. A rented key that has ended gives 30 days of grace, then the system becomes read-only until a new key is pasted in Settings. A perpetual key never ends.

## Putting it on a server

See [INSTALL.md](INSTALL.md): Docker Compose, HTTPS, first sign-in, nightly backups (`scripts/backup.sh`), updating.

## Layout

```
db/migrations/      the database, in order (applied by scripts/migrate.ts)
scripts/            migrate, seed, worker, backups, licence and admin tools
src/lib/            rules and plumbing: db, sessions, permissions, pipeline gates, money, plans, M-Pesa, crypto
src/app/actions/    every change the app makes (server actions)
src/app/(app)/      agency staff screens
src/app/c/[slug]/   candidate portal       src/app/employer/   employer portal
src/app/platform/   platform console       src/app/api/        M-Pesa and Stripe webhooks
tests/              the 84 tests
```

## What has and has not been tried against the real thing

Tried here: everything above on a local database, in a browser, and the production Docker images (web app, worker, migrations) run as INSTALL.md describes.

**Written to each provider's documentation but not tried against a live account**, because that needs your credentials: Safaricom Daraja (M-Pesa runs in demo mode here), Africa's Talking SMS, WhatsApp Business, SMTP email, Stripe Checkout, S3 or MinIO storage, and ClamAV. Test each in its sandbox before relying on it. The WhatsApp provider needs message templates approved by Meta for business-started messages.

**Not built:** a native phone app, automatic CV parsing and job matching, electronic signing of contracts, email verification of new signups, and per-agency custom domains (agencies get `/c/<name>`, and `<name>.your-domain` if you set `APP_DOMAIN`).
