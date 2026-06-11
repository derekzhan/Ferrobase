//! Small SQL/JSON helpers shared across the MySQL implementation.

use serde_json::Value;

/// Quote a MySQL identifier with backticks, escaping embedded backticks.
pub fn quote_ident(name: &str) -> String {
    format!("`{}`", name.replace('`', "``"))
}

/// Escape a string for use inside single-quoted MySQL string literals.
pub fn escape_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    for ch in s.chars() {
        match ch {
            '\'' => out.push_str("\\'"),
            '\\' => out.push_str("\\\\"),
            '\0' => out.push_str("\\0"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\x1a' => out.push_str("\\Z"),
            _ => out.push(ch),
        }
    }
    out
}

/// Render a JSON value as a MySQL SQL literal (for inline-edit / apply changes).
pub fn json_to_sql_literal(v: &Value) -> String {
    match v {
        Value::Null => "NULL".to_string(),
        Value::Bool(b) => if *b { "1".into() } else { "0".into() },
        Value::Number(n) => n.to_string(),
        Value::String(s) => format!("'{}'", escape_str(s)),
        // Arrays/objects are stored as JSON text.
        other => format!("'{}'", escape_str(&other.to_string())),
    }
}
