import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";
import * as dotenv from "dotenv";
dotenv.config();

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: { version: "0.8.28" },
      production: {
        version: "0.8.28",
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
    },
  },
  networks: {
    // Local simulated chain for `npx hardhat test`.
    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
    },
    // Kite AI Testnet — chain ID 2368
    // RPC: https://rpc-testnet.gokite.ai/
    // Explorer: https://testnet.kitescan.ai/
    // Faucet: https://faucet.gokite.ai
    kiteTestnet: {
      type: "http",
      chainType: "l1",
      chainId: 2368,
      url: configVariable("KITE_RPC_URL"),
      accounts: [configVariable("KITE_PRIVATE_KEY")],
    },
  },
  // Kite's explorer (kitescan.ai) is Etherscan-compatible.
  // Run: npx hardhat verify --network kiteTestnet --build-profile production <ADDRESS> <CONSTRUCTOR_ARGS>
  verify: {
    etherscan: {
      apiKey: configVariable("KITE_EXPLORER_API_KEY"),
    },
  },
});
