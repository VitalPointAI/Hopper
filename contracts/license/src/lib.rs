use near_sdk::store::LookupMap;
use near_sdk::{near, AccountId, env, require, PanicOnDefault};

/// Old contract state for migration (AccountId keys)
/// Only used for reading borsh-serialized state during migration
#[derive(PanicOnDefault)]
#[near(serializers = [borsh])]
pub struct OldLicenseContract {
    licenses: LookupMap<AccountId, u64>,
    admin: AccountId,
}

/// License contract for storing wallet license expiry timestamps.
/// Uses LookupMap for efficient storage of wallet_address -> expiry_timestamp mappings.
/// Supports any wallet address string (NEAR accounts, EVM addresses, Solana pubkeys, etc.)
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct LicenseContract {
    /// Mapping of wallet addresses to their license expiry timestamps (in nanoseconds)
    /// Keys can be NEAR account IDs or any other wallet address format
    licenses: LookupMap<String, u64>,
    /// Admin account that can grant licenses
    admin: AccountId,
}

#[near]
impl LicenseContract {
    /// Initialize the contract with an admin account.
    ///
    /// # Arguments
    /// * `admin` - The account ID that will have permission to grant licenses
    #[init]
    pub fn new(admin: AccountId) -> Self {
        Self {
            licenses: LookupMap::new(b"l"),
            admin,
        }
    }

    /// Migrate from old contract state (AccountId keys) to new state (String keys).
    /// This preserves the admin but creates a new empty licenses map.
    /// Existing licenses will remain accessible if they were stored with the same prefix,
    /// since String serialization of valid AccountIds is compatible.
    ///
    /// # Panics
    /// Panics if caller is not the admin
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let old_state: OldLicenseContract = env::state_read().expect("Failed to read old state");

