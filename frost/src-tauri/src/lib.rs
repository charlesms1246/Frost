mod key_store;
mod permission_spec;
mod wallet_bridge;

use tauri::Manager;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            finish_splash,
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
