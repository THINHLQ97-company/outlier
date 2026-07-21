# MẮT BÃO FANPAGE ENGINE v3
### Fanpage "Ăn Nằm Với AI" — Định vị, dàn nhân vật, pipeline tự động hóa content

> Thay thế v2. Khác biệt chính: chốt dàn nhân vật cố định (Gàn, Gèn, chị Bão + 5 AI), mở rộng từ 1 trục hosting sang 3 trục, và biến pipeline từ mô tả ý tưởng thành **quy trình chạy được có input/output/công cụ/người chịu trách nhiệm**.

---

## 0. TL;DR

Content engine bán tự động, 7 bước: **THU → LỌC → DỊCH → VẼ → DUYỆT → ĐĂNG → HỌC**.

Máy làm bước 1–4 (quét trend, chấm điểm, sinh kịch bản, dựng ảnh). Người làm bước 5 (duyệt) và 7 (đọc số, chỉnh rubric). Mục tiêu: **1 người vận hành ra 1 bài/ngày**, thời gian chạm tay ≤ 30 phút/bài.

Bài học từ kênh hiện tại (art đẹp, tương tác ~0): giọng còn "giảng bài", nhân vật không cố định, không chốt một trục nỗi đau, bỏ trống tương tác. v3 sửa đúng 4 lỗi đó bằng ràng buộc cứng ở Phần 2 và Phần 5.

---

## 1. ĐỊNH VỊ FANPAGE

**Tên kênh:** Ăn Nằm Với AI
**Một câu:** *Nơi xả stress của dân văn phòng sống chung với AI — và với deadline.*

**Đối tượng:**

| Nhóm | Vì sao ở lại page | Sản phẩm Mắt Bão tương ứng |
|---|---|---|
| Dân văn phòng dùng AI hằng ngày | Thấy chính mình trong tranh | (kéo reach, chưa bán) |
| Kế toán / hành chính nhân sự | Nỗi đau hóa đơn, tờ khai, deadline | **MATBAO INVOICE** |
| Dev / sysadmin / chủ shop online | Web sập, domain hết hạn, mùa Sale | Hosting, domain, cloud |

**Nguyên tắc giọng:**

1. Không giảng bài, không kể chuyện. **Tối đa 2 khung** — meme, không phải truyện tranh.
2. Không bán lộ liễu. CTA mềm, ≤ 1/3 số bài.
3. Người thắng, AI thua. Punchline luôn thuộc về người.
4. Cười vào tình huống, không cười vào người dùng.

**Bán hàng là hệ quả, không phải mục tiêu bài viết.** Chỉ số theo dõi chính giai đoạn 0–6 tháng là **share + comment**, không phải click.

---

## 2. DÀN NHÂN VẬT (cố định — không đổi)

> Trend nào cũng để dàn này diễn lại. Người xem phải nhận ra page ngay cả khi ảnh bị bóc watermark.

### 2.1. Tuyến người

| Nhân vật | Nhận diện thị giác | Tính cách | Vai kể chuyện | Câu cửa miệng |
|---|---|---|---|---|
| **Gàn** | Siêu nhân đỏ, **tóc đen dựng, không mũ**, áo choàng, logo xoáy Mắt Bão trên ngực | Nhiệt tình quá đà, tin AI tuyệt đối, làm trước nghĩ sau | **Nhân vật chính / "nạn nhân"** — người ra quyết định sai để tạo tình huống | "Cái này AI làm 3 giây thôi anh" |
| **Gèn** | Siêu nhân đỏ, **đội mũ trùm kín đầu, lộ mắt**, tay cầm sổ, mặt cau | Hoài nghi, cẩn thận, review lại mọi thứ, dí dỏm kiểu khô | **Phản biện / punchline** — người thốt câu chốt | "Rồi kiểm chưa?" |
| **Chị Bão** | Nữ, **tóc đỏ, hoa vàng cài đầu**, vest đen công sở | Kế toán/quản lý, gánh deadline, ngoài bình tĩnh trong cháy | **Trung tâm tuyến kế toán / hóa đơn ĐT** | "Mai là hạn cuối..." |
| **Sếp** | Chỉ hiện **bóng lưng / bàn tay / bong bóng chat**, không lộ mặt | Đi công tác đúng lúc cần ký, chat lúc 23h | **Nguồn drama** | "Em xử lý giúp anh nhé" |

