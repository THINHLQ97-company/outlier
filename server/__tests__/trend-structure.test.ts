import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { structureFromTrend, TREND_DEFAULT_DIRECTION } from "../services/trend-structure";

const good = JSON.stringify({
  hook3s: { atSec: 0, what: "Hỏi ngược người đọc", technique: "câu hỏi ngược đời" },
  problemOpen: { atSec: 0, what: "Ai cũng từng gặp cảnh này", how: "kể tình huống quen" },
  retentionBeats: [{ atSec: 5, what: "đẩy tình huống lên", whyItWorks: "càng lúc càng vô lý" }],
  twist: { atSec: 10, what: "hoá ra là do cái khác" },
  cta: { atSec: 15, what: "hỏi người đọc", style: "mời kể chuyện" },
  formula: "mở bằng câu hỏi ngược → đẩy tình huống → bẻ hướng → mời kể chuyện",
  notes: "Đu được, né nhắc tên người trong drama.",
});

describe("structureFromTrend — trend đi qua bóc cấu trúc như mọi nguồn khác", () => {
  test("rút ra được công thức triển khai", async () => {
    const out = await structureFromTrend("Drama ca sĩ X", "Đang ồn ào vụ...", async () => good);
    assert.match(out.structure!.formula!, /mở bằng câu hỏi ngược/);
    assert.equal(out.structure!.retentionBeats?.length, 1);
  });

  test("BỎ mốc giây — trend không có video, số 0 trông như mốc có thật", async () => {
    const out = await structureFromTrend("X", "y", async () => good);
    assert.equal((out.structure!.hook3s as any)?.atSec, undefined);
    assert.equal((out.structure!.cta as any)?.atSec, undefined);
  });

  test("prompt dặn đùa vào tình huống, không đùa vào người", async () => {
    let sent = "";
    await structureFromTrend("X", "y", async (p) => {
      sent = p;
      return good;
    });
    assert.match(sent, /đùa vào TÌNH HUỐNG/);
    assert.match(sent, /Không nêu tên thật/);
    assert.match(sent, /HÀI HƯỚC/);
  });

  test("trend rỗng thì từ chối, không gọi model", async () => {
    let called = false;
    const out = await structureFromTrend("", "  ", async () => {
      called = true;
      return good;
    });
    assert.equal(out.structure, null);
    assert.equal(called, false);
  });

  test("model trả rác thì báo lỗi, không lưu cấu trúc rỗng", async () => {
    const out = await structureFromTrend("X", "y", async () => "không phải JSON");
    assert.equal(out.structure, null);
    assert.match(out.warning || "", /không đọc được|Không rút ra/i);
  });

  test("thiếu công thức thì coi như thất bại — không có công thức thì viết lại bằng gì", async () => {
    const out = await structureFromTrend("X", "y", async () => JSON.stringify({ notes: "chỉ có ghi chú" }));
    assert.equal(out.structure, null);
  });

  test("hướng mặc định cho trend: hài, bám mảng nội dung, không đưa tin", async () => {
    assert.match(TREND_DEFAULT_DIRECTION, /HÀI HƯỚC/);
    assert.match(TREND_DEFAULT_DIRECTION, /mảng nội dung/);
    assert.match(TREND_DEFAULT_DIRECTION, /không phải để đưa tin/);
  });
});
