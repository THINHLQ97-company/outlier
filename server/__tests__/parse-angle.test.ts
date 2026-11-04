import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSuggestedAngle, angleBlocks } from "../../src/components/trend/parseAngle";

const SAMPLE = `GÀN VÀ GÈN: "Túi sinh tồn 72h phiên bản dân văn phòng" — so sánh 2 khung dọc: trên "Thái Lan khuyên mang" (nước, đèn pin, thuốc, giấy tờ); dưới "Đồng nghiệp IT mang" (3 cục sạc dự phòng, laptop, bàn phím cơ, mì gói, quên luôn nước). Hoặc 4 khung: Gèn soạn túi rất nghiêm túc → mở ra toàn đồ sạc/cáp → bảo "72 tiếng không wifi mới là thảm họa". Giữ khuôn webtoon chibi văn phòng; tránh từ kỹ thuật bị cấm. ĂN THỊT ANH LẬP TRÌNH: câu đố tên miền cắt dấu từ trend, ví dụ "tuisinhton.vn" / "sinhton72h" — caption chỉ hỏi "mấy má đọc là gì :))", ảnh thanh địa chỉ trình duyệt hoặc chat khách hỏi "chị ơi tên này còn không". Bắt buộc tra còn trống trước khi đăng; CTA ở comment. Có thể nối "server sống sót 72h không sập" cho Vibe Hosting nhưng nhẹ nhàng. TRÁNH: không nói Thái Lan/VN ban bố tình trạng khẩn cấp, không gắn chiến tranh/Trung Đông hay "tận thế tháng 11", không chế giễu thiên tai/nạn nhân, không giễu người Thái; nếu có thông tin thì dùng đúng là DDPM khuyến cáo phòng ngừa chung.`;

test("tách 2 khối page và 1 khối Cần tránh", () => {
  const b = parseSuggestedAngle(SAMPLE);
  assert.deepEqual(b.map(x => x.title), ["Gàn Và Gèn", "Ăn Thịt Anh Lập Trình", "Cần tránh"]);
  assert.equal(b[2].warning, true);
});
test("đúng số ý và không tách trong ngoặc kép", () => {
  const [g, a, t] = parseSuggestedAngle(SAMPLE);
  assert.equal(g.ideas.length, 5);
  assert.ok(g.ideas[2].startsWith("Hoặc 4 khung"));
  assert.ok(g.ideas[2].includes('"72 tiếng không wifi mới là thảm họa".'));
  assert.equal(a.ideas.length, 4);
  assert.ok(a.ideas[0].includes('"mấy má đọc là gì :))"'));
  assert.equal(t.ideas.length, 2);
});
test("dấu chấm và chấm phẩy trong ngoặc kép không tách", () => {
  const [b] = parseSuggestedAngle('CHUNG: "a; b. c" rồi d; e.');
  assert.equal(b.ideas.length, 2);
  assert.equal(b.ideas[0], '"a; b. c" rồi d;');
});
test("không có mốc: một khối Gợi ý chung, vẫn tách ý", () => {
  const b = parseSuggestedAngle("Làm meme nhẹ nhàng; thêm caption ngắn. Đăng buổi tối.");
  assert.equal(b.length, 1); assert.equal(b[0].title, "Gợi ý chung"); assert.equal(b[0].ideas.length, 3);
});
test("văn bản trước mốc đầu thành Gợi ý chung; cảnh báo không phân biệt hoa thường", () => {
  const b = parseSuggestedAngle("Nên làm nhanh. Lưu ý: không đùa nạn nhân");
  assert.deepEqual(b.map(x => x.title), ["Gợi ý chung", "Cần tránh"]);
});
test("khớp tên page bỏ dấu, không phân biệt hoa thường", () => {
  const b = parseSuggestedAngle("an nam voi ai: Gàn hỏi AI. Mắt Bão Travel: Gợi ý bay", ["Ăn Nằm Với AI", "Mắt Bão Travel"]);
  assert.deepEqual(b.map(x => x.title), ["Ăn Nằm Với AI", "Mắt Bão Travel"]);
});
test("pageAngles được ưu tiên hơn suggestedAngle; avoid thay khối tránh", () => {
  const b = angleBlocks({ suggestedAngle: "A: x. TRÁNH: y", pageAngles: [{ pageName: "Page 1", angle: "Ý một; ý hai" }], avoid: ["Không giễu"] });
  assert.deepEqual(b.map(x => x.title), ["Page 1", "Cần tránh"]);
  assert.deepEqual(b[0].ideas, ["Ý một;", "ý hai"]);
  assert.deepEqual(b[1].ideas, ["Không giễu"]);
});
