import { createClient } from "@sanity/client";
import dotenv from "dotenv";

dotenv.config();

const client = createClient({
  projectId: "75fz8bzj",
  dataset: "production",
  apiVersion: "2024-04-07",
  useCdn: false,
  token: process.env.SANITY_API_WRITE_TOKEN || process.env.SANITY_API_TOKEN || process.env.SANITY_API_READ_TOKEN,
});

async function resetPrices() {
  console.log("Connecting to Sanity to reset Cisco Catalyst prices...");
  
  // 1. Reset CIS-CATALY-791 to 0.029 KITE
  const prod1 = await client.fetch(`*[_type == "product" && sku == "CIS-CATALY-791"][0]`);
  if (prod1) {
    await client.patch(prod1._id).set({ price: 0.029 }).commit();
    console.log(`✅ Successfully reset CIS-CATALY-791 (${prod1.name}) to 0.029 KITE`);
  } else {
    console.warn("⚠️ Product CIS-CATALY-791 not found");
  }

  // 2. Reset CIS-CATALY-580 to 0.117 KITE
  const prod2 = await client.fetch(`*[_type == "product" && sku == "CIS-CATALY-580"][0]`);
  if (prod2) {
    await client.patch(prod2._id).set({ price: 0.117 }).commit();
    console.log(`✅ Successfully reset CIS-CATALY-580 (${prod2.name}) to 0.117 KITE`);
  } else {
    console.warn("⚠️ Product CIS-CATALY-580 not found");
  }

  console.log("Price reset process completed successfully!");
}

resetPrices().catch(console.error);
