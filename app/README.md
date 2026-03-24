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

`desktop:dev` and `desktop:build` automatically source `~/.cargo/env` if `cargo` is not already on your PATH.

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
- Current implementation uses static mock data and local component state.
- Next step is wiring screens to API endpoints in `services/api`.
