import test from "node:test";
import assert from "node:assert/strict";
import {
  APIFY_BUSY_MESSAGE,
  apifyErrorMessage,
  apifyQueueState,
  buildRunSyncUrl,
  isMemoryLimitError,
  runApifySync,
} from "../services/apify-run";

const MEM_402 = JSON.stringify({ error: { type: "actor-memory-limit-exceeded", message: "memory limit" } });
const opts = { token: "t", maxTotalChargeUsd: 0.5, clientTimeoutMs: 60_000, retryDelaysMs: [1, 1] };

function mockFetch(handler: (url: string) => Promise<Response> | Response) {
  const orig = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    calls.push(String(url));
    return handler(String(url));
  }) as any;
  return { calls, restore: () => (globalThis.fetch = orig) };
}

test("URL chạy có hạn phía Apify ngắn hơn thời gian app chờ", () => {
  const u = new URL(buildRunSyncUrl("apify~x", { maxTotalChargeUsd: 0.5, clientTimeoutMs: 180_000 }));
  assert.equal(u.searchParams.get("timeout"), "165");
  assert.equal(u.searchParams.get("maxTotalChargeUsd"), "0.5");
  assert.equal(u.searchParams.get("memory"), null);
  const m = new URL(buildRunSyncUrl("apify~x", { maxTotalChargeUsd: 1, clientTimeoutMs: 10_000, memoryMb: 2048 }));
  assert.equal(m.searchParams.get("timeout"), "30");
  assert.equal(m.searchParams.get("memory"), "2048");
});

test("nhận ra lỗi 402 hết RAM, không nhầm với 402 khác", () => {
  assert.equal(isMemoryLimitError(402, MEM_402), true);
  assert.equal(isMemoryLimitError(402, '{"error":{"type":"not-enough-usage"}}'), false);
  assert.equal(isMemoryLimitError(500, MEM_402), false);
  assert.equal(apifyErrorMessage({ status: 402, ok: false, body: MEM_402 }), APIFY_BUSY_MESSAGE);
});

test("402 hết RAM thì thử lại, lần sau thành công", async () => {
  let n = 0;
  const m = mockFetch(() => (++n < 2 ? new Response(MEM_402, { status: 402 }) : new Response("[1]", { status: 201 })));
  try {
    const res = await runApifySync("a", {}, opts);
    assert.equal(res.ok, true);
    assert.equal(res.body, "[1]");
    assert.equal(m.calls.length, 2);
  } finally {
    m.restore();
  }
});

test("hết lượt thử thì trả 402 để nơi gọi báo 'Apify đang bận'", async () => {
  const m = mockFetch(() => new Response(MEM_402, { status: 402 }));
  try {
    const res = await runApifySync("a", {}, opts);
    assert.equal(res.status, 402);
    assert.equal(m.calls.length, 3); // 1 lần + 2 lần thử lại
    assert.equal(apifyErrorMessage(res), APIFY_BUSY_MESSAGE);
  } finally {
    m.restore();
  }
});

test("không quá 2 lượt chạy cùng lúc, các lượt sau xếp hàng", async () => {
  let active = 0;
  let peak = 0;
  const m = mockFetch(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 20));
    active--;
    return new Response("[]", { status: 201 });
  });
  try {
    await Promise.all(Array.from({ length: 5 }, () => runApifySync("a", {}, opts)));
    assert.equal(peak, 2);
    assert.equal(m.calls.length, 5);
    assert.deepEqual({ ...apifyQueueState(), max: 2 }, { running: 0, waiting: 0, max: 2 });
  } finally {
    m.restore();
  }
});

test("lỗi mạng vẫn nhả chỗ trong hàng đợi", async () => {
  const m = mockFetch(() => {
    throw new Error("boom");
  });
  try {
    await assert.rejects(runApifySync("a", {}, opts), /boom/);
    assert.equal(apifyQueueState().running, 0);
  } finally {
    m.restore();
  }
});
