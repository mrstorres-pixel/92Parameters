import { createClient } from "@supabase/supabase-js";
// Local PostgREST/Storage transport. It executes real SQL but cannot access a network.
export function fixtureAdmin(db) {
  const objects = new Map();
  const ident = (value) => {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value))
      throw new Error("Invalid fixture identifier");
    return `"${value}"`;
  };
  const fetcher = async (input, options = {}) => {
    const url = new URL(String(input)),
      method = options.method || "GET",
      headers = new Headers(options.headers),
      reply = (data, status = 200, extra = {}) =>
        new Response(method === "HEAD" ? null : JSON.stringify(data), {
          status,
          headers: { "content-type": "application/json", ...extra },
        });
    const run = (query, params = []) =>
      db.transaction(async (tx) => {
        await tx.exec("set local role service_role");
        await tx.query("select set_config('request.headers',$1,true)", [
          JSON.stringify(Object.fromEntries(headers.entries())),
        ]);
        return tx.query(query, params);
      });
    try {
      if (url.pathname.startsWith("/storage/v1/")) {
        const path = decodeURIComponent(
          url.pathname.replace("/storage/v1/object/", ""),
        );
        if (method === "POST" && path.startsWith("sign/"))
          return reply({
            signedURL: `/object/sign/${path.slice(5)}?token=fixture`,
          });
        if (method === "DELETE") {
          for (const name of JSON.parse(options.body).prefixes)
            objects.delete(`${path}/${name}`);
          return reply([]);
        }
        if (method === "POST") {
          objects.set(path, Buffer.from(options.body));
          return reply({ Key: path });
        }
        throw new Error("Unexpected storage request");
      }
      const resource = url.pathname.replace("/rest/v1/", "");
      const body = options.body ? JSON.parse(options.body) : null;
      if (resource.startsWith("rpc/")) {
        const name = resource.slice(4);
        ident(name);
        const keys = Object.keys(body);
        const result = await run(
          `select public.${ident(name)}(${keys.map((key, i) => `${ident(key)} => $${i + 1}`).join(",")}) as result`,
          Object.values(body),
        );
        return reply(result.rows[0].result);
      }
      ident(resource);
      const params = [],
        conditions = [];
      for (const [field, expression] of url.searchParams) {
        if (
          ["select", "order", "limit", "offset", "on_conflict"].includes(field)
        )
          continue;
        ident(field);
        const split = expression.indexOf("."),
          op = expression.slice(0, split),
          value = expression.slice(split + 1);
        if (op === "in") {
          const values = value.slice(1, -1).split(",");
          conditions.push(
            `${ident(field)} in (${values
              .map((v) => {
                params.push(v);
                return `$${params.length}`;
              })
              .join(",")})`,
          );
        } else if (op === "is" && value === "null") {
          conditions.push(`${ident(field)} is null`);
        } else {
          const sql = {
            eq: "=",
            gte: ">=",
            lte: "<=",
            gt: ">",
            lt: "<",
            ilike: "ilike",
          }[op];
          if (!sql) throw new Error("Unsupported fixture filter");
          params.push(value);
          conditions.push(`${ident(field)} ${sql} $${params.length}`);
        }
      }
      const where = conditions.length
        ? ` where ${conditions.join(" and ")}`
        : "";
      let rows;
      if (method === "GET" || method === "HEAD") {
        const count = (
          await run(
            `select count(*) as n from public.${ident(resource)}${where}`,
            params,
          )
        ).rows[0].n;
        const select = url.searchParams.get("select") || "*",
          fields =
            select === "*" ? "*" : select.split(",").map(ident).join(",");
        const order = url.searchParams
          .get("order")
          ?.split(",")
          .map((part) => {
            const [name, direction] = part.split(".");
            return `${ident(name)} ${direction === "desc" ? "desc" : "asc"}`;
          })
          .join(",");
        rows = (
          await run(
            `select to_jsonb(selected) as row from (select ${fields} from public.${ident(resource)}${where}${order ? ` order by ${order}` : ""} limit ${Math.min(1000, Number(url.searchParams.get("limit") || 1000))} offset ${Number(url.searchParams.get("offset") || 0)}) selected`,
            params,
          )
        ).rows.map((value) => value.row);
        const result = headers
          .get("accept")
          ?.includes("application/vnd.pgrst.object+json")
          ? rows[0]
          : rows;
        return reply(
          result ?? { message: "Not found", code: "PGRST116" },
          result === undefined ? 406 : 200,
          { "content-range": `0-${Math.max(0, rows.length - 1)}/${count}` },
        );
      }
      const writes = Array.isArray(body) ? body : [body];
      rows = [];
      if (method === "POST")
        for (const row of writes) {
          const keys = Object.keys(row),
            values = keys.map((key) => row[key]);
          const result = await run(
            `insert into public.${ident(resource)}(${keys.map(ident).join(",")}) values(${values.map((_, i) => `$${i + 1}`).join(",")}) returning *`,
            values,
          );
          rows.push(...result.rows);
        }
      else if (method === "PATCH") {
        const keys = Object.keys(body),
          values = keys.map((key) => body[key]);
        rows = (
          await run(
            `update public.${ident(resource)} set ${keys.map((key, i) => `${ident(key)}=$${params.length + i + 1}`).join(",")}${where} returning *`,
            [...params, ...values],
          )
        ).rows;
      } else if (method === "DELETE")
        rows = (
          await run(
            `delete from public.${ident(resource)}${where} returning *`,
            params,
          )
        ).rows;
      else throw new Error("Unsupported fixture method");
      return reply(rows);
    } catch (e) {
      return reply({ message: e.message, code: e.code || "FIXTURE" }, 400);
    }
  };
  const admin = createClient(
    "https://fixture.supabase.co",
    "fixture-service-key",
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetcher },
    },
  );
  return { admin, fetcher, objects };
}