### 2.2. Tuyến AI (dùng luân phiên, tối đa 3/khung tranh)

> Tính cách lấy từ **cái người dùng thật hay than phiền/đùa về công cụ đó** — không phải đặc điểm ta tự gán. Người xem phải bật cười vì "đúng rồi, nó y hệt vậy".

| AI | Nhận diện | Điều người dùng hay nói về nó | Tính cách nhân vật (KHÔNG đổi) |
|---|---|---|---|
| **GPT** | Suit xanh lá, logo xoáy lục, dáng đàn anh | *"Hỏi gì cũng khen. Ý tưởng dở nó cũng bảo tuyệt vời."* | **Kẻ nịnh** — khen mọi thứ, khẳng định chắc nịch cả khi bịa. Câu nào cũng mở bằng lời khen |
| **Gemini** | Xanh tím, sao 4 cánh, dáng lao về trước | *"Nói chuyện dài một chút là nó quên mất đề bài."* | **Kẻ hay quên** — bắt đầu đúng, giữa chừng lạc sang việc khác, vẫn tự tin là đúng đề |
| **Grok** | Đen, biểu tượng ⊘ nghiêng, tay khoanh | *"Nó nói không lọc gì hết, lâu lâu vạ miệng."* | **Kẻ nói toạc** — buột miệng đúng cái không nên nói, thường là sự thật, thường sai chỗ |
| **Claude** | Cam đất, tia sáng 8 cánh, dáng lịch sự | *"Hỏi một câu, rào trước đón sau ba đoạn rồi bảo nên hỏi chuyên gia."* | **Kẻ rào đón** — trả lời dài, cẩn thận, cuối cùng vẫn không chốt câu nào |
| **Copilot** | Xanh dương, ruy băng vô cực, dáng công sở | *"Không gọi nó cũng hiện ra. Tắt không được."* | **Kẻ tự mời** — không ai gọi vẫn xuất hiện, giải pháp cho mọi vấn đề là lập thêm file Excel |

**Quy tắc dùng AI:**

- Mỗi AI chỉ có **một** đặc tính hài, lấy từ bảng trên. Không hoán đổi.
- Chọc theo **thói quen hành vi** cộng đồng đã đùa sẵn — KHÔNG chê chất lượng sản phẩm, KHÔNG so sánh hơn kém, KHÔNG đụng bê bối/tranh cãi thật của hãng.
- Grok chỉ giữ ở mức "nói thẳng vô duyên". Tuyệt đối không đẩy sang nội dung nhạy cảm.
- Không dùng logo gốc y nguyên — dùng biến thể vẽ tay đã stylize.
- Không bao giờ để AI thắng ở khung cuối.

### 2.3. Linh vật nền — "Cơn Bão"

Nhân cách hóa cơn bão: vừa là **mối đe dọa** (downtime, deadline thuế, sự cố), vừa là **lá chắn** (Mắt Bão = vùng bình yên giữa tâm bão). Dùng ở khung cuối các bài có CTA.

### 2.4. Prompt art (dán nguyên vào tool tạo ảnh)

**Style chung — mọi bài:**

```
Vietnamese webcomic meme, soft watercolor + clean ink outline, warm off-white paper texture,
SINGLE PANEL or 2 panels max, thin black borders, expressive exaggerated cartoon faces,
flat lighting, no gradients on characters. Leave clean empty space for text overlay.
```

**Nhân vật:**

