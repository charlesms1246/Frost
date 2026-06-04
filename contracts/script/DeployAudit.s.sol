// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {AuditRegistry} from "../src/AuditRegistry.sol";

/// @title DeployAudit — standalone deploy of the AuditRegistry anchor (§10.8).
/// @notice AuditRegistry has NO dependencies on the six core contracts (it stores
///         commitments and verifies signatures only), so it deploys on its own without
///         re-running Deploy.s.sol (which would mint duplicate, unwired core contracts).
///         After this runs, copy the printed address into:
///           - sdk/src/addresses.ts  → FROST_BASE_SEPOLIA.auditRegistry
///           - DEPLOYED_CONTRACTS.md  → Addresses table
contract DeployAudit is Script {
    function run() external returns (AuditRegistry auditRegistry) {
        vm.startBroadcast();
        auditRegistry = new AuditRegistry();
        vm.stopBroadcast();

        console2.log("=== Frost AuditRegistry deployment ===");
        console2.log("Chain id:", block.chainid);
        console2.log("AuditRegistry:", address(auditRegistry));
    }
}
