use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

const PREFERENCES_FILE_NAME: &str = "preferences.json";

fn normalize_preference_key(key: &str) -> Result<String, String> {
  let normalized = key.trim().to_string();
  if normalized.is_empty() {
    return Err("Preference key cannot be empty.".to_string());
  }
  if normalized.len() > 256 {
    return Err("Preference key is too long.".to_string());
  }
  Ok(normalized)
}

fn preferences_file_path(app: &AppHandle) -> Result<PathBuf, String> {
  let mut dir = app
    .path()
    .app_config_dir()
    .map_err(|err| format!("Unable to resolve app config directory: {err}"))?;
  fs::create_dir_all(&dir)
    .map_err(|err| format!("Unable to create app config directory {}: {err}", dir.display()))?;
  dir.push(PREFERENCES_FILE_NAME);
  Ok(dir)
}

fn read_preferences(path: &PathBuf) -> Result<HashMap<String, String>, String> {
  if !path.exists() {
    return Ok(HashMap::new());
  }
  let raw = fs::read_to_string(path)
    .map_err(|err| format!("Unable to read preferences file {}: {err}", path.display()))?;
  if raw.trim().is_empty() {
    return Ok(HashMap::new());
  }
  serde_json::from_str::<HashMap<String, String>>(&raw)
    .map_err(|err| format!("Unable to parse preferences file {}: {err}", path.display()))
}

fn write_preferences(path: &PathBuf, values: &HashMap<String, String>) -> Result<(), String> {
  let payload = serde_json::to_string_pretty(values)
    .map_err(|err| format!("Unable to serialize preferences payload: {err}"))?;
  fs::write(path, payload)
    .map_err(|err| format!("Unable to write preferences file {}: {err}", path.display()))
}

#[tauri::command]
fn prefs_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
  let normalized_key = normalize_preference_key(&key)?;
  let path = preferences_file_path(&app)?;
  let values = read_preferences(&path)?;
  Ok(values.get(&normalized_key).cloned())
}

#[tauri::command]
fn prefs_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
  let normalized_key = normalize_preference_key(&key)?;
  let path = preferences_file_path(&app)?;
  let mut values = read_preferences(&path)?;
  values.insert(normalized_key, value);
  write_preferences(&path, &values)
}

#[tauri::command]
fn prefs_remove(app: AppHandle, key: String) -> Result<(), String> {
  let normalized_key = normalize_preference_key(&key)?;
  let path = preferences_file_path(&app)?;
  let mut values = read_preferences(&path)?;
  if values.remove(&normalized_key).is_some() {
    write_preferences(&path, &values)?;
  }
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![prefs_get, prefs_set, prefs_remove])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
