// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IMandate} from "../../src/interfaces/IMandate.sol";
import {Caveats} from "../../src/Caveats.sol";

/// @dev Minimal IMandate stand-in for Settlement tests. Stores a single mandate
///      and an InvalidReason to return from validateMandateForOperation. The
///      Settlement tests configure exactly the shape they need per-case.
contract MockMandate is IMandate {
    mapping(bytes32 => MandateView) public stored;
    IMandate.InvalidReason public nextReason;
    uint256 public validateCallCount;

    function setMandate(bytes32 id, address issuer, address holder, bool revoked, uint256 cumulativeSpend)
        external
    {
        stored[id] = MandateView({
            issuer: issuer,
            holder: holder,
            parentMandateId: bytes32(0),
            issuedAt: uint64(block.timestamp),
            revoked: revoked,
            cumulativeSpend: cumulativeSpend
        });
    }

    function setNextReason(IMandate.InvalidReason r) external {
        nextReason = r;
    }

    function validateMandateForOperation(
        bytes32, /* mandateId */
        bytes32, /* operationType */
        address, /* target */
        uint256, /* amount */
        bytes32 /* contextRef */
    ) external override returns (bool valid, IMandate.InvalidReason reason) {
        validateCallCount += 1;
        reason = nextReason;
        valid = (reason == IMandate.InvalidReason.OK);
    }

    function getMandate(bytes32 mandateId) external view override returns (MandateView memory) {
        return stored[mandateId];
    }

    function getCaveats(bytes32 /* mandateId */)
        external
        pure
        override
        returns (Caveats.Caveat[] memory)
    {
        return new Caveats.Caveat[](0);
    }
}