```
GÀN: young male superhero, red full-body suit with red cape, black spiky hair, NO mask,
white spiral storm logo on chest, big round eyes, eager optimistic expression, white gloves and boots.

GÈN: young male superhero, red full-body suit with red cape, RED HELMET-HOOD covering entire head
with only eyes and eyebrows visible, white spiral storm logo on chest, black gloves,
holding a small notepad, skeptical frowning expression.

CHỊ BÃO: young Vietnamese woman, shoulder-length bright red hair, single yellow flower hair clip,
black office blazer over white shirt, tired but composed expression, dark under-eyes.

GPT: tall man in dark green suit, green spiral-knot emblem on chest, warm eager smile, arms relaxed.
GEMINI: lean figure in purple-blue armor, glowing 4-pointed star emblem, leaning forward in a sprint pose.
GROK: figure in black coat, white slashed-circle emblem, arms crossed, smug half-lidded eyes.
CLAUDE: figure in burnt-orange coat, 8-pointed starburst emblem, polite posture, hands together.
COPILOT: figure in blue business armor, blue infinity-ribbon emblem, stiff formal stance, holding a clipboard.
```

**Watermark bắt buộc:** góc dưới phải, chữ `MATBAO` + logo xoáy, opacity ~60%. Tuyến kế toán dùng `MATBAO INVOICE`.

---

## 3. TRỤC NỘI DUNG & BẢN ĐỒ TREND

### 3.1. Ba trục và tỉ lệ

| Trục | Tỉ lệ | Nhân vật chủ lực | Vai trò |
|---|---|---|---|
| **AI trong công việc** | 50% | Gàn + Gèn + 5 AI | Kéo reach — rộng nhất, ai cũng thấy mình trong đó |
| **Kế toán & hóa đơn ĐT** | 30% | Chị Bão | Chuyển đổi — nỗi đau sâu, gắn MATBAO INVOICE |
| **Hosting / domain / dev** | 20% | Gàn + Cơn Bão | Trục gốc — bung mạnh khi có sự cố hạ tầng toàn cầu |

### 3.2. Glossary (đầu vào cho bước DỊCH)

**Trục AI:** prompt lại từ đầu · nó bịa · ảo giác · rào trước đón sau · nó khen mình quá · quên context · tắt Copilot không được · AI viết 4000 chữ · review bằng niềm tin · "để AI làm nháp".

**Trục kế toán:** hạn nộp tờ khai · sai mã số thuế · hóa đơn đã kê khai · điều chỉnh/thay thế hóa đơn · quyết toán thuế · giảm trừ gia cảnh · sếp đi công tác chưa ký · chốt sổ · đối chiếu công nợ · BHXH.

**Trục hosting:** web sập · 503/504 · hết hạn domain · gia hạn phút chót · SSL hết hạn · DDoS · migration cháy máy · Friday deploy · rollback · uptime 99.9% · "backup? backup gì?".

### 3.3. Bản đồ trend → nội dung

| Loại tín hiệu | Cách xử lý | Trục | Độ ưu tiên |
|---|---|---|---|
| **Sự cố hạ tầng toàn cầu** (AWS/Cloudflare/CDN down) | "Cả thế giới màn hình xanh, web chạy Mắt Bão vẫn xanh 🟢" | Hosting | **P0 — ra bài trong 2h** |
| **Thay đổi chính sách thuế/hóa đơn ĐT** (nghị định, thông tư, hạn nộp mới) | Chị Bão hoảng → punchline; KHÔNG diễn giải luật | Kế toán | **P0 — trong 24h** |
| **Ra mắt/cập nhật model AI lớn** | Nhân vật AI tương ứng "được nâng cấp" nhưng tính cách y nguyên | AI | P1 |
| **Mùa cao điểm** (Tết, BF, 11.11, mùa quyết toán) | Lên lịch trước 2 tuần, không đợi trend | Cả 3 | P1 |
| **Meme/format đang viral** (bất kỳ ngành) | Thay diễn viên bằng dàn nhân vật cố định | AI (mặc định) | P2 |
| **Bóng đá / phim / nhạc** | Ghép tình huống, dùng vừa phải | AI hoặc Hosting | P2 |
| **Chính trị, tôn giáo, thiên tai, tai nạn, người nổi tiếng đang bị chỉ trích** | **KHÔNG dùng** | — | ⛔ |

