import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-abi-exporter";
import { resolve } from "path";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: resolve(__dirname, "./.env") });


const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      forking: {
        url: `https://base.blockpi.network/v1/rpc/public	`
      },
      accounts: [
        {
          privateKey: process.env.PRIVATE_KEY!,
          balance: "10000000000000000000000"
        }
      ]
    },
    arbi: {
      url: `https://arbitrum-one.public.blastapi.io/`,
      accounts: [process.env.PRIVATE_KEY!]
    },
    tenderly: {
      url: ``,
      accounts: [process.env.PRIVATE_KEY!]
    }
  },
  etherscan: {
    apiKey: {
      arbitrumOne: process.env.API_KEY!
    }
  }
};

export default config;
