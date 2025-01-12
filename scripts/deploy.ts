import { ethers } from "hardhat";

async function main() {
  // 1. Deploy or get a reference to EntryPoint
  //    For local dev, you can deploy one, or you can fetch a known address if you already have it.
  const EntryPointFactory = await ethers.getContractFactory("EntryPoint");
  const entryPoint = await EntryPointFactory.deploy();
  await entryPoint.deployed();
  console.log("EntryPoint deployed to:", entryPoint.address);

  // 2. Suppose we also want to deploy a Reclaim contract locally for tests.
  //    If you prefer to skip local Reclaim deployment and rely on the submodule or a known testnet address, 
  //    you can remove or comment out this step.
  const ReclaimFactory = await ethers.getContractFactory("Reclaim");
  const reclaimContract = await ReclaimFactory.deploy();
  await reclaimContract.deployed();
  console.log("Reclaim contract deployed to:", reclaimContract.address);

  // 3. Deploy the DiscordAccountFactory
  const [deployer] = await ethers.getSigners();
  const DiscordAccountFactory = await ethers.getContractFactory("DiscordAccountFactory");
  const factory = await DiscordAccountFactory.deploy(
    deployer.address,          // Owner
    entryPoint.address,        // EntryPoint
    reclaimContract.address    // Reclaim
  );
  await factory.deployed();
  console.log("DiscordAccountFactory deployed to:", factory.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
