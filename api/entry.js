import { createHandler, cleanupProofs, getAdmin } from "../server/backend.js";
export const config = { maxDuration: 60 };
const handler = createHandler();
export default async function entry(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (
    (url.searchParams.get("path") || url.pathname.replace("/api/", "")) ===
    "jobs/proof-retention"
  ) {
    if (
      !process.env.CRON_SECRET ||
      req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`
    ) {
      res.statusCode = 401;
      return res.end();
    }
    try {
      let removed = 0,
        batch = 0;
      do {
        batch = await cleanupProofs(getAdmin());
        removed += batch;
      } while (batch === 200 && removed < 1000);
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ removed }));
    } catch {
      res.statusCode = 500;
      return res.end(
        JSON.stringify({ message: "Retention cleanup needs retry." }),
      );
    }
  }
  return handler(req, res);
}
