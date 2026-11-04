# Hợp đồng API Trend chủ động

Mọi endpoint cần đăng nhập. `PUT settings`, `POST run`, `POST send-test`, `POST outbox/:id/resolve` chỉ admin; quyền admin kiểm lại trong DB. Lỗi có `{ code, error }`. Mặc định workflow và gửi Teams tắt. Webhook riêng Outlier, không dùng ReportApp.

## Cài đặt và trạng thái
- `GET /api/trend-workflow/settings`: `{ enabled, teamsEnabled, targets:[{brandId,fanpageId}], provider:"gemini_search"|"rss", model, maxTrends, maxModelCalls, maxModelCallsDaily, maxOutputTokens, modelTimeoutMs, publicBaseUrl, webhookConfigured, keyConfigured, apifyEnabled:false, schedule }`. Không trả URL webhook.
- `PUT /api/trend-workflow/settings`: patch các trường trên. `teamsWebhookUrl` write-only; chuỗi rỗng để xoá. Lỗi: `INVALID_TARGET`, `INVALID_WEBHOOK`, `BASE_URL_REQUIRED`.
- `GET /api/trend-workflow/status`: `{ settings, lastSlot, runs, outbox }`. Outbox chỉ trả trạng thái, attempts, lỗi cuối và thời điểm; không payload/webhook.
- `GET /api/trend-workflow/runs/:id`: chi tiết run, gồm `status`, `modelCalls`, `maxModelCalls`, `error`, thời điểm. `400 INVALID_ID`, `404 RUN_NOT_FOUND`.
- `GET /api/trend-workflow/targets`: `{ brands:[{id,name}], fanpages:[{id,brandId,pageName,platform,pageUrl}] }`.

## Trend và bản nháp
- `GET /api/trend-workflow/trends?limit=30`: `{items:[]}`; item gồm `id,title,status,checkpoint,eventKey,duplicateOf,brief,error,deconstructionId,attempts,lastAttemptSlot,drafts[]`.
- `brief`: `{ title, traffic, provider, confidence:"sourced"|"unverified", claims:[{text,urls}], sources:[{title,url}], summary, sensitive, needsReview, label, reason }`.
- `drafts[]`: `{ remakeId, brandId, fanpageId, pageName, angle, status, href:"/remakes?remakeId=<id>" }`. Frontend đọc `remakeId`, gọi `GET /api/remakes/:id` và mở đúng bản viết.
- Item: `pending`, `researched`, `brief_only`, `done`, `duplicate`, `excluded`, `error`, `budget_exhausted`.
- Run: `pending`, `running`, `done`, `partial`, `error`. Còn item chưa xong/lỗi thì `partial`, không ghi `done`. Run cũ được tính lại sau khi retry.
- Item lỗi tự thử lại **ở mốc kế tiếp**, tối đa **3 attempts tổng cộng**. Không chạy lại item `done/brief_only/duplicate/excluded`; bản nháp page đã `ready` được giữ nguyên. Item gián đoạn (`pending/researched`) có thể tiếp tục ngay khi lấy lại lease. Bản nháp + concept có checkpoint theo page, không vẽ ảnh, không đăng bài.
- Brief chỉ chứa khẳng định có URL grounding; thiếu nguồn ghi chưa xác minh. Không có Facebook vẫn tạo brief. Trend nhạy cảm chặn trước tìm kiếm, không truy footage, không nêu danh tính.

