//! Platform-agnostic chat integration. Adapters are dumb pipes: they move
//! `ChatInbound`/`ChatOutbound` messages between a platform and the server.
//! All command parsing, rate limiting, and identity handling live in
//! `idlin-server` so a new platform is exactly one new `run()` impl.
//!
//! Phase 0: the trait and message types. The Mock adapter (dev REPL) and the
//! Twitch adapter land in Phase 2.

use tokio::sync::mpsc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Mock,
    Twitch,
}

/// A chat message arriving from a platform.
#[derive(Debug, Clone)]
pub struct ChatInbound {
    pub platform: Platform,
    /// Stable platform-side user id — identity is keyed on this, never on
    /// the display name.
    pub user_id: String,
    pub display_name: String,
    pub text: String,
}

/// A message for the adapter to send back out.
#[derive(Debug, Clone)]
pub enum ChatOutbound {
    Say(String),
    Reply { to_user_id: String, text: String },
}

#[async_trait::async_trait]
pub trait ChatAdapter: Send {
    fn platform(&self) -> Platform;

    /// Run until the connection (or the server) goes away. The adapter owns
    /// its own reconnect policy.
    async fn run(
        self: Box<Self>,
        inbound: mpsc::Sender<ChatInbound>,
        outbound: mpsc::Receiver<ChatOutbound>,
    ) -> anyhow::Result<()>;
}
