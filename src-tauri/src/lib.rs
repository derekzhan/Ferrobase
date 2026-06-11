mod bridge;
pub mod conn;
pub mod models;
pub mod mongo;
pub mod mysql;
pub mod redis_drv;
mod secret;
pub mod state;
pub mod store;
pub mod util;

use serde_json::Value;
use state::AppState;
use tauri::{Emitter, State};

#[tauri::command]
async fn bridge_call(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    method: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    bridge::dispatch(app, state.inner(), &method, args).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "ferrobase=info".into()),
        )
        .try_init();

    let opened = tauri::async_runtime::block_on(async { store::open().await })
        .expect("failed to open local database");
    let app_state = AppState::new(opened.pool, opened.path);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .setup(|app| {
            #[cfg(target_os = "macos")]
            build_macos_menu(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![bridge_call])
        .run(tauri::generate_context!())
        .expect("error while running Ferrobase");
}

#[cfg(target_os = "macos")]
fn build_macos_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

    let about_item = MenuItemBuilder::with_id("ferro_about", "About Ferrobase").build(app)?;
    let app_menu = SubmenuBuilder::new(app, "Ferrobase")
        .item(&about_item)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .separator()
        .close_window()
        .build()?;

    let settings_item = MenuItemBuilder::with_id("menu:settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let tools_menu = SubmenuBuilder::new(app, "Tools").item(&settings_item).build()?;

    let shortcuts_item = MenuItemBuilder::with_id("menu:shortcuts", "Keyboard Shortcuts").build(app)?;
    let about2_item = MenuItemBuilder::with_id("menu:about", "About Ferrobase").build(app)?;
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&shortcuts_item)
        .item(&about2_item)
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&edit_menu)
        .item(&window_menu)
        .item(&tools_menu)
        .item(&help_menu)
        .build()?;
    app.set_menu(menu)?;

    app.on_menu_event(move |app_handle, event| {
        let id = event.id().0.as_str();
        match id {
            "ferro_about" | "menu:about" => {
                let _ = app_handle.emit("menu:about", ());
            }
            "menu:settings" => {
                let _ = app_handle.emit("menu:settings", ());
            }
            "menu:shortcuts" => {
                let _ = app_handle.emit("menu:shortcuts", ());
            }
            _ => {}
        }
    });
    Ok(())
}
