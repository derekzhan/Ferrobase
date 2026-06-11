//! Credential storage via the OS keychain (Keychain on macOS, Credential
//! Manager on Windows, Secret Service on Linux). Passwords are never written to
//! the local SQLite database in plaintext.

const SERVICE: &str = "app.ferrobase.client";

pub fn set_password(conn_id: &str, password: &str) {
    if password.is_empty() {
        delete_password(conn_id);
        return;
    }
    if let Ok(entry) = keyring::Entry::new(SERVICE, conn_id) {
        let _ = entry.set_password(password);
    }
}

pub fn get_password(conn_id: &str) -> String {
    if let Ok(entry) = keyring::Entry::new(SERVICE, conn_id) {
        if let Ok(pw) = entry.get_password() {
            return pw;
        }
    }
    String::new()
}

pub fn delete_password(conn_id: &str) {
    if let Ok(entry) = keyring::Entry::new(SERVICE, conn_id) {
        let _ = entry.delete_password();
    }
}
