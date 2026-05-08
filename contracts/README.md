# Storefront Contracts

`StorefrontAttestation.sol` is the on-chain settlement layer for the storefront swarm. It is deployed exclusively to the **Kite AI Testnet** (chain ID `2368`).

Built with Hardhat 3 Beta + `viem`.

## Networks

| Name | Chain ID | RPC | Purpose |
|---|---|---|---|
| `hardhat` | local | in-process | Unit tests (`npx hardhat test`) |
| `kiteTestnet` | 2368 | `https://rpc-testnet.gokite.ai/` | Settlement target |

No other networks are configured. Settlement is Kite-only by design.

## Tests

```shell
npx hardhat test
npx hardhat test solidity
npx hardhat test nodejs
```

## Deploy StorefrontAttestation to Kite Testnet

### 1. Configure environment

```shell
cp .env.example .env
```

| Variable | Value |
|---|---|
| `KITE_RPC_URL` | `https://rpc-testnet.gokite.ai/` |
| `KITE_PRIVATE_KEY` | Deployer wallet private key (with `0x` prefix) |
| `KITE_EXPLORER_API_KEY` | API key from https://testnet.kitescan.ai/ |

Fund the deployer wallet from the [Kite faucet](https://faucet.gokite.ai) before deploying.

### 2. Set config variables (recommended: keystore)

```shell
npx hardhat keystore set KITE_RPC_URL
npx hardhat keystore set KITE_PRIVATE_KEY
```

Or export them directly:

```shell
export KITE_RPC_URL=https://rpc-testnet.gokite.ai/
export KITE_PRIVATE_KEY=0xYOUR_KEY
```

### 3. Compile and deploy

```shell
npx hardhat compile
npx hardhat run scripts/deploy-storefront.ts --network kiteTestnet
```

Expected output:

```
Deploying with account: 0xYourAddress
StorefrontAttestation deployed to: 0xDeployedContractAddress
Treasury set to:                   0xYourAddress

Verify on explorer: https://testnet.kitescan.ai/address/0xDeployedContractAddress
```

### 4. Verify on explorer

```shell
npx hardhat verify --network kiteTestnet --build-profile production <ADDRESS> <TREASURY_ADDRESS>
```

Or visit [testnet.kitescan.ai](https://testnet.kitescan.ai/) and paste the address.

## Troubleshooting

| Error | Fix |
|---|---|
| `Insufficient funds for gas` | Fund the deployer from https://faucet.gokite.ai |
| `No KITE_PRIVATE_KEY set` | Add it to `.env` or `hardhat keystore set KITE_PRIVATE_KEY` |
| `Unsupported chainId` | Confirm RPC is `https://rpc-testnet.gokite.ai/` and chain ID is `2368` |
| `Invalid sender / nonce too low` | Wait for pending txs, or reset the account nonce |
