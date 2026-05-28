// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IProviderRegistry} from "../../src/interfaces/IProviderRegistry.sol";

contract MockProviderRegistry is IProviderRegistry {
    mapping(address => bool) public approved;

    function setApproved(address provider, bool ok) external {
        approved[provider] = ok;
    }

    function isApproved(address provider) external view override returns (bool) {
        return approved[provider];
    }
}
