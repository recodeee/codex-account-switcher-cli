use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeInfoResponse {
    pub service: &'static str,
    pub language: &'static str,
    pub version: &'static str,
    pub profile: String,
}
