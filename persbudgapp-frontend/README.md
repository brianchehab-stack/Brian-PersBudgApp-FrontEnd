# Personal Budget App Frontend

This frontend is ready to talk to a server-side API for transactions and budgets.

## Backend Setup

Set `VITE_API_BASE_URL` before running the app. Use the base API path, for example:

```bash
VITE_API_BASE_URL=http://localhost:3000/api
```

The frontend expects these endpoints:

- `POST /auth/login`
- `POST /auth/register`
- `GET /transactions`
- `POST /transactions`
- `PUT /transactions/:id`
- `DELETE /transactions/:id`
- `GET /budgets`
- `POST /budgets`
- `PUT /budgets/:id`

Authentication responses should include a token field (for example `token`, `accessToken`, or `jwt`) and may include a `user` object.

If the backend cannot be reached, the app falls back to local demo data so the UI still works during development.
