use codex_lb_domain::RuntimeInfoResponse;

pub trait RuntimeInfoProvider {
    fn runtime_info(&self) -> RuntimeInfoResponse;
}
