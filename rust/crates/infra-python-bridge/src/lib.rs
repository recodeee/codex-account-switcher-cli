use codex_lb_contracts::RuntimeInfoResponse;

#[derive(Debug, Clone)]
pub struct PythonBridgeConfig {
    pub base_url: String,
}

pub fn fallback_runtime_info(profile: String) -> RuntimeInfoResponse {
    RuntimeInfoResponse {
        service: "codex-lb-rust-runtime",
        language: "rust",
        version: env!("CARGO_PKG_VERSION"),
        profile,
    }
}
