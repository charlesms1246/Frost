mod key_store;
mod permission_spec;
mod wallet_bridge;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

/// Reveal + focus the main window (from the tray).
fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Called by the splash window once its preloader finishes: reveal the main
/// window (which loaded hidden and has already routed to dashboard/signup) and
/// close the splash. Idempotent — missing windows are simply skipped.
#[tauri::command]
fn finish_splash(app: tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
    if let Some(splash) = app.get_webview_window("splashscreen") {
        let _ = splash.close();
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DemoCredentials {
    session_key: Option<String>,
    rpc_url: Option<String>,
    api_key: Option<String>,
    api_secret: Option<String>,
    wallet_id: Option<String>,
    wallet_address: Option<String>,
    swap_method_id: Option<String>,
}

fn env_from_file(contents: &str, key: &str) -> Option<String> {
    for line in contents.lines() {
        let line = line.trim();
        if line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            if k.trim() == key {
                let v = v.trim().trim_matches(|c| c == '"' || c == '\'');
                if !v.is_empty() {
                    return Some(v.to_string());
                }
            }
        }
    }
    None
}

/// DEV / DEMO ONLY: read funded credentials from the repo `.env` so the `/runtime`
/// dashboard can run the proven funded-session-key path live on Base Sepolia (real
/// issuance / 1Shot swap / audit commit / revocation). Returns nulls when no `.env`
/// is found (e.g. a packaged build) — then `/runtime` stays fully simulated. The
/// webview holds the result in memory only; it is never persisted.
#[tauri::command]
fn load_demo_credentials() -> DemoCredentials {
    let candidates: Vec<String> = [
        std::env::var("FROST_ENV_FILE").ok(),
        Some(".env".to_string()),
        Some("../.env".to_string()),
        Some("../../.env".to_string()),
        Some("D:\\Frost\\.env".to_string()),
    ]
    .into_iter()
    .flatten()
    .collect();
    let mut contents = String::new();
    for c in candidates {
        if let Ok(s) = std::fs::read_to_string(&c) {
            contents = s;
            break;
        }
    }
    let get = |k: &str| -> Option<String> {
        std::env::var(k)
            .ok()
            .filter(|v| !v.is_empty())
            .or_else(|| env_from_file(&contents, k))
    };
    DemoCredentials {
        session_key: get("BASE_SEPOLIA_PK"),
        rpc_url: get("BASE_SEPOLIA_HTTP"),
        api_key: get("ONESHOT_API_KEY"),
        api_secret: get("ONESHOT_API_SECRET"),
        wallet_id: get("ONESHOT_WALLET_ID"),
        wallet_address: get("ONESHOT_WALLET_ADDRESS"),
        swap_method_id: get("ONESHOT_SWAP_METHOD_ID"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // System tray: lets Frost keep running with the window closed so the
            // in-webview agents stay active. The menu reopens or fully quits the app.
            let open = MenuItem::with_id(app, "open", "Open Frost", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Frost", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::with_id("frost-tray")
                .icon(app.default_window_icon().expect("default window icon").clone())
                .tooltip("Frost — agents running in the background")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        // Closing the main window HIDES it (keeps the process + agents alive) instead
        // of quitting. The user fully exits via the tray's "Quit Frost".
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            finish_splash,
            load_demo_credentials,
            wallet_bridge::wallet_bridge_perform,
            key_store::key_store_set,
            key_store::key_store_get,
            key_store::key_store_delete,
            key_store::key_store_has,
            permission_spec::build_native_token_stream_permission,
            permission_spec::build_erc20_token_stream_permission,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
