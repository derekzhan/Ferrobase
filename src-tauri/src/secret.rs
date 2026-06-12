//! Credential storage via the OS keychain (Keychain on macOS, Credential
//! Manager on Windows, Secret Service on Linux). Passwords are never written to
//! the local SQLite database in plaintext.
//!
//! Reads are memoised in a process-wide cache so the OS keychain is touched at
//! most once per connection per run. Without this, every connection-list
//! refresh and lazy reconnect re-reads the keychain, which on macOS triggers a
//! fresh "ferrobase wants to use your confidential information" prompt each
//! time.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

const SERVICE: &str = "app.ferrobase.client";

fn cache() -> &'static Mutex<HashMap<String, String>> {
    static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn set_password(conn_id: &str, password: &str) {
    if password.is_empty() {
        delete_password(conn_id);
        return;
    }
    if let Ok(entry) = keyring::Entry::new(SERVICE, conn_id) {
        let _ = entry.set_password(password);
    }
    cache().lock().unwrap().insert(conn_id.to_string(), password.to_string());
}

pub fn get_password(conn_id: &str) -> String {
    if let Some(pw) = cache().lock().unwrap().get(conn_id) {
        return pw.clone();
    }
    let pw = keyring::Entry::new(SERVICE, conn_id)
        .ok()
        .and_then(|e| e.get_password().ok())
        .unwrap_or_default();
    cache().lock().unwrap().insert(conn_id.to_string(), pw.clone());
    pw
}

pub fn delete_password(conn_id: &str) {
    if let Ok(entry) = keyring::Entry::new(SERVICE, conn_id) {
        let _ = entry.delete_password();
    }
    cache().lock().unwrap().remove(conn_id);
}