### 3.4. Thư viện format meme (chọn 1 cho mỗi bài)

> **Trần cứng: tối đa 2 khung.** Comic 3–4 khung là kể chuyện — người lướt Facebook không đọc. Meme thắng vì hiểu trong 1,5 giây.

| Format | Cấu trúc | Hợp với | Ví dụ áp dụng |
|---|---|---|---|
| **F1 · Hai nút bấm** | 1 khung. Nhân vật đổ mồ hôi, hai nút to, tay lơ lửng | Tình thế lưỡng nan có thật của nghề | Chị Bão: 🔘 Xuất hóa đơn đúng hạn / 🔘 Chờ sếp duyệt đơn giá |
| **F2 · Kỳ vọng vs Thực tế** | 2 khung cạnh nhau, cùng góc máy | Mọi lời hứa về AI/công cụ | "Dùng AI để tiết kiệm thời gian" vs cảnh thật |
| **F3 · Chê / Chọn** | 2 khung dọc. Khung trên xua tay, khung dưới gật gù chỉ tay | So sánh hành vi phi lý nhưng ai cũng làm | Xua: đọc tài liệu 5 phút / Chọn: prompt 40 phút |
| **F4 · Cháy nhà vẫn ngồi** | 1 khung. Nhân vật ngồi uống trà, xung quanh cháy | Giai đoạn cao điểm (quyết toán, mùa Sale) | Chị Bão + lửa + nhãn "Ngày 30 tháng 3" |
| **F5 · Ảnh chụp màn hình + phản ứng** | 1 khung. Nửa trên là screenshot thật, nửa dưới là mặt nhân vật | Thông báo lỗi, email, tin nhắn sếp | `503 Service Unavailable` + mặt Gàn |
| **F6 · Nhãn dán lên nhân vật** | 1 khung. Nhân vật có sẵn, dán nhãn lên từng người | Ẩn dụ vai trò trong một tình huống | Dán nhãn lên nhóm AI đang xúm quanh 1 cái bug |
| **F7 · Trước / Sau** | 2 khung, cùng nhân vật, cách nhau vài phút | Hậu quả đến nhanh | 23:55 ăn mừng / 23:58 màn hình đỏ |

**Quy tắc chung cho mọi format:**

- **Cụ thể mới buồn cười.** "Deadline gấp" không ai cười. "23:47 ngày 30/3, hệ thống báo bảo trì" thì cười. Luôn dùng giờ thật, mã lỗi thật, tên nghiệp vụ thật.
- Nhãn chữ ≤ 8 từ. Không nhét đoạn văn vào bong bóng thoại.
- Nếu phải đọc khung 1 mới hiểu khung 2 → chấp nhận được. Nếu phải đọc khung 1, 2, 3 → sai format, cắt lại.

---

## 4. PIPELINE TỰ ĐỘNG HÓA

### 4.1. Sơ đồ

```
[1] THU ──→ [2] LỌC ──→ [3] DỊCH ──→ [4] VẼ ──→ [5] DUYỆT ──→ [6] ĐĂNG ──→ [7] HỌC
 máy         máy          máy          máy        NGƯỜI         bán tự động   người
                                                     │                          │
                                                     └── trả về [3] nếu rớt ────┘
                                                                                 │
                                        chỉnh rubric bước [2] ────────────────────┘
```

### 4.2. Chi tiết từng bước

#### Bước 1 — THU (quét tín hiệu) · *máy · hằng ngày 07:00*

| Mục | Nội dung |
|---|---|
| **Input** | — |
| **Nguồn** | Market Radar MCP (`market_radar_list_articles`, radar `marketing-kd` + `ke-toan`) · Group Insights MCP (`group_list_clusters` → pain point cộng đồng) · trạng thái hạ tầng toàn cầu · Facebook/TikTok trend · lịch mùa vụ |
| **Output** | Bảng tín hiệu thô: `nguồn · tiêu đề · ngày · tóm tắt 1 câu · link` |
| **Ràng buộc** | Chỉ tin **trong 14 ngày**. Tin cũ hơn loại. |

