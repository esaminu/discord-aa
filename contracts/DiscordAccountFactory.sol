// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {BaseLightAccountFactory} from "../light-account/src/common/BaseLightAccountFactory.sol";
import {LibClone} from "../light-account/src/external/solady/LibClone.sol";
import {DiscordAccount} from "./DiscordAccount.sol";

/// @title A factory contract for DiscordAccount.
/// @dev A UserOperations "initCode" holds the address of the factory, and a method call (`createAccount`). The
/// factory's `createAccount` returns the target account address even if it is already installed. This way,
/// `entryPoint.getSenderAddress()` can be called either before or after the account is created.
contract DiscordAccountFactory is BaseLightAccountFactory {
    DiscordAccount public immutable ACCOUNT_IMPLEMENTATION;

    constructor(
        address owner,
        IEntryPoint entryPoint,
        address reclaimContract
    ) Ownable(owner) {
        _verifyEntryPointAddress(address(entryPoint));
        ACCOUNT_IMPLEMENTATION = new DiscordAccount(
            entryPoint,
            reclaimContract
        );
        ENTRY_POINT = entryPoint;
    }

    /// @notice Create an account, and return its address. Returns the address even if the account is already deployed.
    /// @param username The username to create the account with
    /// @return account The address of either the newly deployed account or an existing account with this username and salt.
    function createAccount(
        string calldata username
    ) external returns (DiscordAccount account) {
        (bool alreadyDeployed, address accountAddress) = LibClone
            .createDeterministicERC1967(address(ACCOUNT_IMPLEMENTATION), _getCombinedSalt(username));

        account = DiscordAccount(payable(accountAddress));
        if (!alreadyDeployed) {
            address burnAddr = 0x000000000000000000000000000000000000dEaD;
            account.initialize(burnAddr);
            account.setUsername(username);
        }
    }

    /// @notice Calculate the counterfactual address of this account as it would be returned by `createAccount`.
    /// @param username The username to calculate the address for
    /// @return The address of the account that would be created with `createAccount`.
    function getAddress(
        string calldata username
    ) external view returns (address) {
        return
            LibClone.predictDeterministicAddressERC1967(
                address(ACCOUNT_IMPLEMENTATION),
                _getCombinedSalt(username),
                address(this)
            );
    }

    /// @notice Compute the hash of the username in scratch space memory.
    /// @param username The username to be hashed
    /// @return The hash of the username
    function _getCombinedSalt(
        string calldata username
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(username));
    }
}