## Chạy thử nền và thẻ Teams
- `POST /api/trend-workflow/run` body `{ "dryRun": true }`: **202** `{runId,status:"pending"}` sau khi lưu run, không chờ model. Poll `GET /api/trend-workflow/runs/:id` (hoặc `/status`). `400 DRY_RUN_REQUIRED` nếu không true. Đang có lease khác: run đã nhận chuyển `error`.
- **Dry-run vẫn lưu deconstruction và remake THẬT nếu có page đích**, dùng chi phí model thật theo trần; chỉ không enqueue/gửi Teams. Không tự xoá dữ liệu đã tạo.
- `GET /api/trend-workflow/trends/:id/card`: `{ payload, sent:false }`. Chỉ preview JSON, không gửi. Page chưa có bản nháp hoặc thiếu URL thì không có nút.
- `POST /api/trend-workflow/trends/:id/send-test` body `{ "confirm": true, "idempotencyKey":"8-80 ký tự a-z A-Z 0-9 _ -" }`. Phải có `publicBaseUrl`, webhook và ít nhất một draft `ready` để có nút mở đúng bản nháp.
- Lỗi: `CONFIRM_REQUIRED`, `BASE_URL_REQUIRED` (409), `RATE_LIMITED` (429), `DRAFT_REQUIRED` (409), `WEBHOOK_NOT_CONFIGURED`, `SENSITIVE_TREND`, `BRIEF_NOT_FOUND`, `INVALID_ID`.
- Tối đa **3 yêu cầu gửi thử/gửi lại mỗi phút mỗi người**, DB-backed, dùng chung nhiều replica và giữ qua restart. Yêu cầu hợp lệ về confirm có thể tiêu quota dù bị từ chối ở bước kiểm tra item/webhook sau đó. Idempotency key dùng lại không gửi lại một outbox đã claim/accepted/unknown.
- Outbox: `pending`, `sending`, `retry`, `accepted`, `failed`, `unknown`, `resolved`. Claim bằng CAS nên hai worker không cùng gửi một outbox. HTTP 429/5xx retry tối đa 5 attempts, exponential backoff 30 giây đến 1 giờ; lỗi mạng/timeout là `unknown`, không tự retry. `accepted` chỉ nghĩa Teams đã nhận, không xác nhận đã hiển thị.
- `sending` quá **2 phút** hoặc bản ghi cũ không có `sendingAt` được chuyển `unknown` khi drain/status. Admin phải kiểm tra Teams.
- `POST /api/trend-workflow/outbox/:id/resolve`: `{ "action":"resolved", "confirm":true }` để xác nhận đã kiểm tra/xử lý; hoặc `{ "action":"resend", "confirm":true, "acknowledgeDuplicateRisk":true }` để gửi lại có chủ đích. Chỉ nhận outbox `unknown`; nếu không: `409 OUTBOX_NOT_UNKNOWN`. Lưu `resolvedBy/resolvedAt`. Gửi lại có thể trùng, cần quota và URL Outlier; không tự xử lý `unknown`.

## Trần tài nguyên và an toàn
- Lịch 08,10,12,14,16,18,20,22 giờ Việt Nam; poll 5 phút; chỉ bù mốc gần nhất, không quét mọi mốc đã lỡ.
- Chung một bộ đếm cho research, structure, viết nháp từng page và từng attempt concept/fallback model. Reserve DB trước request, tính cả request lỗi; SDK tự retry bị tắt. Trần mỗi run mặc định 12 (tối đa 50), trong ngày VN 60 (tối đa 200). Retry item cũ tính vào ngân sách run hiện tại.
- `maxOutputTokens` mặc định 2048, tối đa 4096; `modelTimeoutMs` mặc định 45000, phạm vi 1000–90000 ms, áp vào mỗi request. Quá trần dừng các item còn lại thành `budget_exhausted`, run `partial`. Timeout từng request là lỗi item, không tự fallback vì timeout.
- Lease 20 phút, heartbeat 1 phút. Generation tăng khi takeover; không xoá lease khi release. Kiểm token + generation + expiry dưới row lock trong cùng transaction ngay trước ghi deconstruction/remake/draft/concept/outbox/checkpoint/counter. Heartbeat lỗi được log và dừng ghi. Owner cũ không ghi trạng thái sau khi mất lease; run có thể còn `running` cho đến lượt phục hồi.
- RSS tối đa 1 MiB (đếm body streamed, kể cả không có/sai Content-Length), timeout 15 giây. Nhân vật/concept và brief chỉ lấy page đích, không dùng page chính hay gộp tất cả page.

## Migration và giới hạn còn lại
- Giữ nguyên migration **0040** nền; thêm **0041_trend_workflow_safety**: generation lease, attempts/lastAttemptSlot item, sendingAt/resolvedBy/resolvedAt outbox. Chưa chạy migration lên DB nào trong lượt sửa này.
- Rollback 0041: dừng worker trước, deploy lại code tương thích 0040 rồi bỏ các cột mới (cần backup metadata thử lại/phân giải trước; không drop 5 bảng/volume). Thay đổi chỉ additive nên có thể giữ cột khi rollback code.
- Đây là **trần request/output/thời gian**, không phải cam kết trần tiền VND/USD: Google grounding, input/thinking tokens và bảng giá nhà cung cấp không được quy đổi hoá đơn. Không thống kê token usage thực tế. Không fallback nếu model khác chỉ vì quota/timeout; fallback tên model chỉ khi có GEMINI_TEXT_MODEL_FALLBACK và lỗi model không hỗ trợ.
- Một lease điều phối workflow toàn app; outbox có claim riêng. Không bảo đảm exactly-once ở Teams vì webhook không hỗ trợ idempotency phía nhận. Admin xác nhận resend chịu nguy cơ trùng.
- Run nền dùng process hiện tại, không có durable queue riêng. Nếu crash sau 202 trước callback thì cần vận hành chạy lại; scheduler phục hồi checkpoint của run theo lịch khi bật. Dry-run pending bị bỏ dở không tự chạy lại sau restart.
- Giọng nền vẫn dùng hồ sơ thương hiệu vì schema chưa có toneOfVoice riêng page; thêm note/audience/topics/stats và nhân vật đúng page, không bịa dữ liệu thiếu. Việc người dùng tự đề xuất lại concept sau này ngoài workflow vẫn theo luồng remake cũ.
- Test tự động dùng DB adapter mock, không phải PostgreSQL thật; transaction isolation/SQL migration và cạnh tranh giữa nhiều process cần kiểm trên staging chuẩn trước bật lịch. Không gọi Gemini/Apify thật hay gửi Teams trong test.