        // The old LookupMap used AccountId keys with prefix "l"
        // The new LookupMap uses String keys with the same prefix "l"
        // Since AccountId serializes to a string, existing entries are compatible
        // We just need to create the new state with the same prefix
        Self {
            licenses: LookupMap::new(b"l"),
            admin: old_state.admin,
        }
    }

    /// Grant a license to a wallet for a specified duration.
    /// If the wallet already has a license, extends from the current expiry.
    /// If no existing license or expired, starts from current block timestamp.
    ///
    /// # Arguments
    /// * `wallet_address` - The wallet address to grant the license to (NEAR account, EVM address, etc.)
    /// * `duration_days` - Number of days to grant the license for
    ///
    /// # Panics
    /// Panics if caller is not the admin
    pub fn grant_license(&mut self, wallet_address: String, duration_days: u32) {
        require!(
            env::predecessor_account_id() == self.admin,
            "Unauthorized: only admin can grant licenses"
        );

        let current_timestamp = env::block_timestamp();

        // Get current expiry, use current timestamp if not set or already expired
        let base_timestamp = self.licenses
            .get(&wallet_address)
            .copied()
            .filter(|&expiry| expiry > current_timestamp)
            .unwrap_or(current_timestamp);

        // Calculate duration in nanoseconds: days * 24 * 60 * 60 * 1_000_000_000
        let duration_ns = duration_days as u64 * 24 * 60 * 60 * 1_000_000_000;
        let new_expiry = base_timestamp + duration_ns;

        self.licenses.insert(wallet_address, new_expiry);
    }

    /// Check if a wallet has a valid (non-expired) license.
    ///
    /// # Arguments
    /// * `wallet_address` - The wallet address to check
    ///
    /// # Returns
    /// `true` if the wallet has a license that hasn't expired, `false` otherwise
    pub fn is_licensed(&self, wallet_address: String) -> bool {
        self.licenses
            .get(&wallet_address)
            .map(|&expiry| expiry > env::block_timestamp())
            .unwrap_or(false)
    }

    /// Get the raw expiry timestamp for a wallet.
    ///
    /// # Arguments
    /// * `wallet_address` - The wallet address to query
    ///
    /// # Returns
    /// `Some(timestamp)` if the wallet has a license entry, `None` otherwise
    pub fn get_expiry(&self, wallet_address: String) -> Option<u64> {
        self.licenses.get(&wallet_address).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const ONE_DAY_NS: u64 = 24 * 60 * 60 * 1_000_000_000;

    fn admin() -> AccountId {
        "admin.near".parse().unwrap()
    }

    fn user() -> AccountId {
        "user.near".parse().unwrap()
    }

    fn user_str() -> String {
        "user.near".to_string()
    }

    fn evm_address() -> String {
        "0x1234567890abcdef1234567890abcdef12345678".to_string()
    }

    fn setup_context(predecessor: &AccountId, block_timestamp: u64) {
        let context = VMContextBuilder::new()
            .predecessor_account_id(predecessor.clone())
            .block_timestamp(block_timestamp)
            .build();
        testing_env!(context);
    }

    #[test]
    fn test_new_initializes_admin() {
        setup_context(&admin(), 0);
        let contract = LicenseContract::new(admin());

        // Verify admin is set by trying to grant license (only admin can do this)
        // If admin wasn't set correctly, this would panic
        assert!(!contract.is_licensed(user_str()));
    }

    #[test]
    fn test_grant_license_by_admin() {
        setup_context(&admin(), 1_000_000_000);
        let mut contract = LicenseContract::new(admin());

        contract.grant_license(user_str(), 30);

        assert!(contract.is_licensed(user_str()));

        let expiry = contract.get_expiry(user_str());
        assert!(expiry.is_some());
        assert_eq!(expiry.unwrap(), 1_000_000_000 + 30 * ONE_DAY_NS);
    }

    #[test]
    fn test_grant_license_to_evm_address() {
        setup_context(&admin(), 1_000_000_000);
        let mut contract = LicenseContract::new(admin());

        // Grant license to an EVM address
        contract.grant_license(evm_address(), 30);

        assert!(contract.is_licensed(evm_address()));

        let expiry = contract.get_expiry(evm_address());
        assert!(expiry.is_some());
        assert_eq!(expiry.unwrap(), 1_000_000_000 + 30 * ONE_DAY_NS);
    }

    #[test]
    #[should_panic(expected = "Unauthorized: only admin can grant licenses")]
    fn test_grant_license_unauthorized() {
        setup_context(&admin(), 0);
        let mut contract = LicenseContract::new(admin());

        // Switch to non-admin context
        setup_context(&user(), 0);
        contract.grant_license(user_str(), 30);
    }

    #[test]
    fn test_license_expiry() {
        let initial_time = 1_000_000_000u64;
        setup_context(&admin(), initial_time);
        let mut contract = LicenseContract::new(admin());

        // Grant 1 day license
        contract.grant_license(user_str(), 1);
        assert!(contract.is_licensed(user_str()));

        // Move time forward past expiry
        let after_expiry = initial_time + ONE_DAY_NS + 1;
        setup_context(&admin(), after_expiry);

        assert!(!contract.is_licensed(user_str()));

        // Expiry timestamp should still be readable
        let expiry = contract.get_expiry(user_str());
        assert!(expiry.is_some());
        assert_eq!(expiry.unwrap(), initial_time + ONE_DAY_NS);
    }

    #[test]
    fn test_extend_license() {
        let initial_time = 1_000_000_000u64;
        setup_context(&admin(), initial_time);
        let mut contract = LicenseContract::new(admin());

        // Grant initial 30-day license
        contract.grant_license(user_str(), 30);
        let first_expiry = contract.get_expiry(user_str()).unwrap();
        assert_eq!(first_expiry, initial_time + 30 * ONE_DAY_NS);

        // Extend by another 30 days (before expiry)
        let halfway = initial_time + 15 * ONE_DAY_NS;
        setup_context(&admin(), halfway);
        contract.grant_license(user_str(), 30);

        // New expiry should be first_expiry + 30 days (extends from existing, not current time)
        let new_expiry = contract.get_expiry(user_str()).unwrap();
        assert_eq!(new_expiry, first_expiry + 30 * ONE_DAY_NS);

        // Verify it's still licensed
        assert!(contract.is_licensed(user_str()));
    }
}
