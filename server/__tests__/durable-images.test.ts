import { test } from "node:test";
import assert from "node:assert/strict";
import { preferDurableImage, storedImage, createImageKeeperDetailed, isExpiringImageUrl, type ImageLedger, type ImageRecord } from "../services/durable-images";
import { cacheRemoteImage, imageMagicMatches } from "../services/thumb-cache";
import { repairExpiringImagesWith, MAX_REPAIR_LIMIT } from "../services/image-repair-job";

function memoryLedger() {
  const rows = new Map<string, ImageRecord>();
  const ledger: ImageLedger = { async get(k) { return rows.get(k); }, async put(k, r) { rows.set(k, r); } };
  return { rows, ledger };
}
test("detect expiring CDN URLs, signatures, not lookalikes or internal files", () => {
  for (const url of ["https://scontent.xx.fbcdn.net/a?oe=ff", "https://a.cdninstagram.com/a", "https://p16-sign.tiktokcdn.com/a", "https://cdn.example/a?x-expires=123", "https://cdn.example/a?X-Amz-Expires=10".toLowerCase()]) assert.equal(isExpiringImageUrl(url), true, url);
  for (const url of ["/api/files/misc/a.jpg", "https://fbcdn.net.attacker.com/a", "https://example.com/a", "not-a-url"]) assert.equal(isExpiringImageUrl(url), false, url);
});
test("internal image never downloads; same external source reuses durable cache", async () => {
  const { ledger } = memoryLedger(); let calls = 0;
  const keep = createImageKeeperDetailed(ledger, async () => { calls++; return "/api/files/misc/a.jpg"; });
  assert.equal((await keep("/api/files/misc/a.jpg")).outcome, "skipped");
  assert.equal((await keep("https://cdn.example/a")).outcome, "stored");
  assert.equal((await keep("https://cdn.example/a")).outcome, "reused");
  assert.equal(calls, 1);
});
test("concurrent duplicate URL only downloads once", async () => {
  let calls = 0;
  const keep = createImageKeeperDetailed(undefined, async () => { calls++; return "/api/files/misc/a.jpg"; });
  await Promise.all([keep("https://cdn.example/a"), keep("https://cdn.example/a")]);
  assert.equal(calls, 1);
});
for (const status of [403, 404]) test(`${status} retains source, marks dead and respects finite cooldown`, async () => {
  const { rows, ledger } = memoryLedger(); let calls = 0;
  const keep = createImageKeeperDetailed(ledger, async (_url, _prefix, onStatus) => { calls++; onStatus?.(status); return null; });
  const url = "https://a.fbcdn.net/a?oe=old";
  assert.deepEqual(await keep(url), { url, outcome: "dead" });
  await keep(url); assert.equal(calls, 1); assert.equal([...rows.values()][0].dead, true);
  await keep(url.replace("old", "new")); assert.equal(calls, 2);
});
test("transient failure has finite exponential cooldown, not permanent death", async () => {
  const { rows, ledger } = memoryLedger(); let calls = 0;
  const keep = createImageKeeperDetailed(ledger, async () => { calls++; return null; });
  const url = "https://a.fbcdn.net/a";
  assert.equal((await keep(url)).url, url);
  await keep(url); assert.equal(calls, 1);
  for (let i = 0; i < 8; i++) { for (const row of rows.values()) row.retryAt = 0; await keep(url); }
  assert.equal(calls, 9); assert.equal([...rows.values()][0].dead, false);
});
test("storage/ledger failure cannot break the primary flow", async () => {
  const keep = createImageKeeperDetailed({ async get() { throw Error("db"); }, async put() { throw Error("db"); } }, async () => null);
  assert.equal((await keep("https://a.fbcdn.net/a")).url, "https://a.fbcdn.net/a");
});
test("repair clamps a run even when finder returns too many rows", async () => {
  let downloads = 0; let updates = 0;
  const r = await repairExpiringImagesWith({
    async find(limit) { assert.equal(limit, MAX_REPAIR_LIMIT); return Array.from({ length: 100 }, (_, i) => ({ table: "radar_items", column: "cover_url", id: String(i), url: `https://a.fbcdn.net/${i}` })); },
    async keep() { downloads++; return { url: "/api/files/misc/a.jpg", outcome: "stored" }; },
    async update() { updates++; return true; },
  }, 999);
  assert.deepEqual(r, { checked: MAX_REPAIR_LIMIT, fixed: MAX_REPAIR_LIMIT, dead: 0, failed: 0 });
  assert.equal(downloads, MAX_REPAIR_LIMIT); assert.equal(updates, MAX_REPAIR_LIMIT);
});
test("repair reports dead/transient failures without overwriting source", async () => {
  let updates = 0;
  const r = await repairExpiringImagesWith({ async find() { return ["dead", "failed"].map(id => ({ table: "x", column: "x", id, url: id })); }, async keep(url) { return { url, outcome: url as "dead" | "failed" }; }, async update() { updates++; return true; } });
  assert.deepEqual(r, { checked: 2, fixed: 0, dead: 1, failed: 1 }); assert.equal(updates, 0);
});
test("internal downloader bypasses all transport", async () => {
  assert.equal(await cacheRemoteImage("/api/files/misc/a.jpg"), "/api/files/misc/a.jpg");
});
test("HTML/SVG and mismatched image magic are rejected", () => {
  for (const mime of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
    assert.equal(imageMagicMatches(Buffer.from("<html>not-image</html>"), mime), false);
    assert.equal(imageMagicMatches(Buffer.from("<svg xmlns='x'>"), mime), false);
  }
  assert.equal(imageMagicMatches(Buffer.from("GIF89a0000"), "image/gif"), true);
  assert.equal(imageMagicMatches(Buffer.from("ffd8ffe00000", "hex"), "image/jpeg"), true);
  assert.equal(imageMagicMatches(Buffer.from("GIF89a0000"), "image/png"), false);
});
test("existing internal avatar/thumbnail survives failed new CDN download", async () => {
  for (const status of [undefined,403]) {
    const keep = createImageKeeperDetailed(undefined, async (_u,_p, cb) => { if(status) cb?.(status); return null; });
    const incoming = (await keep("https://a.fbcdn.net/new")).url;
    assert.equal(preferDurableImage("/api/files/misc/good.jpg", incoming), "/api/files/misc/good.jpg");
    assert.equal(await storedImage(incoming, "/api/files/misc/good.jpg"), "/api/files/misc/good.jpg");
  }
});
test("403/404 become eligible after cooldown, storage failure remains transient", async () => {
  const { rows, ledger } = memoryLedger(); let calls = 0;
  const keep = createImageKeeperDetailed(ledger, async (_u,_p,cb) => { calls++; cb?.(403); return null; });
  await keep("https://a.fbcdn.net/a");
  for (const r of rows.values()) r.retryAt = 0;
  await keep("https://a.fbcdn.net/a"); assert.equal(calls,2);
  const storeFailure = createImageKeeperDetailed(ledger, async (_u,_p,cb) => { cb?.(200); return null; });
  await storeFailure("https://a.fbcdn.net/b"); assert.equal([...rows.values()][1].dead,false);
});
test("repair racing newer sync does not count zero affected rows as fixed", async () => {
  const r = await repairExpiringImagesWith({async find(){return [{table:"x",column:"x",id:"x",url:"https://a.fbcdn.net/a"}];},async keep(){return {url:"/api/files/misc/a.jpg",outcome:"stored"};},async update(){return false;}});
  assert.equal(r.fixed,0);
});

test("tác vụ sửa ảnh cũ mặc định tắt, chỉ bật khi IMAGE_REPAIR_JOB=on", async () => {
  const { isImageRepairJobEnabled } = await import("../services/image-repair-job");
  const old = process.env.IMAGE_REPAIR_JOB;
  try {
    delete process.env.IMAGE_REPAIR_JOB;
    assert.equal(isImageRepairJobEnabled(), false);
    process.env.IMAGE_REPAIR_JOB = "off";
    assert.equal(isImageRepairJobEnabled(), false);
    process.env.IMAGE_REPAIR_JOB = "on";
    assert.equal(isImageRepairJobEnabled(), true);
  } finally {
    if (old === undefined) delete process.env.IMAGE_REPAIR_JOB; else process.env.IMAGE_REPAIR_JOB = old;
  }
});
