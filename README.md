# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Local demo (no credentials required)

The CRM now has a separate native Node practice server in addition to the
TanStack frontend. Run both processes:

```sh
npm install
npm run api:dev
```

In a second terminal:

```sh
npm run dev
```

Open the printed frontend URL and choose **Enter local demo**. The browser demo
session supplies the fixed `local-demo-token`; the practice server accepts that
token only while `PRACTICE_API_MODE=demo`. The dashboard is deterministic and
does not require Lovable or Supabase credentials.

The server exposes:

- `GET /health`
- `POST /v1/query` for the headline strip, Collections Snapshot, Top Client
  Outstanding, Billing & Collections, and All Open Assignments
- `POST /v1/operations` for version-checked, idempotent assignment transitions

For example:

```sh
curl http://127.0.0.1:8787/v1/query \
  -H "Authorization: Bearer local-demo-token" \
  -H "Content-Type: application/json" \
  -d '{"type":"dashboard.get","input":{"months":6}}'
```

Assignment transitions require an `Idempotency-Key` header and the assignment's
current `version`. Repeating the same request with the same key returns the same
operation receipt; reusing the key for different input is rejected.

### Supabase mode

Set `VITE_USE_LOCAL_DEMO=false`, `PRACTICE_API_MODE=supabase`, and provide
`SUPABASE_URL` plus `SUPABASE_PUBLISHABLE_KEY`. The dashboard server validates
the caller's access token and performs every dashboard query through that user's
Supabase client, so existing row-level-security policies remain the permission
boundary.

Apply the included database migrations before enabling write operations.
`SUPABASE_SERVICE_ROLE_KEY` is required only for server-owned operation
receipts and append-only audit events; it is never used for dashboard reads.
Restrict browser access with `PRACTICE_API_ALLOWED_ORIGINS` rather than a
wildcard.

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
