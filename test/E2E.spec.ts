import dotenv from "dotenv";
dotenv.config();

import { expect } from "chai";
import { ethers, network } from "hardhat";
import { Signer } from "ethers";
import * as bip39 from "bip39";
import { hdkey } from "ethereumjs-wallet";
import { toChecksumAddress } from "ethereumjs-util";

import { EntryPoint, DiscordAccountFactory, DiscordAccount, IReclaimContract } from "../typechain-types";

const RECLAIM_BASE_SEPOLIA_ADDRESS = "0xF90085f5Fd1a3bEb8678623409b3811eCeC5f6A5";
const ENTRY_POINT_ADDRESS = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const IS_SEPOLIA = network.name === "base-sepolia";

describe("End-to-End test: EntryPoint + DiscordAccountFactory", function () {
    let entryPoint: EntryPoint;
    let factory: DiscordAccountFactory;
    let reclaim: IReclaimContract;
    let deployer: Signer;

    before(async () => {
        if (IS_SEPOLIA) {
            const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC_URL);
            deployer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
            entryPoint = await ethers.getContractAt("EntryPoint", ENTRY_POINT_ADDRESS, deployer) as unknown as EntryPoint;
        } else {
            [deployer] = await ethers.getSigners();
            const EntryPointCF = await ethers.getContractFactory("EntryPoint", deployer);
            entryPoint = await EntryPointCF.deploy() as unknown as EntryPoint;
            await entryPoint.waitForDeployment();
        }

        if (IS_SEPOLIA) {
            reclaim = await ethers.getContractAt("IReclaimContract", RECLAIM_BASE_SEPOLIA_ADDRESS) as unknown as IReclaimContract;
        } else {
            const ReclaimCF = await ethers.getContractFactory("Reclaim");
            reclaim = await ReclaimCF.deploy() as unknown as IReclaimContract;
            await reclaim.waitForDeployment();
        }

        const FactoryCF = await ethers.getContractFactory("DiscordAccountFactory", deployer);
        factory = await FactoryCF.deploy(
            await deployer.getAddress(),
            await entryPoint.getAddress(),
            await reclaim.getAddress()
        ) as unknown as DiscordAccountFactory;
        await factory.waitForDeployment();

        // factory = await ethers.getContractAt("DiscordAccountFactory", "0xa62c9917AC04A34bAdA80e916870c07912839750", deployer) as unknown as DiscordAccountFactory;

        console.log(factory.target.toString(), '<<< factory address')
    });

    it.skip('test encoded user op',async () => {
        const username = "osmannear";

        const futureAddress = await factory['getAddress(string)'](username);

        const mockReclaimProof = ethers.AbiCoder.defaultAbiCoder().encode(
            ["tuple(tuple(string provider, string parameters, string context) claimInfo, tuple(tuple(bytes32 identifier, address owner, uint32 timestampS, uint32 epoch) claim, bytes[] signatures) signedClaim)"],
            [{
                claimInfo: {
                    provider: 'http',
                    parameters: '{"body":"","headers":{"Content-Type":"application/json","User-Agent":"reclaim/0.0.1"},"method":"GET","responseMatches":[{"type":"regex","value":"\\"author\\":\\\\{.*?\\"username\\":\\"(?<username>[^\\"]+)\\""},{"type":"regex","value":"\\"author\\":\\\\{.*?\\"discriminator\\":\\"(?<discriminator>[^\\"]+)\\""},{"type":"regex","value":"\\"timestamp\\":\\"(?<timestamp>[^\\"]+)\\""},{"type":"regex","value":"\\"type\\":\\\\s*19\\\\b"},{"type":"regex","value":"\\"content\\":\\\\s*\\"(?i:confirm)\\""},{"type":"regex","value":"\\"referenced_message\\":\\\\{.*?\\"author\\":\\\\{.*?\\"id\\":\\"1319025951622828093\\""},{"type":"regex","value":"\\"referenced_message\\":\\\\{.*?\\"embeds\\":\\\\[\\\\{.*?\\"title\\":\\"(?<repliedToPayload>[^\\"]+)\\""},{"type":"regex","value":"\\"referenced_message\\":\\\\{.*?\\"timestamp\\":\\"(?<repliedToTimestamp>[^\\"]+)\\""}],"responseRedactions":[],"url":"https://discord.com/api/v10/channels/1319031710020796416/messages/1320405778305257472"}',
                    context: '{"extractedParameters":{"discriminator":"0","repliedToPayload":"QmFzZTY0VGVsZWdyYW1QYXlsb2Fk","repliedToTimestamp":"2024-12-19T10:46:29.396000+00:00","timestamp":"2024-12-22T15:01:09.501000+00:00","username":"osmannear"},"providerHash":"0x0c61da0cb59673e578aa1648d1d6c502fd7807bcaa99de05450fb8e1636c5f32"}'
                },
                signedClaim: {
                    claim: {
                        identifier: '0x3dbb4fd3ab6806bc3b4510fe44d0a28a09b03072e0970987c7e0bdf7ab4a161a',
                        owner: '0x38040bf589011639ee17e7abed20551099a0687a',
                        timestampS: 1734879670,
                        epoch: 1
                    },
                    signatures: [
                        '0x3bf1624553f086dbce89f086cee3dc4a1bf114e7d56dd51d332e49141fc1232b44a836648394cb2ae5a0530edb4c610d27c3da8d8be6c9659da009437fae85c81c'
                    ]
                }
            }]
        );

        // const mnemonic = await generateSeedPhrase();
        // const ownerAddress = await deriveBaseAddress(mnemonic);

        const createAccountCalldata = factory.interface.encodeFunctionData(
            "createAccount",
            ['0x5bA4F8b8DB53D39CAe3457770B3A3Fb8575AA193', username]
        );

        const initCode = ethers.concat([
            factory.target.toString(),
            createAccountCalldata
        ]);
        const userOp = {
            sender: futureAddress,
            nonce: 0n,
            initCode,
            callData: "0x",
            accountGasLimits: ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(750_000n), 16),    // Based on actual usage
                ethers.zeroPadValue(ethers.toBeHex(750_000n), 16)
            ]),
            gasFees: ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(1_000_664n), 16),
                ethers.zeroPadValue(ethers.toBeHex(1_000n), 16)
            ]),
            preVerificationGas: 55_000n,
            paymasterAndData: "0x",
            // signature: "0x"
            signature: ethers.concat([ethers.toBeHex(3, 1), mockReclaimProof])
        };
        const encodedUserOp = ethers.AbiCoder.defaultAbiCoder().encode(
            [
                "tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)"
            ],
            [userOp]
        );

        const userOpHash = await entryPoint.getUserOpHash(userOp);
        console.log("UserOpHash:", userOpHash);  // Will be a string like "0x123..."
        
        console.log("Encoded UserOp:", encodedUserOp);
    })

    it.skip("should create a new DiscordAccount via EntryPoint.handleOps()", async () => {
        const username = "osmannear";

        const mockReclaimProof = ethers.AbiCoder.defaultAbiCoder().encode(
            ["tuple(tuple(string provider, string parameters, string context) claimInfo, tuple(tuple(bytes32 identifier, address owner, uint32 timestampS, uint32 epoch) claim, bytes[] signatures) signedClaim)"],
            [{
                claimInfo: {
                    provider: 'http',
                    parameters: '{"body":"","headers":{"Content-Type":"application/json","User-Agent":"reclaim/0.0.1"},"method":"GET","responseMatches":[{"type":"regex","value":"\\"author\\":\\\\{.*?\\"username\\":\\"(?<username>[^\\"]+)\\""},{"type":"regex","value":"\\"author\\":\\\\{.*?\\"discriminator\\":\\"(?<discriminator>[^\\"]+)\\""},{"type":"regex","value":"\\"timestamp\\":\\"(?<timestamp>[^\\"]+)\\""},{"type":"regex","value":"\\"type\\":\\\\s*19\\\\b"},{"type":"regex","value":"\\"content\\":\\\\s*\\"(?i:confirm)\\""},{"type":"regex","value":"\\"referenced_message\\":\\\\{.*?\\"author\\":\\\\{.*?\\"id\\":\\"1319025951622828093\\""},{"type":"regex","value":"\\"referenced_message\\":\\\\{.*?\\"embeds\\":\\\\[\\\\{.*?\\"title\\":\\"(?<repliedToPayload>[^\\"]+)\\""},{"type":"regex","value":"\\"referenced_message\\":\\\\{.*?\\"timestamp\\":\\"(?<repliedToTimestamp>[^\\"]+)\\""}],"responseRedactions":[],"url":"https://discord.com/api/v10/channels/1319031710020796416/messages/1320405778305257472"}',
                    context: '{"extractedParameters":{"discriminator":"0","repliedToPayload":"QmFzZTY0VGVsZWdyYW1QYXlsb2Fk","repliedToTimestamp":"2024-12-19T10:46:29.396000+00:00","timestamp":"2024-12-22T15:01:09.501000+00:00","username":"osmannear"},"providerHash":"0x0c61da0cb59673e578aa1648d1d6c502fd7807bcaa99de05450fb8e1636c5f32"}'
                },
                signedClaim: {
                    claim: {
                        identifier: '0x3dbb4fd3ab6806bc3b4510fe44d0a28a09b03072e0970987c7e0bdf7ab4a161a',
                        owner: '0x38040bf589011639ee17e7abed20551099a0687a',
                        timestampS: 1734879670,
                        epoch: 1
                    },
                    signatures: [
                        '0x3bf1624553f086dbce89f086cee3dc4a1bf114e7d56dd51d332e49141fc1232b44a836648394cb2ae5a0530edb4c610d27c3da8d8be6c9659da009437fae85c81c'
                    ]
                }
            }]
        );

        const futureAddress = await factory['getAddress(string)'](username);
        
        // Fund the account through EntryPoint
        const depositTx = await entryPoint.depositTo(futureAddress, {
            value: ethers.parseEther("0.0035")
        });

        await depositTx.wait();

        const mnemonic = await generateSeedPhrase();
        const ownerAddress = await deriveBaseAddress(mnemonic);

        const createAccountCalldata = factory.interface.encodeFunctionData(
            "createAccount",
            [ownerAddress, username, mockReclaimProof]
        );

        const initCode = ethers.concat([
            factory.target.toString(),
            createAccountCalldata
        ]);

        const userOp = {
            sender: futureAddress,
            nonce: 0n,
            initCode,
            callData: "0x",
            accountGasLimits: ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(750_000n), 16),    // Based on actual usage
                ethers.zeroPadValue(ethers.toBeHex(750_000n), 16)
            ]),
            gasFees: ethers.concat([
                ethers.zeroPadValue(ethers.toBeHex(1_000_664n), 16),
                ethers.zeroPadValue(ethers.toBeHex(1_000n), 16)
            ]),
            preVerificationGas: 55_000n,
            paymasterAndData: "0x",
            signature: ethers.concat([ethers.toBeHex(3, 1), mockReclaimProof])
        };

        const codeBefore = await ethers.provider.getCode(futureAddress);
        console.log(codeBefore, '<<< codebefore')
        try {
            const tx = await entryPoint.handleOps([userOp], await deployer.getAddress())
        await tx.wait();

        const codeAfter = await ethers.provider.getCode(futureAddress);
        console.log(codeAfter, '<<< codeAfter')
        } catch (error) {
            const codeAfter = await ethers.provider.getCode(futureAddress);
        console.log(codeAfter, '<<< codeAfter1')
        }
        

        // console.log(tx, '<< tx')

        // Verify the account was created with correct username
        // const account = await ethers.getContractAt("DiscordAccount", futureAddress) as unknown as DiscordAccount;
        // expect(await account.username()).to.equal(username);
        // expect(await account.owner()).to.equal(ownerAddress);
    });
});

async function generateSeedPhrase(): Promise<string> {
  const mnemonic = bip39.generateMnemonic(); // 12-word mnemonic
  console.log("Seed Phrase:", mnemonic);

  const wallet = ethers.Wallet.fromPhrase(mnemonic);
  console.log("Private Key:", wallet.privateKey);
  console.log("Address:", wallet.address);

  return mnemonic;
}

async function deriveBaseAddress(mnemonic: string): Promise<string> {
  // Convert mnemonic to seed
  const seed = await bip39.mnemonicToSeed(mnemonic);

  // Create an HD wallet from the seed
  const hdWallet = hdkey.fromMasterSeed(seed);

  // Derive the base address (Ethereum: m/44'/60'/0'/0/0)
  const walletPath = "m/44'/60'/0'/0/0";
  const wallet = hdWallet.derivePath(walletPath).getWallet();

  // Get the public address
  const address = `0x${wallet.getAddress().toString("hex")}`;
  const checksumAddress = toChecksumAddress(address); // Optional, for better compatibility

  console.log("Base Address:", checksumAddress);
  return checksumAddress;
}