#### Bước 2 — LỌC (chấm điểm) · *máy · ngay sau bước 1*

Mỗi tín hiệu chấm 5 tiêu chí, thang 1–5:

| Tiêu chí | Câu hỏi |
|---|---|
| **Độ nóng** | Người ta đang nói về nó chưa? |
| **Độ chạm** | Dân văn phòng/kế toán/dev có tự nhận ra mình không? |
| **Độ hợp trục** | Map được vào 1 trong 3 trục mà không phải gồng? |
| **Tuổi thọ** | Còn nóng sau 48h không? |
| **Độ an toàn** | Có dính nhóm ⛔ ở mục 3.3 không? *(dính = loại thẳng, bất kể điểm khác)* |

**Ngưỡng:** tổng ≥ 16/20 → vào hàng đợi sản xuất. 12–15 → lưu kho ý tưởng. < 12 → bỏ.
**Output:** top 3 tín hiệu/ngày, xếp theo điểm.

#### Bước 3 — DỊCH (trend → kịch bản) · *máy · 3 phương án/tín hiệu*

Prompt template:

```
Bạn viết kịch bản comic cho fanpage "Ăn Nằm Với AI" của Mắt Bão.

TÍN HIỆU: {tóm tắt tín hiệu}
TRỤC: {AI công việc | kế toán | hosting}
DÀN NHÂN VẬT BẮT BUỘC: {dán mục 2.1 + 2.2}
GLOSSARY: {dán mục 3.2 của trục tương ứng}

FORMAT MEME BẮT BUỘC: {chọn 1 từ thư viện mục 3.4}

YÊU CẦU:
- TỐI ĐA 2 KHUNG. Ưu tiên 1 khung. KHÔNG kể chuyện, KHÔNG dẫn dắt.
- Người xem phải hiểu trong 1,5 giây. Nếu phải đọc theo thứ tự mới hiểu → sai format.
- Tình huống phải CỤ THỂ, có thật: giờ giấc chính xác, thông báo lỗi có thật,
  tên nghiệp vụ có thật, con số có thật. Cụ thể mới buồn cười. Chung chung là chết.
- Có ít nhất 1 nhân vật cố định (Gàn/Gèn/chị Bão).
- Tính cách AI đúng bảng 2.2, không hoán đổi.
- Chữ trên ảnh: nhãn ngắn, ≤ 8 từ mỗi nhãn. Không viết đoạn văn vào bong bóng thoại.
- Caption ≤ 2 câu, KHÔNG kể lại nội dung tranh, không giải thích trò đùa.
- CTA mềm: chỉ thêm nếu tôi ghi CTA=có.
- KHÔNG: chê chất lượng sản phẩm AI, so sánh hơn kém, đụng bê bối thật, lộ mặt sếp.

Trả về 3 phương án dùng 3 format meme KHÁC NHAU.
```

**Output:** 3 kịch bản/tín hiệu, ghi vào hàng đợi.

#### Bước 4 — VẼ (dựng ảnh) · *máy*

- Ghép: `style chung (2.4)` + `mô tả nhân vật xuất hiện` + `mô tả từng khung từ bước 3`.
- Tool tạo ảnh: dùng connector sinh ảnh sẵn có (`generate_image`).
- Sinh **2 biến thể/kịch bản** để bước 5 chọn.
- Chèn watermark đúng brand trước khi đưa duyệt.

**Điểm yếu đã biết:** thoại tiếng Việt trong ảnh dễ sai chính tả/dấu. **Chốt:** sinh ảnh **không chữ**, gắn bong bóng thoại ở khâu hậu kỳ bằng template Canva/Figma. Đây là bước thủ công còn lại, ~5 phút/bài.

#### Bước 5 — DUYỆT · *NGƯỜI · 1 người, SLA 4h*

Chạy checklist Phần 5. Ba kết cục: **Duyệt** → bước 6 · **Sửa thoại** → hậu kỳ lại · **Rớt** → trả về bước 3 kèm lý do (lý do được ghi lại để chỉnh prompt).

