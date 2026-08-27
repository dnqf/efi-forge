mod builder;
mod components;
mod hardware;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        .invoke_handler(tauri::generate_handler![
            hardware::scan_hardware,
            builder::build_efi_scaffold,
            builder::select_usb_map,
            builder::validate_custom_efi,
            builder::merge_efi_sources,
            builder::copy_efi_to_empty_target,
            components::select_component_source,
            components::merge_component_selections,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
