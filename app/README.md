# TeamBeacon Frontend

This directory contains the TeamBeacon React 19 and Vite web frontend. Production assets are served by the TeamBeacon Python API in the container image.

## Local Development

1. Install dependencies:

```bash
cd app
npm install
```

2. Start UI + backend API together:

```bash
npm run dev
```

- Vite dev server: `http://localhost:5174`
- Local API: `http://localhost:8000`

If you only need the backend API:

```bash
npm run api:dev
```

## Build and Test

```bash
npm run typecheck
npm run lint
npm run build
npm run test
npm run test:coverage
```

Release web build:
```bash
npm run build:release
```

## Notes

- The frontend consumes TeamBeacon backend endpoints under `/api/*`.
- Vite proxies `/api/*` to the local API during development.
- Vite build output is generated under `app/web`.
- The multi-stage Docker build copies `app/web` into the Python runtime image.
