//! The wire protocol between `idlin-server` and the web clients.
//!
//! Single source of truth for both sides: Rust types here, TypeScript types
//! generated into `web/src/gen/` by `cargo test -p idlin-protocol` (the
//! `export_typescript_bindings` test). JSON over WebSocket for v1; the serde
//! derives are the seam for a binary transport later.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const PROTO_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum Role {
    /// Server owner / broadcast view: full world visibility.
    Owner,
    /// Scoped to one character; enforced server-side before serialization.
    Player,
}

/// Client → server.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "data")]
pub enum C2S {
    Hello { token: String, proto_version: u32 },
    Ping { nonce: u32 },
}

/// Server → client.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "data")]
pub enum S2C {
    Welcome {
        role: Role,
        proto_version: u32,
        /// Current sim tick. Fits in a JS number for ~28M years at 10 Hz.
        #[ts(type = "number")]
        server_tick: u64,
    },
    Pong {
        nonce: u32,
        #[ts(type = "number")]
        server_tick: u64,
    },
    Error {
        code: u32,
        msg: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_roundtrip() {
        let msg = C2S::Ping { nonce: 7 };
        let json = serde_json::to_string(&msg).unwrap();
        assert_eq!(json, r#"{"type":"Ping","data":{"nonce":7}}"#);
        let back: C2S = serde_json::from_str(&json).unwrap();
        assert!(matches!(back, C2S::Ping { nonce: 7 }));

        let msg = S2C::Welcome {
            role: Role::Owner,
            proto_version: PROTO_VERSION,
            server_tick: 123,
        };
        let json = serde_json::to_string(&msg).unwrap();
        let back: S2C = serde_json::from_str(&json).unwrap();
        assert!(matches!(
            back,
            S2C::Welcome {
                server_tick: 123,
                ..
            }
        ));
    }

    /// Regenerates web/src/gen/. CI checks the output is committed and fresh.
    #[test]
    fn export_typescript_bindings() {
        let cfg = ts_rs::Config::new().with_out_dir("../../web/src/gen");
        C2S::export_all(&cfg).expect("export C2S");
        S2C::export_all(&cfg).expect("export S2C");
    }
}
