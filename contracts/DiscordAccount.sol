// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import {LightAccount} from "../light-account/src/LightAccount.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {SIG_VALIDATION_SUCCESS} from "account-abstraction/core/Helpers.sol";
import {IReclaimContract} from "./interfaces/IReclaimContract.sol";
import "solidity-stringutils/src/strings.sol";

contract DiscordAccount is LightAccount {
    using strings for *;
    address public immutable FACTORY_ADDRESS = msg.sender;
    string private _username;
    address public immutable RECLAIM_CONTRACT;

    string private constant REQUIRED_RECLAIM_RESPONSE_MATCHES =
        '"responseMatches":[{"type":"regex","value":"\\"author\\":\\\\{.*?\\"username\\":\\"(?<username>[^\\"]+)\\""},'
        '{"type":"regex","value":"\\"author\\":\\\\{.*?\\"discriminator\\":\\"(?<discriminator>[^\\"]+)\\""},'
        '{"type":"regex","value":"\\"timestamp\\":\\"(?<timestamp>[^\\"]+)\\""},'
        '{"type":"regex","value":"\\"type\\":\\\\s*19\\\\b"},'
        '{"type":"regex","value":"\\"content\\":\\\\s*\\"[Cc][Oo][Nn][Ff][Ii][Rr][Mm]\\""},'
        '{"type":"regex","value":"\\"referenced_message\\":\\\\{.*?\\"author\\":\\\\{.*?\\"id\\":\\"1325952266523639920\\""},'
        '{"type":"regex","value":"\\"referenced_message\\":\\\\{.*?\\"timestamp\\":\\"(?<repliedToTimestamp>[^\\"]+)\\""},'
        '{"type":"regex","value":"\\"referenced_message\\":\\\\{.*?\\"embeds\\":\\\\[\\\\{.*?\\"title\\":\\"(?<repliedToPayload>[^\\"]+)\\""}]';

    string private constant REQUIRED_DISCORD_URL =
        '"url":"https://discord.com/api/v10/channels/';

    constructor(
        IEntryPoint entryPoint_,
        address reclaimContract
    ) LightAccount(entryPoint_) {
        RECLAIM_CONTRACT = reclaimContract;
    }

    /// @notice Initialize account with username
    /// @dev Called by factory after account creation
    /// @param username_ The discord username that can never be changed
    function setUsername(string calldata username_) external {
        require(msg.sender == FACTORY_ADDRESS, "Only factory");
        require(bytes(_username).length == 0, "Username already set");
        require(bytes(username_).length > 0, "Empty username");
        _username = username_;
    }

    enum DiscordSignatureType {
        EOA,
        CONTRACT,
        CONTRACT_WITH_ADDR,
        RECLAIM
    }

    function _validateSignature(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal virtual override(LightAccount) returns (uint256 validationData) {
        if (userOp.signature.length < 1) {
            revert InvalidSignatureType();
        }

        uint8 signatureType = uint8(userOp.signature[0]);

        if (
            signatureType == uint8(DiscordSignatureType.EOA) ||
            signatureType == uint8(DiscordSignatureType.CONTRACT) ||
            signatureType == uint8(DiscordSignatureType.CONTRACT_WITH_ADDR)
        ) {
            return super._validateSignature(userOp, userOpHash);
        }
        if (signatureType == uint8(DiscordSignatureType.RECLAIM)) {
            bytes memory reclaimProof = userOp.signature[1:];

            return _validateReclaimProof(reclaimProof, userOpHash);
        }
        revert InvalidSignatureType();
    }

    function _isValidSignature(
        bytes32 replaySafeHash,
        bytes calldata signature
    ) internal view virtual override(LightAccount) returns (bool) {
        if (signature.length < 1) {
            revert InvalidSignatureType();
        }

        uint8 signatureType = uint8(signature[0]);
        bytes memory sigBytes = signature[1:];

        if (
            signatureType == uint8(DiscordSignatureType.EOA) ||
            signatureType == uint8(DiscordSignatureType.CONTRACT) ||
            signatureType == uint8(DiscordSignatureType.CONTRACT_WITH_ADDR)
        ) {
            // Fall back to the parent logic (LightAccount) for these signature types
            return super._isValidSignature(replaySafeHash, signature);
        } else if (signatureType == uint8(DiscordSignatureType.RECLAIM)) {
            return
                _validateReclaimProof(sigBytes, replaySafeHash) ==
                SIG_VALIDATION_SUCCESS;
        }

        revert InvalidSignatureType();
    }

    /// @notice Validate the provided reclaim proof matches the username
    /// @param proofBytes The proof to validate
    /// @param userOpHash The userOpHash that should match the proof
    function _validateReclaimProof(
        bytes memory proofBytes,
        bytes32 userOpHash
    ) internal view returns (uint256 validationData) {
        // Validate username format
        bytes memory usernameBytes = bytes(_username);
        if (
            usernameBytes.length == 0 ||
            usernameBytes[usernameBytes.length - 1] == "#"
        ) {
            return _successToValidationData(false);
        }

        // Decode proof
        IReclaimContract.Proof memory proof = abi.decode(
            proofBytes,
            (IReclaimContract.Proof)
        );

        // Extract username parts
        strings.slice memory usernameSlice = _username.toSlice();
        strings.slice memory discordUsername = usernameSlice.split(
            "#".toSlice()
        );
        if (discordUsername.empty()) return _successToValidationData(false);

        // Extract parameters and build search strings
        strings.slice memory paramsSlice = _extractParameters(
            proof.claimInfo.context
        ).toSlice();
        if (paramsSlice.empty()) return _successToValidationData(false);

        // Check username and discriminator match
        strings.slice memory usernameMatch = string(
            abi.encodePacked('"username":"', discordUsername.toString(), '"')
        ).toSlice();

        strings.slice memory discriminatorMatch = string(
            abi.encodePacked(
                '"discriminator":"',
                usernameSlice.empty() ? "0" : usernameSlice.toString(),
                '"'
            )
        ).toSlice();

        string memory userOpHashString = string.concat(
            '"repliedToPayload":"',
            toHexString(userOpHash),
            '"'
        );

        if (
            !paramsSlice.contains(usernameMatch) ||
            !paramsSlice.contains(discriminatorMatch) ||
            !paramsSlice.contains(userOpHashString.toSlice())
        ) {
            return _successToValidationData(false);
        }

        // Validate regex and URL
        strings.slice memory parametersSlice = proof
            .claimInfo
            .parameters
            .toSlice();

        if (
            !parametersSlice.contains(
                REQUIRED_RECLAIM_RESPONSE_MATCHES.toSlice()
            ) || !parametersSlice.contains(REQUIRED_DISCORD_URL.toSlice())
        ) {
            return _successToValidationData(false);
        }

        try IReclaimContract(RECLAIM_CONTRACT).verifyProof(proof) returns (
            bool
        ) {
            return _successToValidationData(true);
        } catch {
            return _successToValidationData(false);
        }
    }

    function _extractParameters(
        string memory context
    ) internal pure returns (string memory) {
        bytes memory contextBytes = bytes(context);
        if (contextBytes.length == 0) return "";

        uint256 startPos;
        uint256 endPos;
        uint256 braceCount;
        bool started;

        for (uint256 i = 0; i < contextBytes.length; i++) {
            if (contextBytes[i] == "{") {
                if (!started) {
                    startPos = i;
                    started = true;
                }
                braceCount++;
            } else if (contextBytes[i] == "}") {
                braceCount--;
                if (braceCount == 1) {
                    endPos = i + 1;
                    break;
                }
            }
        }

        if (!started || braceCount != 1) return "";

        bytes memory paramsBytes = new bytes(endPos - startPos);
        for (uint256 i = 0; i < endPos - startPos; i++) {
            paramsBytes[i] = contextBytes[startPos + i];
        }

        return string(paramsBytes);
    }

    function toHexString(bytes32 value) private pure returns (string memory) {
        bytes memory buffer = new bytes(66); // 2 characters for "0x" + 64 hex characters
        buffer[0] = "0";
        buffer[1] = "x";

        // Fill the rest of the buffer with hex characters
        for (uint256 i = 0; i < 32; i++) {
            uint8 b = uint8(value[i]);
            buffer[2 + i * 2] = bytes1(uint8(b / 16 + (b / 16 < 10 ? 48 : 87)));
            buffer[3 + i * 2] = bytes1(
                uint8((b % 16) + (b % 16 < 10 ? 48 : 87))
            );
        }

        return string(buffer);
    }

    /// @notice Get the immutable username
    function username() external view returns (string memory) {
        return _username;
    }
}
