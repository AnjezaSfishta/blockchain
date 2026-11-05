const fs = require("node:fs");
const path = require("node:path");
const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying to ${network.name} with ${deployer.address}`);

  const Registry = await ethers.getContractFactory("InvoiceRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();

  const Workflow = await ethers.getContractFactory("InvoiceWorkflow");
  const workflow = await Workflow.deploy(await registry.getAddress());
  await workflow.waitForDeployment();

  const setup = await registry.setWorkflow(await workflow.getAddress());
  await setup.wait();

  const deployment = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    registry: await registry.getAddress(),
    workflow: await workflow.getAddress(),
    deployer: deployer.address,
    deployedAt: new Date().toISOString()
  };
  const outputPath = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(`Deployment saved to ${outputPath}`);
  console.log(JSON.stringify(deployment, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
