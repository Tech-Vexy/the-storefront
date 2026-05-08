const { ethers } = require('ethers');
require('dotenv').config();

async function main() {
    const provider = new ethers.JsonRpcProvider(process.env.KITE_RPC_URL);
    const wallet = new ethers.Wallet(process.env.KITE_PRIVATE_KEY, provider);
    const contractAddress = "0x8ad8c56a5470ad0f10972eebe149cac55175d282";
    const abi = ["function authenticateAgentIdentity(string calldata kitePassportId) external"];
    const contract = new ethers.Contract(contractAddress, abi, wallet);

    const passportId = process.argv[2] || "agp_befecc2a225a4a4cab1f47a9c20562f8";
    console.log(`Authenticating passport: ${passportId}`);
    const tx = await contract.authenticateAgentIdentity(passportId);
    console.log(`Transaction hash: ${tx.hash}`);
    await tx.wait();
    console.log("Passport authenticated successfully!");
}

main().catch(console.error);