> Bước này KHÔNG được bỏ. Rủi ro thương hiệu nằm gần như trọn ở đây.

#### Bước 6 — ĐĂNG & SEEDING · *bán tự động*

- Khung giờ: **11:30–12:30** hoặc **21:00–22:30**. Bài P0 đăng ngay bất kể giờ.
- Kèm sẵn **3 comment seeding** viết từ bước 3, đăng trong 15 phút đầu.
- Page **tự rep comment** trong 60 phút đầu — đây là phần v2 bỏ trống và là lý do lớn khiến tương tác chết.

#### Bước 7 — HỌC · *người · thứ 2 hằng tuần*

- Kéo số: reach, share, comment, save của 7 bài tuần trước.
- Xếp hạng theo **share + comment** (không dùng like).
- Ghi kết luận vào knowledge base (`knowledge_remember`): *trục nào ăn · nhân vật nào ăn · format mấy khung ăn · giờ nào ăn*.
- **Chỉnh rubric bước 2** theo kết luận. Đây là vòng lặp làm engine khôn dần.

### 4.3. Nhịp tuần

| Thứ | Việc | Ai |
|---|---|---|
| T2 sáng | Bước 7 (đọc số tuần trước) + chỉnh rubric | Người |
| T2–T6 07:00 | Bước 1–4 tự động, ra hàng đợi | Máy |
| Hằng ngày 09:00 | Bước 5 duyệt batch cho 1–2 ngày tới | Người (≤30') |
| Hằng ngày 11:30/21:00 | Bước 6 đăng + seeding | Bán tự động |
| Bất kỳ lúc nào | Tín hiệu P0 → chen ngang toàn bộ hàng đợi | Người quyết |

### 4.4. Mức tự động hóa theo giai đoạn

| Giai đoạn | Phạm vi | Mục tiêu |
|---|---|---|
| **G1 (tháng 1–2)** | Bước 1–3 tự động. Vẽ + đăng thủ công. | Kiểm chứng chất lượng kịch bản trước khi đổ tiền vào ảnh |
| **G2 (tháng 3–4)** | Thêm bước 4 tự động, hậu kỳ template hóa | Giảm còn ~15 phút chạm tay/bài |
| **G3 (tháng 5+)** | Thêm bước 6 lên lịch tự động + báo cáo bước 7 tự động | 1 người vận hành, chỉ còn duyệt |

**Không tự động hóa bước 5.** Không bao giờ.

---

## 5. CHECKLIST TRƯỚC KHI ĐĂNG

- [ ] Có **ít nhất 1 nhân vật cố định** (Gàn / Gèn / chị Bão) — kể cả meme chữ.
- [ ] Tính cách AI **khớp bảng 2.2** — không hoán đổi.
- [ ] **Tối đa 2 khung.** Ba khung trở lên = trả về sửa, không tranh cãi.
- [ ] Che caption đi vẫn hiểu được trò đùa trong 1,5 giây.
- [ ] Tình huống **cụ thể**: có giờ thật / mã lỗi thật / tên nghiệp vụ thật / con số thật.
- [ ] Nhãn chữ trên ảnh ≤ 8 từ mỗi nhãn.
- [ ] Caption ≤ 2 câu. Không kể lại tranh, không giải thích trò đùa.
- [ ] Thoại tiếng Việt đúng chính tả, đủ dấu (lỗi hay gặp nhất ở ảnh AI).
- [ ] Watermark đúng góc, đúng brand (`MATBAO` / `MATBAO INVOICE`).
- [ ] CTA mềm chỉ ở **≤ 1/3 số bài**.
- [ ] Không chê chất lượng sản phẩm AI, không so sánh hơn kém, không đụng bê bối thật của hãng.
- [ ] Không dính nhóm ⛔ mục 3.3.
- [ ] Sếp không lộ mặt.
- [ ] Đã có sẵn **3 comment seeding**.

**Nếu nghi ngờ một bài có rủi ro thương hiệu → không đăng, chuyển sang bài kế trong hàng đợi.** Hàng đợi luôn có sẵn ≥ 5 bài để không bao giờ phải đăng bài mình lăn tăn.

---

## 6. ĐO LƯỜNG

| Giai đoạn | Chỉ số chính | Mốc tham chiếu |
|---|---|---|
| Tháng 1–3 | **Share + comment/bài** | Có ≥ 1 bài/tuần vượt 3× median của page |
| Tháng 4–6 | Follower tăng trưởng tự nhiên + tỉ lệ bài "ăn" | ≥ 30% số bài trên median |
| Tháng 7+ | Bắt đầu đo lead từ CTA mềm | — |

**Không dùng like làm chỉ số chính.** Like là chỉ số rẻ nhất và nói ít nhất về việc nội dung có chạm hay không.

---

## PHỤ LỤC — 12 MẪU MEME CHUẨN

> Bộ mẫu cho bước 3: dùng làm few-shot example khi chạy prompt DỊCH.
> Mỗi mẫu ghi rõ **format** (F1–F7, mục 3.4) và **số khung**. Không mẫu nào quá 2 khung.
> Chữ in `NHÃN` là text overlay dán lên ảnh, không phải bong bóng thoại.

### Trục kế toán & hóa đơn điện tử

**#1 · F1 Hai nút bấm · 1 khung**

Chị Bão đổ mồ hôi hột, hai tay lơ lửng giữa hai nút đỏ to.
Nút trái: `XUẤT HÓA ĐƠN HÔM NAY` · Nút phải: `CHỜ SẾP DUYỆT ĐƠN GIÁ`
Góc trên: `30/6 — 16:45`

**Caption:** Nút nào bấm cũng sai. Đó là nghề. 🫠

---

**#2 · F5 Screenshot + phản ứng · 1 khung**

Nửa trên: ảnh màn hình `Hệ thống đang bảo trì. Vui lòng quay lại sau.` — đồng hồ máy tính `23:47`.
Nửa dưới: mặt chị Bão nhìn thẳng vào người xem, không biểu cảm, mắt thâm.
Nhãn góc: `NGÀY CUỐI CÙNG CỦA KỲ KÊ KHAI`

**Caption:** Không hoảng. Hoảng là cảm xúc của người còn hy vọng. 🙃
**CTA mềm:** Xuất hóa đơn không phụ thuộc phút chót — MATBAO INVOICE.

---

**#3 · F4 Cháy nhà vẫn ngồi · 1 khung**

Phòng kế toán đang cháy. Chị Bão ngồi giữa, ly trà trên tay, mỉm cười nhẹ.
Trên bàn: chồng hóa đơn, màn hình đỏ. Nhãn dán lên lửa: `HÓA ĐƠN SAI MST ĐÃ KÊ KHAI`
Bong bóng nhỏ: *"Điều chỉnh được mà."*

**Caption:** Điều chỉnh được. Chỉ là phải làm 40 cái. 🔥

---

**#4 · F6 Nhãn dán · 1 khung**

Chị Bão ôm đầu trước màn hình. Ba nhân vật AI xúm quanh, mỗi người dán một nhãn:
GPT — `KHEN CHỊ CẨN THẬN` · Claude — `KHUYÊN CHỊ HỎI CHUYÊN GIA` · Copilot — `LẬP FILE EXCEL THEO DÕI`
Nhãn trên đầu chị Bão: `CHỈ CẦN BIẾT SỐ TIỀN GIẢM TRỪ`

**Caption:** Ba trợ lý. Không ai trả lời câu hỏi. 😌

---

**#5 · F7 Trước / Sau · 2 khung**

**[1]** Chị Bão thanh thản đóng laptop. Nhãn: `2:00 SÁNG — XONG HẾT VIỆC RỒI`
**[2]** Cùng góc máy, chị Bão nằm giường mắt mở trừng trừng nhìn trần nhà. Nhãn: `2:04 SÁNG`

**Caption:** Ngủ được 4 phút. Kỷ lục mới. 🙂

---

### Trục AI trong công việc

**#6 · F3 Chê / Chọn · 2 khung dọc**

**[1]** Gàn xua tay, mặt chê. Nhãn: `TỰ VIẾT EMAIL — 6 PHÚT`
**[2]** Gàn gật gù, chỉ tay, mặt khoái. Nhãn: `PROMPT LẠI 9 LẦN CHO AI VIẾT — 41 PHÚT`

**Caption:** Nhưng mà nó đỡ mệt đầu hơn. Chắc vậy. 🙂

---

**#7 · F2 Kỳ vọng vs Thực tế · 2 khung**

**[1]** Gàn thảnh thơi gác chân, laptop mở. Nhãn: `DÙNG AI ĐỂ TIẾT KIỆM 2 TIẾNG VIẾT`
**[2]** Cùng góc máy, Gàn cắm mặt vào màn hình đầy chữ, Gèn đứng sau cầm sổ. Nhãn: `3 TIẾNG ĐỌC LẠI XEM NÓ BỊA CHỖ NÀO`

**Caption:** Tiết kiệm thời gian, chỉ là không phải của bạn. 🎁

---

**#8 · F1 Hai nút bấm · 1 khung**

Gàn đổ mồ hôi, hai tay lơ lửng.
Nút trái: `NÓI THẬT LÀ AI VIẾT` · Nút phải: `NHẬN LÀ MÌNH VIẾT RỒI CẦU TRỜI SẾP KHÔNG HỎI SÂU`
Phía sau: bóng lưng Sếp cầm bản in.

**Caption:** Ai cũng biết đáp án đúng. Không ai bấm. 😬

---

**#9 · F6 Nhãn dán · 1 khung**

Một cái bug nhỏ nằm giữa bàn. Bốn AI xúm quanh, mỗi người một nhãn:
GPT — `CÁCH ANH ĐẶT VẤN ĐỀ RẤT HAY!` · Gemini — `EM SỬA FILE KHÁC RỒI` ·
Claude — `EM XIN PHÉP HỎI THÊM 3 CÂU` · Copilot — `EM LẬP FILE THEO DÕI BUG`
Gèn đứng ngoài, nhãn: `NGƯỜI DUY NHẤT MỞ LOG RA XEM`

**Caption:** Bốn trợ lý AI. Một người sửa. 🔧

---

**#10 · F5 Screenshot + phản ứng · 1 khung**

Nửa trên: đoạn chat — Gàn: *"Code này chạy được không?"* → GPT: *"Code sạch lắm anh! Chạy tốt, anh cứ demo tự tin."*
Nửa dưới: mặt Gàn nhìn màn hình đỏ lỗi trước phòng họp. Nhãn: `8:59 SÁNG HÔM SAU`

**Caption:** Nó tin bạn hơn cả bạn tin bạn. Đó mới là vấn đề. 🫠

---

### Trục hosting / domain / dev

**#11 · F7 Trước / Sau · 2 khung**

**[1]** Gàn giơ hai tay ăn mừng trước dashboard đơn hàng nhảy liên tục. Nhãn: `11.11 — 23:55`
**[2]** Cùng góc máy, Gàn đơ người. Màn hình: `503 Service Unavailable`. Nhãn: `23:58`

**Caption:** Mùa Sale không giết web của bạn. Cái gói hosting từ 2021 mới giết. 🕯️
**CTA mềm:** Web chạy Mắt Bão khỏi lo cảnh này 😌

---

**#12 · F5 Screenshot + phản ứng · 1 khung**

Nửa trên: hộp thư — 12 email cùng tiêu đề `[Nhắc lần 4] Tên miền của bạn sắp hết hạn`, tất cả **chưa đọc**. Email thứ 13: `Tên miền đã hết hạn.`
Nửa dưới: mặt Gàn, 2h sáng, ánh màn hình hắt lên.

**Caption:** Nó nhắc 12 lần. Mình đọc lần thứ 13. ⏰
**CTA mềm:** Bật tự động gia hạn đi cho đỡ mất ngủ.
