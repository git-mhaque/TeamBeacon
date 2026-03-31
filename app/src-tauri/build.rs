fn main() {
  tauri_build::try_build(
    tauri_build::Attributes::new().app_manifest(
      tauri_build::AppManifest::new().commands(&["prefs_get", "prefs_set", "prefs_remove"]),
    ),
  )
  .expect("failed to run tauri build helpers");
}
