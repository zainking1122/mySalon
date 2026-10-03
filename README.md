# Abid Salon

A JavaScript hair salon website with an Express backend and a built-in SQLite database.

## Run locally

```bash
npm install
copy .env.example .env
npm start
```

Set `DATABASE_PATH` in `.env` to choose the SQLite database file; it defaults to `data/salon.sqlite`. Node.js 22.5 or newer is required for the built-in SQLite module. On first startup, the current JSON settings, services, and appointments are imported; subsequent website updates are written to SQLite. Appointments, complaints, owner settings, and service catalog changes are persisted there.

Open `http://localhost:3000`. The site works without SMTP configured; submitted appointments are saved in SQLite and appear in the private owner dashboard. Email delivery uses Gmail SMTP. Turn on 2-Step Verification for `salonabid46@gmail.com`, create a Google App Password, and replace `SMTP_PASS` in `.env` with that 16-character App Password. Do not use the normal Gmail password.

## Owner controls

Open `/owner` after deployment and sign in with `OWNER_PASSWORD` to see the private appointment dashboard. Appointment contact details are available only through the authenticated owner session; the public website does not load the appointment list. Entries older than 30 days are automatically removed at server startup, every hour while the server runs, when the owner dashboard is opened, and when a new appointment is created. Appointments from the most recent 30 days are retained.

The authenticated `POST /api/owner/settings` endpoint accepts `men`, `women`, and `custom` to control which audience categories can book.

For deployment, set `DATABASE_PATH` to a location on a persistent disk/volume provided by the host, along with the existing owner and SMTP settings. The default local `data/salon.sqlite` file is suitable only when the deployment preserves that directory across restarts and redeploys; ephemeral filesystems will lose updates.