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

`npm run dev` now starts both:
- local API on `127.0.0.1:8000`
- Vite UI on `localhost:5173` (or next free port if 5173 is busy)

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

`desktop:dev` and `desktop:build` automatically source `~/.cargo/env` if `cargo` is not already on your PATH.

## JIRA Integrations Screen Connectivity
`npm run dev` is the recommended path and starts everything needed for the Integrations screen.

If you want to run only the API service:

```bash
cd app
npm run api:dev
```

The Vite dev server proxies `/api/*` requests to `http://127.0.0.1:8000`.
The npm scripts auto-clean stale generated `vite.config.js` artifacts so proxy config from `vite.config.ts` is always used.

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

## Troubleshooting: `cargo metadata` Not Found
If you see:

```text
failed to run command cargo metadata ... No such file or directory (os error 2)
```

Install Rust once:

```bash
xcode-select -p || xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

For future terminal sessions:

```bash
echo 'source "$HOME/.cargo/env"' >> ~/.zshrc
```

## Notes
- Most screens still use mock data and local component state.
- Integrations is wired to the local API endpoint in `services/api`.
