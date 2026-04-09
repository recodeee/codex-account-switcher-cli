use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Debug, Serialize)]
pub(crate) struct StatusResponse {
    pub status: &'static str,
}

#[derive(Debug, Serialize)]
pub(crate) struct HealthCheckResponse {
    pub status: &'static str,
    pub checks: Option<BTreeMap<&'static str, &'static str>>,
    pub bridge_ring: Option<BridgeRingResponse>,
}

#[derive(Debug, Serialize)]
pub(crate) struct BridgeRingResponse {
    pub ring_fingerprint: Option<String>,
    pub ring_size: usize,
    pub instance_id: Option<String>,
    pub is_member: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct ErrorDetailResponse {
    pub detail: &'static str,
}

#[derive(Debug, Serialize)]
pub(crate) struct RuntimeInfoResponse {
    pub service: &'static str,
    pub language: &'static str,
    pub version: &'static str,
    pub profile: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct PythonLayerHealthResponse {
    pub status: &'static str,
    pub python_base_url: String,
    pub checks: BTreeMap<String, PythonEndpointCheck>,
}

#[derive(Debug, Serialize)]
pub(crate) struct PythonEndpointCheck {
    pub status_code: Option<u16>,
    pub ok: bool,
    pub detail: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct PythonLayerApisResponse {
    pub status: &'static str,
    pub python_base_url: String,
    pub source: &'static str,
    pub paths: Vec<String>,
    pub detail: Option<String>,
}
