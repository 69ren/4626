import { ethers, run } from "hardhat";

async function deploy() {
    console.log('deploying...')

    const Vault = await ethers.getContractFactory("Vault")
    const vault = await Vault.deploy()
    await vault.waitForDeployment()



    await run("verify:verify", {
        address: await vault.getAddress(),
        constructorArguments: [
            
        ]
    })
    console.log('success, ', "tokenAddress: ", await vault.getAddress())
}

deploy()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });