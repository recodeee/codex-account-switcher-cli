pub use codex_lb_contracts::RuntimeInfoResponse;

pub mod accounts {
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct AccountId(pub String);
}
