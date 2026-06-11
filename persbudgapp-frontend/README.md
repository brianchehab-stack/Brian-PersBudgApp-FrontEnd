# Personal Budget App Frontend

This frontend is ready to talk to a server-side API for transactions and budgets.

## Simple Project Activation

1. Open a terminal in the `persbudgapp-frontend` folder.
1. Install dependencies:

```bash
npm install
```

1. Create a `.env` file in this folder and add:

```bash
VITE_API_BASE_URL=http://localhost:3000/api
```

1. Start the app:

```bash
npm run dev
```

1. Open the URL shown in the terminal (usually `http://localhost:5173`).

For production build preview:

```bash
npm run build
npm run preview
```

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
