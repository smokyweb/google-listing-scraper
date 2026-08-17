# Google Listing Scraper

Admin portal for scraping Google business listings, managing leads, and running outreach campaigns (email, phone calls, SMS).

## Quick Start

```bash
# Install all dependencies
npm run install:all

# Start development (server + client with hot reload)
npm run dev

# Or build and run production
npm run build
npm start
```

App runs on **http://localhost:3001**. Default login password: `admin`

## Features

- **Dashboard** — Stats overview: leads scraped, emails sent, calls made, SMS sent, meetings booked
- **Scraper** — Search by keyword + city + state via Google Places API
- **Leads** — Full leads table with search, pagination, and CSV export
- **Email Campaign** — Compose HTML templates with placeholders, preview, send to all/selected
- **Phone Calls** — Call script with ElevenLabs TTS preview, SignalWire outbound calls with IVR (press 1 = transfer, press 2 = SMS)
- **SMS** — Compose messages with scheduling link, send via SignalWire
- **Calendar** — Google Calendar OAuth, view upcoming bookings
- **Settings** — Manage all API keys and config from the UI

All features work in **mock mode** when API keys aren't configured.

## Environment Variables

Copy `.env.example` to `.env` and fill in your keys:

```
GOOGLE_PLACES_API_KEY=         # Google Places API key for scraping
SIGNALWIRE_PROJECT_ID=         # SignalWire project ID
SIGNALWIRE_TOKEN=              # SignalWire API token
SIGNALWIRE_SPACE_URL=          # e.g. example.signalwire.com
SIGNALWIRE_PHONE_NUMBER=       # Your SignalWire phone number (+E.164)
TRANSFER_PHONE_NUMBER=         # Phone number for IVR call transfers
ELEVENLABS_API_KEY=            # ElevenLabs API key for TTS
ELEVENLABS_VOICE_ID=           # ElevenLabs voice ID
SMTP_HOST=smtp.mailgun.org                  # Mailgun SMTP host
SMTP_PORT=2525                         # Mailgun SMTP port
SMTP_USER=apps@bluesapps.com            # Mailgun SMTP username
SMTP_PASS=YOUR_MAILGUN_API_KEY_HERE  # Mailgun SMTP password
SMTP_FROM="Bluesapps" <apps@bluesapps.com> # Mailgun 'From' email address and name
GOOGLE_CALENDAR_CLIENT_ID=     # Google OAuth client ID
GOOGLE_CALENDAR_CLIENT_SECRET= # Google OAuth client secret
ADMIN_PASSWORD=admin           # Admin portal password
JWT_SECRET=change-me           # JWT signing secret
PORT=3001                      # Server port
```

## Deployment (Coolify)

For deployment on `bluesapps.com` via Coolify, ensure all sensitive environment variables listed above are configured directly in your Coolify application settings. This is crucial for security and proper operation in production.

- **Subdomain:** `scraper-leads.bluesapps.com` (or `leads.bluesapps.com`)
- **Admin Portal Password:** `ADMIN_PASSWORD` (set securely in Coolify, defaults to `admin` locally)
- **JWT Secret:** `JWT_SECRET` (set securely in Coolify, essential for session security)

Follow the standard bluesapps deployment workflow: push changes to GitHub (`smokyweb/google-listing-scraper`), then trigger/monitor deployment via Coolify.

All features work in **mock mode** when API keys aren't configured.

## Tech Stack

- **Backend:** Node.js, Express, better-sqlite3
- **Frontend:** React, Vite, Tailwind CSS (dark theme)
- **APIs:** Google Places, SignalWire (calls/SMS), ElevenLabs (TTS), Nodemailer (SMTP), Google Calendar OAuth