## Nghiên cứu bởi Claude qua MCP (từ 2026-11-04)

Mặc định `researchProvider = "claude_mcp"`; `gemini` chỉ là dự phòng và `off` chỉ dùng RSS chưa xác minh. Lịch trong app không gọi model nghiên cứu khi dùng Claude: mỗi mốc 08-22 giờ VN chỉ tạo item `awaiting_research`. Sau 90 phút chưa có kết quả, item dùng tin RSS với nhãn "Claude chưa nghiên cứu — chưa xác minh" (không phải "Đu ngay").

Tool trên `/api/mcp-signals`:

- `trend_queue` (chỉ đọc, `{}`): `{ items: [{ itemId, keyword, traffic, news, createdAt, sensitive, instruction }] }`.
- `trend_submit_research` (cần `signals-edit`): `{ item_id, summary, claims: [{ text, urls }], confidence?, suggestedAngle?, facebookCandidates?: [{ url, reason }] }`, tối đa 12 khẳng định và 5 link Facebook. Server chỉ nhận URL http(s) công khai; thiếu URL nguồn thì chưa xác minh. Link Facebook phải là một bài cụ thể, không phải trang, hồ sơ hay nhóm; trend nhạy cảm bị bỏ toàn bộ link. Chỉ trả `{ itemId, status: "accepted", message }` sau khi transaction đã lưu brief và chuyển item sang `researched`. Việc nộp không cần lease của worker. Nộp lại đúng nội dung đã lưu cũng trả `accepted` mà không ghi thêm; nộp nội dung khác cho item đã xử lý bị từ chối. Nếu worker đang bận, lần gọi nền chỉ dừng và không đánh dấu lượt chạy là lỗi; lịch 5 phút sẽ tiếp tục xử lý item đã lưu.
- `trend_status` (chỉ đọc, `{ item_id }`): trả item (không có input thô hay dữ liệu bài đã lấy) và `drafts`.

Sau khi nộp, Outlier chọn tối đa 1 link và chỉ gọi `fetchPostViaApify(link)` khi `apifyEnabled`, Apify đã cấu hình, còn ngân sách Apify chung, còn `maxApifyPosts` mỗi lượt và `maxApifyPostsDaily` mỗi ngày, trend không nhạy cảm và fencing còn hợp lệ. Apify không bao giờ được dùng để tìm bài. Checkpoint được ghi trước lời gọi; khi retry, Outlier dùng bài đã lưu và không gọi lại lượt bị gián đoạn để tránh tính phí hai lần.

`GET /api/trend-workflow/trends` có thêm `contentPath` (`facebook_post` | `brief_only`), `facebookSourceUrl` và `facebookReason`. Thẻ Teams ghi "Dựng từ bài Facebook" hoặc "Dựng từ tóm tắt tin tức", kèm link gốc và lý do nếu có. Cài đặt mới: `researchProvider`, `apifyEnabled` (mặc định tắt), `maxFacebookPostsPerTrend` (0-1, mặc định 1), `maxApifyPosts` (0-10, mặc định 3), `maxApifyPostsDaily` (0-50, mặc định 10).

## Địa chỉ website (`publicBaseUrl`)
- Khi admin lưu cài đặt mà `publicBaseUrl` đang rỗng, server dùng `OUTLIER_PUBLIC_URL`, rồi `Origin` của chính request lưu (hoặc protocol + Host của request đó). Chỉ nhận http(s); không đọc header `X-Forwarded-*`. Giao diện không còn ô nhập địa chỉ này; nó tự gửi `window.location.origin` nếu đang rỗng.
