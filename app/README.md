# TeamBeacon UI Shell

This app is the initial React + Vite shell plus a Tauri desktop wrapper for TeamBeacon UI flows.

## Screens Included
1. Integrations & Field Mapping
2. Initiative Insights
3. Team Insights
4. Individual Insights
5. Current Sprint Work
6. Executive Report

## Local Development
```bash
cd app
npm install
npm run dev
```

## Desktop Development (Tauri)
Prerequisites:
- Rust toolchain (`rustup`, `cargo`, `rustc`)
- Platform dependencies required by Tauri (for macOS, Xcode command line tools)

Commands:
```bash
cd app
npm install
npm run desktop:dev
```

## Build
```bash
cd app
npm run build
```

## Desktop Build
```bash
cd app
npm run desktop:build
```

## Notes
- Current implementation uses static mock data and local component state.
- Next step is wiring screens to API endpoints in `services/api`.
