//! Typed builders for ERC-7715 permission specs.
//!
//! The Flask 13.32 schema is locked (see HANDOFF.md "Locked decisions"):
//!   - top-level array of one permission object
//!   - `chainId`, `to` (delegate), `permission`, `rules` are required
//!   - `permission.type` selects the variant
//!   - `permission.isAdjustmentAllowed` lives inside `permission`, NOT at top
//!   - `rules` carries the `expiry` constraint, NOT a top-level field
//!
//! This module exists to keep that schema in exactly one place. The future
//! agent runtime will call these builders directly; the bridge UI reads the
//! built spec from `?params=` and renders a preview before the user signs.
//!
//! Hex values follow MetaMask convention: `0x`-prefixed even for small ints.

use serde::{Deserialize, Serialize};

const BASE_SEPOLIA_CHAIN_HEX: &str = "0x14a34"; // 84532

#[derive(Debug, Deserialize)]
pub struct NativeStreamArgs {
    pub session_account: String,
    pub amount_per_second_hex: String,
    pub max_amount_hex: String,
    #[serde(default = "default_initial_amount")]
    pub initial_amount_hex: String,
    pub expiry_secs: u64,
    pub justification: String,
    #[serde(default)]
    pub chain_id_hex: Option<String>,
    #[serde(default = "default_true")]
    pub is_adjustment_allowed: bool,
}

#[derive(Debug, Deserialize)]
pub struct Erc20StreamArgs {
    pub session_account: String,
    pub token_address: String,
    pub amount_per_second_hex: String,
    pub max_amount_hex: String,
    #[serde(default = "default_initial_amount")]
    pub initial_amount_hex: String,
    pub expiry_secs: u64,
    pub justification: String,
    #[serde(default)]
    pub chain_id_hex: Option<String>,
    #[serde(default = "default_true")]
    pub is_adjustment_allowed: bool,
}

fn default_initial_amount() -> String {
    "0x0".to_string()
}
fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize)]
struct PermissionData {
    #[serde(rename = "type")]
    kind: &'static str,
    data: serde_json::Value,
    #[serde(rename = "isAdjustmentAllowed")]
    is_adjustment_allowed: bool,
}

#[derive(Debug, Serialize)]
struct Rule {
    #[serde(rename = "type")]
    kind: &'static str,
    data: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct PermissionRequest {
    #[serde(rename = "chainId")]
    chain_id: String,
    to: String,
    permission: PermissionData,
    rules: Vec<Rule>,
}

fn now_secs() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn expiry_rule(expiry_secs: u64) -> Rule {
    let now = now_secs();
    Rule {
        kind: "expiry",
        data: serde_json::json!({ "timestamp": now + expiry_secs }),
    }
}

#[tauri::command]
pub fn build_native_token_stream_permission(args: NativeStreamArgs) -> serde_json::Value {
    let now = now_secs();
    let chain_id = args.chain_id_hex.unwrap_or_else(|| BASE_SEPOLIA_CHAIN_HEX.to_string());
    let req = PermissionRequest {
        chain_id,
        to: args.session_account,
        permission: PermissionData {
            kind: "native-token-stream",
            data: serde_json::json!({
                "amountPerSecond": args.amount_per_second_hex,
                "maxAmount": args.max_amount_hex,
                "initialAmount": args.initial_amount_hex,
                "startTime": now,
                "justification": args.justification,
            }),
            is_adjustment_allowed: args.is_adjustment_allowed,
        },
        rules: vec![expiry_rule(args.expiry_secs)],
    };
    serde_json::json!([req])
}

#[tauri::command]
pub fn build_erc20_token_stream_permission(args: Erc20StreamArgs) -> serde_json::Value {
    let now = now_secs();
    let chain_id = args.chain_id_hex.unwrap_or_else(|| BASE_SEPOLIA_CHAIN_HEX.to_string());
    let req = PermissionRequest {
        chain_id,
        to: args.session_account,
        permission: PermissionData {
            kind: "erc20-token-stream",
            data: serde_json::json!({
                "tokenAddress": args.token_address,
                "amountPerSecond": args.amount_per_second_hex,
                "maxAmount": args.max_amount_hex,
                "initialAmount": args.initial_amount_hex,
                "startTime": now,
                "justification": args.justification,
            }),
            is_adjustment_allowed: args.is_adjustment_allowed,
        },
        rules: vec![expiry_rule(args.expiry_secs)],
    };
    serde_json::json!([req])
}
