# Installing on your own server

This guide is for putting the system on a server you control: a single agency running its own copy, or you running the shared multi-agency service. You need a Linux server (2 GB of memory is enough to start), a domain name pointing at it, and Docker with the Compose plugin.

## 1. Get the files and make your settings

```bash
git clone <your copy of the code> recruitment && cd recruitment/app
cp .env.prod.example .env.prod
```

Open `.env.prod` and fill in at least:

| Setting | What to put |
| --- | --- |
| `ADMIN_DB_PASSWORD`, `APP_DB_PASSWORD` | Two different long passwords. Make them up and save them in your password manager. |
| `SESSION_SECRET`, `FIELD_ENCRYPTION_KEY` | Run `openssl rand -hex 32` twice and paste one into each. **Back up `FIELD_ENCRYPTION_KEY`.** If it is lost, ID and passport numbers cannot be read again. |
| `APP_URL` | The address people will use, for example `https://recruit.youragency.co.ke` (no slash at the end). |

**Single-agency install (you bought the system):** also set `TENANT_MODE=single` and paste the `LICENSE_PUBLIC_KEY` you were given. Keep the activation key for step 4.

**Shared multi-agency service (you sell it to other agencies):** leave `TENANT_MODE` empty and fill in the M-Pesa and card sections so agencies can pay you.

## 2. Start it

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d db
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile tools run --rm migrate
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d app worker
```

The first command starts the database. The second creates the tables. The third starts the website and the background worker (which sends messages and reminders and checks M-Pesa payments).

## 3. Put it behind HTTPS

The app listens on port 3000. Put a web server in front of it that handles the certificate. With Caddy, which gets certificates by itself, `/etc/caddy/Caddyfile` is just:

```
recruit.youragency.co.ke {
    reverse_proxy localhost:3000
}
```

Every page, and especially sign-in, must be served over HTTPS. M-Pesa will only send payment confirmations to an `https://` address that is reachable from the internet, so `APP_URL` must be that address.

## 4. First sign-in

- **Single install:** open your address. You are taken to a setup page. Paste the activation key, enter your agency's name and your own details, and you are in. Then go to **Settings** to add your team, turn on two-step sign-in, and add your M-Pesa details.
- **Shared service:** create the first platform administrator, then sign in at `/platform/login`:

  ```bash
  docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm \
    -e PLATFORM_ADMIN_PASSWORD='a long password of 12 or more characters' \
    --entrypoint npx migrate tsx scripts/create-platform-admin.ts you@example.com "Your Name"
  ```

  You will be asked to set up two-step sign-in straight away. Agencies sign themselves up at `/signup`.

## 5. Backups (do this on day one)

```bash
./scripts/backup.sh          # database + uploaded documents, into ./backups
```

Run it every night from `cron` and copy the `backups` folder to another machine or storage account. A backup that lives only on the same server will not help if the server is lost. To practise a restore on a spare machine: `./scripts/restore.sh backups/db-<date>.dump`.

Also keep a copy of `.env.prod` somewhere safe. Without `FIELD_ENCRYPTION_KEY` a restored database cannot show ID numbers.

## 6. Updating

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod build
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile tools run --rm migrate
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d app worker
```

Take a backup first. Migrations only add to the database and never delete your data.

## Optional pieces

- **SMS, email and WhatsApp:** SMS goes through BlessedTexts and email through Brevo. On a single install, fill in `BLESSEDTEXTS_API_KEY`, `BREVO_API_KEY`, `EMAIL_FROM` and the `WHATSAPP_*` settings. On the shared service, sign in to `/platform` and fill them in under **Settings** instead. Until you do, messages are recorded but not delivered, and the Messages sections say so. On the shared service each agency starts with 20 free SMS credits and buys more by M-Pesa; the price per credit is also under Settings.
- **Your own document storage (MinIO):** set `STORAGE_DRIVER=s3`, `S3_ENDPOINT=http://minio:9000`, `S3_FORCE_PATH_STYLE=true`, `S3_BUCKET`, and the access key and secret, then add `--profile minio` to the `up` command.
- **Virus scanning of uploads:** set `CLAMAV_HOST=clamav` and add `--profile clamav`. Add `CLAMAV_REQUIRED=true` to pause uploads whenever the scanner is down.
- **Agency addresses such as `acme.yourapp.co.ke` (shared service):** set `APP_DOMAIN=yourapp.co.ke` and point a wildcard DNS record `*.yourapp.co.ke` and a wildcard certificate at the server.

## Safaricom M-Pesa

Each agency adds its own paybill or till and Daraja keys under **Settings**. In `sandbox` mode nothing real is charged. Moving to `production` needs a Safaricom go-live approval for that paybill. The callback address is created for you from `APP_URL` and contains a secret that is different for every request.

## If something looks wrong

- `docker compose -f docker-compose.prod.yml logs app worker` shows what the app and worker are doing.
- Messages sit in the system as "queued" if the worker is not running: check `docker compose ps`.
- After an update, if a page shows a database error mentioning a "cached plan", restart the app: `docker compose restart app worker`.
