const { ethers } = require('ethers');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
require('dotenv').config();

/**
 * Authenticate a Kite Passport on the deployed StorefrontAttestation.
 *
 * Usage:
 *   node scripts/authenticate_passport.cjs <passportId> [networkName]
 *
 * Network defaults to "kiteTestnet". Reads attestation address from
 * deployments/<network>.json, with ATTESTATION_ADDRESS env override.
 */
async function main() {
    const passportId = process.argv[2];
    const networkName = process.argv[3] || 'kiteTestnet';
    if (!passportId) {
        console.error('Usage: node scripts/authenticate_passport.cjs <passportId> [networkName]');
        process.exit(1);
    }

    let contractAddress = process.env.ATTESTATION_ADDRESS;
    if (!contractAddress) {
        const path = resolve(__dirname, '..', 'deployments', `${networkName}.json`);
        if (!existsSync(path)) {
            console.error(`No ATTESTATION_ADDRESS env and no deployments/${networkName}.json. Run deploy-storefront.ts first.`);
            process.exit(1);
        }
        const record = JSON.parse(readFileSync(path, 'utf8'));
        contractAddress = record?.attestation?.address;
        if (!contractAddress) {
            console.error(`deployments/${networkName}.json has no attestation.address`);
            process.exit(1);
        }
    }

    const provider = new ethers.JsonRpcProvider(process.env.KITE_RPC_URL);
    const wallet = new ethers.Wallet(process.env.KITE_PRIVATE_KEY, provider);
    const abi = ["function authenticateAgentIdentity(string calldata kitePassportId) external"];
    const contract = new ethers.Contract(contractAddress, abi, wallet);

    console.log(`Network:     ${networkName}`);
    console.log(`Attestation: ${contractAddress}`);
    console.log(`Authenticating passport: ${passportId}`);
    const tx = await contract.authenticateAgentIdentity(passportId);
    console.log(`Transaction hash: ${tx.hash}`);
    await tx.wait();
    console.log('Passport authenticated successfully!');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
