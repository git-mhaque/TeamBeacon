# TeamBeacon Frontend (OJET)

This directory contains the TeamBeacon Oracle JET web frontend. Production assets are served by the TeamBeacon Python API in the container image.

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
- OJET dev server: `http://localhost:5174`
- Local API: `http://localhost:8000`

If you only need the backend API:
```bash
npm run api:dev
```

## Build and Test
```bash
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
- OJET build output is generated under `app/web`.
- The multi-stage Docker build copies `app/web` into the Python runtime image.
