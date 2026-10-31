# SN Practice CRM API

This is the standalone HTTP backend for the clean-slate CRM. It uses a repository interface with a seeded in-memory adapter; a database adapter can replace it without changing the HTTP or application modules.

## Run locally

From this directory:

```powershell
npm run dev
```

The API listens on `http://127.0.0.1:8788` by default. `PORT` and `HOST` can override the listener. `LOCAL_WEB_ORIGINS` accepts a comma-separated list of local HTTP origins only.

Demo authentication is intentionally explicit: fetch `GET /api/v1/demo/actors`, then send the chosen actor id in `x-demo-user-id` on protected requests. The server resolves the role from its repository and never trusts a client-supplied role.

## Routes

- `GET /health`
- `GET /api/v1/demo/actors`
- `GET /api/v1/session`
- `GET|POST /api/v1/assignments`
- `POST /api/v1/assignments/:id/transitions`
- `GET|POST /api/v1/recurring-schedules`
- `PATCH /api/v1/recurring-schedules/:id`
- `GET|POST /api/v1/work-items`
- `POST /api/v1/work-items/:id/transitions`
- `GET /api/v1/reporting-lines`
- `PUT /api/v1/reporting-lines/:employeeId`
- `GET /api/v1/office-accounts/summary`
- `GET|POST /api/v1/office-accounts/entries`

Every JSON response includes a request id. Errors use `{ error: { code, message, details? }, requestId }`.
