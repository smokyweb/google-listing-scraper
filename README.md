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
SMTP_HOST=                     # SMTP server host
SMTP_PORT=587                  # SMTP port
SMTP_USER=                     # SMTP username
SMTP_PASS=                     # SMTP password
SMTP_FROM=                     # From email address
GOOGLE_CALENDAR_CLIENT_ID=     # Google OAuth client ID
GOOGLE_CALENDAR_CLIENT_SECRET= # Google OAuth client secret
ADMIN_PASSWORD=admin           # Admin portal password
JWT_SECRET=change-me           # JWT signing secret
PORT=3001                      # Server port
```

Settings can also be configured from the Settings page in the UI. Environment variables take priority.

## Tech Stack

- **Backend:** Node.js, Express, better-sqlite3
- **Frontend:** React, Vite, Tailwind CSS (dark theme)
- **APIs:** Google Places, SignalWire (calls/SMS), ElevenLabs (TTS), Nodemailer (SMTP), Google Calendar OAuth
