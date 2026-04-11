mod commands;
mod db;
mod models;
mod pool;
mod error;

use commands::{connection, schema, query, mongo, redis_cmd, export};
use tauri::menu::{MenuBuilder, SubmenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "ferrobase=info".into()),
        )
        .try_init();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(pool::ConnectionRegistry::new())
        .setup(|app| {
            // Build custom menu to intercept "About" and show our custom dialog
            let about_item = MenuItemBuilder::with_id("custom_about", "About Ferrobase")
                .build(app)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let hide = PredefinedMenuItem::hide(app, Some("Hide Ferrobase"))?;
            let hide_others = PredefinedMenuItem::hide_others(app, Some("Hide Others"))?;
            let show_all = PredefinedMenuItem::show_all(app, Some("Show All"))?;
            let quit = PredefinedMenuItem::quit(app, Some("Quit Ferrobase"))?;
            let services = SubmenuBuilder::new(app, "Services")
                .services()
                .build()?;

            let app_menu = SubmenuBuilder::new(app, "Ferrobase")
                .item(&about_item)
                .item(&separator)
                .item(&services)
                .item(&PredefinedMenuItem::separator(app)?)
                .item(&hide)
                .item(&hide_others)
                .item(&show_all)
                .item(&PredefinedMenuItem::separator(app)?)
                .item(&quit)
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

            let view_menu = SubmenuBuilder::new(app, "View")
                .fullscreen()
                .build()?;

            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .separator()
                .close_window()
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&window_menu)
                .build()?;

            app.set_menu(menu)?;

            // Handle custom About menu click → emit event to frontend
            let handle = app.handle().clone();
            app.on_menu_event(move |_app_handle, event| {
                if event.id().0 == "custom_about" {
                    let _ = handle.emit("show-about", ());
                }
            });

            let handle2 = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = commands::connection::load_connections_from_disk(&handle2).await {
                    eprintln!("Failed to load saved connections: {}", e);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Connection management
            connection::create_connection,
            connection::update_connection,
            connection::delete_connection,
            connection::clone_connection,
            connection::list_connections,
            connection::test_connection,
            connection::connect,
            connection::disconnect,
            connection::get_connection_status,
            // Schema browsing
            schema::get_databases,
            schema::get_schemas,
            schema::get_tables,
            schema::get_table_columns,
            schema::get_table_indexes,
            schema::get_table_ddl,
            schema::get_table_data_preview,
            schema::get_views,
            schema::get_procedures,
            // Query execution
            query::execute_query,
            query::cancel_query,
            query::get_query_history,
            query::clear_query_history,
            // MongoDB specific
            mongo::list_collections,
            mongo::query_collection,
            mongo::insert_document,
            mongo::update_document,
            mongo::delete_document,
            mongo::get_collection_indexes,
            // Redis specific
            redis_cmd::list_keys,
            redis_cmd::get_key,
            redis_cmd::set_key,
            redis_cmd::delete_key,
            redis_cmd::get_key_ttl,
            redis_cmd::set_key_ttl,
            redis_cmd::get_server_info,
            redis_cmd::execute_redis_command,
            // Export
            export::export_query_result,
        ]);

    if let Err(e) = builder.run(tauri::generate_context!()) {
        eprintln!("Error while running Ferrobase: {}", e);
        std::process::exit(1);
    }
}
