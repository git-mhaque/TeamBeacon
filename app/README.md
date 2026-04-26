# TeamBeacon Frontend (OJET + Tauri)

This directory is the single TeamBeacon frontend workspace using Oracle JET (vDOM) and the Tauri desktop shell.

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

## Desktop (Tauri)
Prerequisites:
- Rust toolchain (`rustup`, `cargo`, `rustc`)
- Platform dependencies for Tauri (Xcode command line tools on macOS)

Commands:
```bash
npm run desktop:dev
npm run desktop:build
```

## Notes
- The frontend consumes TeamBeacon backend endpoints under `/api/*`.
- OJET build output is generated under `app/web`.
- Tauri is configured to use OJET dev URL (`5174`) and production output (`web`).
