use codex_lb_domain::accounts::AccountId;

#[derive(Debug, Default)]
pub struct AccountRepository;

impl AccountRepository {
    pub fn list_account_ids(&self) -> Vec<AccountId> {
        Vec::new()
    }
}
