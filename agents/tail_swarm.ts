import { client as sanityClient } from "./sanity/client";

async function tailLogs() {
  console.log("📡 Listening for live swarm logs from Sanity... (Ctrl+C to stop)");
  
  // Initial fetch of last 10 logs
  const initialLogs = await sanityClient.fetch(
    `*[_type == "swarmLog"] | order(timestamp desc) [0...10]`
  );
  initialLogs.reverse().forEach((l: any) => {
    console.log(`[${l.timestamp}] [${l.agent}] ${l.message}`);
  });

  // Listen for new logs
  const query = `*[_type == "swarmLog"]`;
  const subscription = sanityClient.listen(query).subscribe((update: any) => {
    if (update.result) {
      const l = update.result;
      console.log(`[${l.timestamp}] [${l.agent}] ${l.message}`);
    }
  });

  process.on("SIGINT", () => {
    subscription.unsubscribe();
    process.exit(0);
  });
}

tailLogs().catch(console.error);
