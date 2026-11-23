// Local sample-data preview only. Never imported by the production API.
import { createServer } from "vite";
import {
  createSecureDb,
  prepareTestPins,
  sql,
} from "../tests/helpers/secureDb.js";
import { fixtureAdmin } from "../tests/helpers/fixtureAdmin.js";
import { createHandler } from "../server/backend.js";
Object.assign(process.env, {
  VITE_SECURE_BACKEND: "true",
  VITE_SUPABASE_URL: "https://fixture.supabase.co",
  VITE_SUPABASE_ANON_KEY: "fixture-key",
  SUPABASE_URL: "https://fixture.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
  SECURE_CUTOVER_ACTIVE: "true",
});
const db = await createSecureDb();
await db.exec(
  'alter table products add column "isAvailable" boolean default true',
);
await prepareTestPins(db);
await db.exec(await sql("20261123123554_secure_pos_cutover.sql"));
const fixture = fixtureAdmin(db),
  handler = createHandler({
    adminFactory: () => fixture.admin,
    secret: () => "test-pepper",
    fetcher: fixture.fetcher,
  });
const server = await createServer({
  server: { host: "127.0.0.1", port: 5185, strictPort: true },
  plugins: [
    {
      name: "local-sample-api",
      configureServer(vite) {
        vite.middlewares.use("/api", (req, res) => {
          // Local loopback preview uses HTTP. Production always keeps Secure cookies.
          const set = res.setHeader.bind(res);
          res.setHeader = (name, value) =>
            set(
              name,
              name.toLowerCase() === "set-cookie"
                ? value.replace("; Secure", "")
                : value,
            );
          handler(req, res);
        });
      },
    },
  ],
});
await server.listen();
console.log(
  "Local sample preview: http://127.0.0.1:5185/#/pos — owner PIN 2468, kitchen PIN 9753. Use separate browser profiles for the two roles. All data is temporary; no café records or external services are used.",
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await server.close();
    await db.close();
    process.exit(0);
  });
