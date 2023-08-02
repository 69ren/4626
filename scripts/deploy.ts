import { ethers, run } from "hardhat";
import { Vault } from "../typechain-types";

async function deploy() {
    console.log('deploying...')

    const Vault = await ethers.getContractFactory("Vault")
    const vault = await Vault.deploy("name", "symbol") as Vault
    await vault.waitForDeployment()

    let tx = await vault.setTreasury("")
    await tx.wait()

    tx = await vault.setRoute([])
    await tx.wait()


    await run("verify:verify", {
        address: await vault.getAddress(),
        constructorArguments: [
            "name",
            "symbol"
        ]
    })
    console.log('success, ', "address: ", await vault.getAddress())
}

deploy()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });