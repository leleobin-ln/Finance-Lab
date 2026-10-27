import { getStore } from "@netlify/blobs";
import { UPI_ID, PAYEE, ORG, COURSES } from "./config.mjs";

export const config = { path: "/api/*" };
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });

export default async (req) => {
  const path = new URL(req.url).pathname.replace(/^\/api\//, "");
  const store = getStore("payments");

  if (path === "courses") return json({ upi: UPI_ID, payee: PAYEE, org: ORG, courses: COURSES });

  // Student submits payment proof (one record per transaction ID, so duplicates are blocked)
  if (path === "submit" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const name = String(b.name || "").trim().slice(0, 80);
    const cls = String(b.cls || "").trim().slice(0, 40);
    const c = COURSES.find(x => x.name === b.course);
    const amount = Number(b.amount);
    const utr = String(b.utr || "").replace(/\s/g, "");
    if (!name || !cls || !c || !(amount > 0) || amount > c.fee || !/^\d{12}$/.test(utr))
      return json({ error: "Please check all fields. The transaction ID (UTR) must be 12 digits." }, 400);
    const rec = { name, cls, course: c.name, amount, utr, status: "pending", at: new Date().toISOString() };
    const r = await store.setJSON("utr-" + utr, rec, { onlyIfNew: true });
    if (!r.modified) return json({ error: "This transaction ID was already submitted." }, 409);
    return json({ ok: true });
  }

  // Admin routes
  if (path.startsWith("admin/")) {
    if (!process.env.ADMIN_PASSWORD || req.headers.get("x-admin-password") !== process.env.ADMIN_PASSWORD)
      return json({ error: "Wrong password" }, 401);

    if (path === "admin/list") {
      const { blobs } = await store.list();
      const keys = blobs.map(b => b.key), out = [];
      for (let i = 0; i < keys.length; i += 100) {
        const part = await Promise.all(keys.slice(i, i + 100).map(async k => ({ key: k, ...(await store.get(k, { type: "json" })) })));
        out.push(...part);
      }
      return json({ payments: out, courses: COURSES });
    }
    if (path === "admin/status" && req.method === "POST") {
      const { key, status } = await req.json().catch(() => ({}));
      if (!["verified", "rejected", "pending"].includes(status)) return json({ error: "Bad status" }, 400);
      const rec = key && await store.get(key, { type: "json" });
      if (!rec) return json({ error: "Not found" }, 404);
      rec.status = status;
      await store.setJSON(key, rec);
      return json({ ok: true });
    }
  }
  return json({ error: "Not found" }, 404);
};
