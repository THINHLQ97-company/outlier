# Hợp đồng API Trend chủ động

Mọi endpoint cần đăng nhập. `PUT settings`, `POST run`, `POST send-test`, `POST outbox/:id/resolve`, xoá/khôi phục và đọc Thùng rác chỉ người quản trị tính năng; quyền admin kiểm lại trong DB. Lỗi có `{ code, error }`. Mặc định workflow và gửi Teams tắt. Webhook riêng Outlier, không dùng ReportApp.

## Cài đặt và trạng thái
- `GET /api/trend-workflow/settings`: `{ enabled, teamsEnabled, targets:[{brandId,fanpageId}], provider:"gemini_search"|"rss", model, maxTrends, maxModelCalls, maxModelCallsDaily, maxOutputTokens, modelTimeoutMs, publicBaseUrl, webhookConfigured, keyConfigured, apifyEnabled:false, schedule }`. Không trả URL webhook.
- `PUT /api/trend-workflow/settings`: patch các trường trên. `teamsWebhookUrl` write-only; chuỗi rỗng để xoá. Lỗi: `INVALID_TARGET`, `INVALID_WEBHOOK`, `BASE_URL_REQUIRED`.
- `GET /api/trend-workflow/status`: `{ settings, lastSlot, runs, outbox }`. Outbox chỉ trả trạng thái, attempts, lỗi cuối và thời điểm; không payload/webhook.
- `GET /api/trend-workflow/runs/:id`: chi tiết run, gồm `status`, `modelCalls`, `maxModelCalls`, `error`, thời điểm. `400 INVALID_ID`, `404 RUN_NOT_FOUND`.
- `GET /api/trend-workflow/targets`: `{ brands:[{id,name}], fanpages:[{id,brandId,pageName,platform,pageUrl}] }`.

## Trend và bản nháp
- `GET /api/trend-workflow/trends?limit=30`: `{items:[],total,trashTotal}` (mặc định bỏ item đã xoá); item gồm `id,title,status,checkpoint,eventKey,duplicateOf,brief,error,deconstructionId,attempts,lastAttemptSlot,drafts[]`.
- `brief`: `{ title, traffic, provider, confidence:"sourced"|"unverified", claims:[{text,urls}], sources:[{url,title,publisher?,publishedAt?}], summary, sensitive, needsReview, label, reason, decision?, decisionRationale?, pageAngles?, avoid? }`.
- `drafts[]`: `{ remakeId, brandId, fanpageId, pageName, angle, status, href:"/remakes?remakeId=<id>" }`. Frontend đọc `remakeId`, gọi `GET /api/remakes/:id` và mở đúng bản viết.
- Item: `awaiting_research`, `pending`, `researched`, `watch`, `skipped`, `brief_only`, `done`, `duplicate`, `excluded`, `error`, `budget_exhausted`.
- Run: `pending`, `running`, `done`, `partial`, `error`. Còn item chưa xong/lỗi thì `partial`, không ghi `done`. Run cũ được tính lại sau khi retry.
- Item lỗi tự thử lại **ở mốc kế tiếp**, tối đa **3 attempts tổng cộng**. Không chạy lại item `done/brief_only/duplicate/excluded`; bản nháp page đã `ready` được giữ nguyên. Item gián đoạn (`pending/researched`) có thể tiếp tục ngay khi lấy lại lease. Bản nháp + concept có checkpoint theo page, không vẽ ảnh, không đăng bài.
- Brief chỉ chứa khẳng định có URL grounding; thiếu nguồn ghi chưa xác minh. Không có Facebook vẫn tạo brief. Trend nhạy cảm chặn trước tìm kiếm, không truy footage, không nêu danh tính.

## Chạy thử nền và thẻ Teams
- `POST /api/trend-workflow/run` body `{ "dryRun": true }`: **202** `{runId,status:"pending"}` sau khi lưu run, không chờ model. Poll `GET /api/trend-workflow/runs/:id` (hoặc `/status`). `400 DRY_RUN_REQUIRED` nếu không true. Đang có lease khác: run đã nhận chuyển `error`.
- **Dry-run vẫn lưu deconstruction và remake THẬT nếu có page đích**, dùng chi phí model thật theo trần; chỉ không enqueue/gửi Teams. Không tự xoá dữ liệu đã tạo.
- `GET /api/trend-workflow/trends/:id/card`: `{ payload, sent:false }`. Chỉ preview JSON, không gửi; cùng hàm `buildTrendCard` với outbox và gửi thử nên preview = thẻ thật. Thiếu `publicBaseUrl` thì không có nút.

### Mẫu thẻ Teams (gọn, từ 2026-11-04)
Envelope không đổi: `{ type:"message", attachments:[{ contentType:"application/vnd.microsoft.card.adaptive", content:<AdaptiveCard 1.2> }] }`. Nội dung như người trong team nhắn, tổng chữ (kể cả dấu `**` và nhãn nút) < 700 ký tự; vượt thì tự rút gọn dần (góc → lý do → tóm tắt), không bỏ trang nào có góc.

| Khối | Quy tắc |
|---|---|
| Tiêu đề (Large, Bolder) | `Hi team, có trend “<brief.title>” đang lên 🔥` khi `decision=pursue`; khác thì `… đáng để ý`. Tên trend cắt 80 ký tự. |
| Tóm tắt | Tối đa 2 câu đầu của `brief.summary`, ≤ 220 ký tự, cắt theo câu (không câu nào vừa thì cắt theo từ + "…"). Không dán nguyên summary. |
| Vì sao đáng làm | Từ `decisionRationale`, ≤ 160 ký tự, chỉ khi có. |
| Gợi ý theo trang | `• **<tên page>:** <góc ≤120>` cho từng `pageAngles` có góc (tên lấy `pageName`, thiếu thì theo `fanpageId` của draft). Brief cũ không có `pageAngles`: dùng trang đích có draft + góc draft/`suggestedAngle`. Không có góc nào thì bỏ khối. |
| Nguồn (Small, subtle) | `Nguồn: A, B, C` — `publisher`, thiếu thì hostname bỏ `www`; gộp trùng, tối đa 3. Không in URL, không in "Nguồn Claude dẫn". |
| Cảnh báo (Small, Attention) | `Cần duyệt kỹ trước khi đăng` chỉ khi `sensitive` hoặc `confidence = "unverified"`. (`needsReview` luôn true với brief Claude nên không dùng làm điều kiện.) |
| Nút `Action.OpenUrl` | `Xem chi tiết trên Outlier` → `<publicBaseUrl>/trend-radar?item=<itemId>` (trang tự cuộn tới, viền và mở rộng tóm tắt trend đó, bỏ qua bộ lọc ngày/trạng thái cho trend này). `Mở bản nháp` → `/remakes?remakeId=<id>` chỉ với draft `ready`; ≥2 bản thì `Mở bản nháp <tên page>`, tối đa 2 nút bản nháp. |

Đã bỏ: lượng tìm kiếm, nhãn "Nghiên cứu bởi Claude…", "Dựng từ bài Facebook/tóm tắt tin tức", link/lý do bài Facebook gốc, "Bản nháp chưa được duyệt…", "Chỉ có brief…", danh sách nguồn kèm URL. Chữ do Claude viết được bỏ dấu `*`/`` ` ``, link markdown và URL trần trước khi đưa vào thẻ. Thẻ đã nằm trong outbox trước bản này giữ payload cũ (không dựng lại).

```json
{ "type": "AdaptiveCard", "version": "1.2", "body": [
  { "type": "TextBlock", "size": "Large", "weight": "Bolder", "wrap": true, "text": "Hi team, có trend “Tình trạng khẩn cấp” đang lên 🔥" },
  { "type": "TextBlock", "wrap": true, "text": "Thái Lan ban bố tình trạng khẩn cấp tại Bangkok sau mưa lũ kỷ lục, sân bay Don Mueang tạm đóng cửa. Hàng nghìn khách Việt bị ảnh hưởng lịch bay, các hãng đang cho đổi vé miễn phí." },
  { "type": "TextBlock", "wrap": true, "spacing": "Small", "text": "**Vì sao đáng làm:** Người Việt đi Thái rất đông, chủ đề thực dụng (đổi vé, bảo hiểm) dễ gắn góc AI giúp xử lý tình huống." },
  { "type": "TextBlock", "wrap": true, "spacing": "Medium", "text": "**Gợi ý theo trang**" },
  { "type": "TextBlock", "wrap": true, "spacing": "None", "text": "• **Ăn Nằm Với AI:** Gàn nhờ AI lên phương án đổi vé, Gèn thì hỏi AI có được bảo hiểm bồi thường không." },
  { "type": "TextBlock", "wrap": true, "spacing": "Medium", "size": "Small", "isSubtle": true, "text": "Nguồn: VnExpress, nationthailand.com" }
], "actions": [
  { "type": "Action.OpenUrl", "title": "Xem chi tiết trên Outlier", "url": "https://<publicBaseUrl>/trend-radar?item=<itemId>" },
  { "type": "Action.OpenUrl", "title": "Mở bản nháp", "url": "https://<publicBaseUrl>/remakes?remakeId=<remakeId>" }
] }
```
- `POST /api/trend-workflow/trends/:id/send-test` body `{ "confirm": true, "idempotencyKey":"8-80 ký tự a-z A-Z 0-9 _ -" }`. Phải có `publicBaseUrl`, webhook và ít nhất một draft `ready` để có nút mở đúng bản nháp.
- Gửi thử Teams cũng cần `brief.decision = "pursue"`; thiếu thì `409 DECISION_REQUIRED` (cần Claude đánh giá lại). Item thuộc run thử bị chặn `409 DRY_RUN_ONLY`, kể cả owner.
- Lỗi: `CONFIRM_REQUIRED`, `BASE_URL_REQUIRED` (409), `RATE_LIMITED` (429), `DRAFT_REQUIRED` (409), `WEBHOOK_NOT_CONFIGURED`, `SENSITIVE_TREND`, `BRIEF_NOT_FOUND`, `INVALID_ID`.
- Tối đa **3 yêu cầu gửi thử/gửi lại mỗi phút mỗi người**, DB-backed, dùng chung nhiều replica và giữ qua restart. Yêu cầu hợp lệ về confirm có thể tiêu quota dù bị từ chối ở bước kiểm tra item/webhook sau đó. Idempotency key dùng lại không gửi lại một outbox đã claim/accepted/unknown.
- Outbox: `pending`, `sending`, `retry`, `accepted`, `failed`, `unknown`, `resolved`, `cancelled`. Claim bằng CAS nên hai worker không cùng gửi một outbox. HTTP 429/5xx retry tối đa 5 attempts, exponential backoff 30 giây đến 1 giờ; lỗi mạng/timeout là `unknown`, không tự retry. `accepted` chỉ nghĩa Teams đã nhận, không xác nhận đã hiển thị.
- `sending` quá **2 phút** hoặc bản ghi cũ không có `sendingAt` được chuyển `unknown` khi drain/status. Admin phải kiểm tra Teams.
- `POST /api/trend-workflow/outbox/:id/resolve`: `{ "action":"resolved", "confirm":true }` để xác nhận đã kiểm tra/xử lý; hoặc `{ "action":"resend", "confirm":true, "acknowledgeDuplicateRisk":true }` để gửi lại có chủ đích. Chỉ nhận outbox `unknown`; nếu không: `409 OUTBOX_NOT_UNKNOWN`. Lưu `resolvedBy/resolvedAt`. Gửi lại có thể trùng, cần quota và URL Outlier; không tự xử lý `unknown`.

## Trần tài nguyên và an toàn
- (Provider gemini/off) Lịch 08,10,12,14,16,18,20,22 giờ Việt Nam; poll 5 phút; chỉ bù mốc gần nhất, không quét mọi mốc đã lỡ.
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

## Claude điều khiển luồng trend qua MCP (từ 2026-11-04)

Mặc định `researchProvider = "claude_mcp"`. **Claude (Claude Chat Scheduled qua connector `/api/mcp-signals`) là bộ não**: tự lấy gợi ý, tự săn sự kiện trên web/news/Facebook công khai, quyết định trend nào đáng làm. Outlier chỉ lưu trữ và thực thi: Apify lấy đúng bài từ link (không bao giờ dùng để tìm), bóc cấu trúc, viết nháp từng trang, xếp outbox Teams.

### Job nền khi `claude_mcp`
- Poll 5 phút, **không tự đọc RSS** và không còn bị chặn bởi khung 08–22 giờ (Claude quyết định lịch).
- Chỉ chạy khi có việc: item `researched`/`pending`, item lỗi đã qua 2 giờ (giữ giãn cách thử lại cũ, tối đa 3 lần), hoặc item `awaiting_research` quá 90 phút. Tick rỗng không tạo run.
- Fallback 90 phút chỉ lưu brief RSS với nhãn "Claude chưa nghiên cứu — chưa xác minh" rồi chuyển `watch`; không Apify, không model viết, không nháp/outbox khi chưa được Claude quyết định `pursue`.
- **Mọi provider/fallback/retry/dry-run** chỉ được dựng nháp khi `decision = "pursue"`. Brief cũ, RSS, Gemini/off thiếu decision đều chuyển `watch`, không Apify, không model viết, không nháp/outbox. Gemini vẫn có thể nghiên cứu theo lịch nhưng không tự quyết định đáng làm.
- Outbox Teams vẫn được gửi mỗi tick. Provider `gemini`/`off` giữ hành vi cũ (lịch 2 giờ, 08–22, tự đọc RSS).

### Tool MCP
Tool ghi cần quyền `signals-edit` (ngoài `READONLY_TOOLS`); không tool nào cho Claude đổi cài đặt.

- `trend_refresh` (ghi, `{}`) — đọc Google Trends RSS VN, **không gọi model**. Cần tính năng bật; provider khác `claude_mcp` thì không lấy. Cooldown 30 phút (env `TREND_REFRESH_COOLDOWN_MINUTES`): trong cooldown không đọc RSS, trả hàng chờ hiện có. Dùng lease chung `default`; lease bận trả note "Đang có lượt khác chạy, thử lại sau." (không lỗi). Dedupe theo `inputKey`: bỏ từ khoá đã có trong 48 giờ hoặc đang chờ/xử lý. Chỉ tối đa `maxTrends` item mới vào hàng chờ, phần còn lại vẫn trả trong `candidates`.
  Output: `{ fetchedAt, fetched, created, skipped:[{keyword,reason}], items:<như trend_queue.items>, candidates:[{title,approxTraffic,news,…}], maxTrends, note }`.
- `trend_queue` (đọc, `{}`) — `{ lastRefreshAt, enabled, reasonIfEmpty, items:[{ itemId, keyword, traffic, news, createdAt, sensitive, instruction }] }`. `reasonIfEmpty` là `null` khi có item; nếu không: "Trend chủ động đang tắt.", "Chưa lấy trend lần nào — hãy gọi trend_refresh trước.", hoặc "Đã lấy lúc …, mọi trend đều đã được nghiên cứu hoặc bỏ qua…".
- `trend_submit_research` (ghi) — `{ item_id, summary, claims:[{text,urls}], confidence?, suggestedAngle?, facebookCandidates?:[{url,reason}], sources?:[{url,title?,publisher?,publishedAt?}], decision?:"pursue"|"watch"|"skip", rationale?, pageAngles?:[{fanpageId?,pageName?,angle}], avoid?:string[] }`. `avoid` (tối đa 6 ý, mỗi ý ≤300 ký tự) hiển thị ở khối "Cần tránh"; nên nộp `pageAngles` mỗi trang một góc ngắn thay vì một chuỗi `suggestedAngle` dài.
  Output: `{ itemId, status:"accepted", itemStatus:"researched"|"watch"|"skipped", decision, message }`. Chỉ `pursue` mới dispatch xử lý.
- `trend_discover` (ghi) — sự kiện Claude tự tìm, **ngoài** Google Trends: `{ title, keyword?, …giống trend_submit_research trừ item_id }`. Cần ít nhất 1 claim có URL công khai. Tạo item `origin = claude_discover` rồi nộp nghiên cứu trong cùng transaction có fence lease. Dedupe 48 giờ theo từ khoá/sự kiện (kể cả item còn chờ). Trần `maxTrends` discovery mỗi 30 phút.
  Output: giống submit, hoặc `{status:"duplicate", itemId, itemStatus}`, `{status:"capped"}`, `{status:"busy"}`, `{status:"disabled"}`.
- `trend_skip` (ghi) — `{ item_id, reason }`; chỉ với item `awaiting_research`. Item thành `skipped`, không nháp, không Teams. Dedupe có hạn 48 giờ, không có blacklist chủ đề vĩnh viễn.
- `trend_status` (đọc, `{ item_id }`) — item (không có `input`/`facebook` thô) + `decision`, `discoverySource`, `skipReason`, `drafts`.

### Quyết định biên tập ≠ mức bằng chứng
- `confidence` (`sourced`/`unverified`) chỉ nói về nguồn. **`decision` mới là "đáng làm hay không"**: có nguồn không có nghĩa đáng đu.
- `pursue` cần `rationale` và ít nhất một góc (`pageAngles` hoặc `suggestedAngle`); `skip` cần `rationale`; thiếu `decision` thì mặc định `watch`. Giá trị lạ bị từ chối.
- `watch` có thể nộp lại thành `pursue` hoặc `skip`; item đã xử lý thì không bị ghi đè.

### Nguồn (`sources`)
`sources[]` chỉ là metadata cho **đúng URL đã nằm trong `claims`** (sau khi chuẩn hoá); URL không được trích dẫn bị bỏ. `title`/`publisher` cắt độ dài; `publishedAt` chỉ nhận `YYYY-MM-DD` hoặc ISO. Không biết thì bỏ trống, **không bịa**. `brief.sources[] = { url, title, publisher?, publishedAt? }`. Thiếu title thì dùng hostname + đường dẫn. Bản ghi cũ còn title "Nguồn Claude dẫn"; giao diện tự đổi sang hostname.

### Instruction mẫu cho Claude Scheduled
1. Gọi `trend_refresh`. Đọc `items` và `candidates`; đây là **gợi ý**, không phải danh sách bắt buộc. Traffic chỉ là lượng tìm kiếm, không chứng minh viral. `note` báo cooldown hoặc lease bận thì dùng hàng chờ hiện có hoặc gọi `trend_queue`.
2. Chủ động săn sự kiện trên web/tin tức/bài Facebook công khai, dùng Trends để bổ sung và đối chiếu.
3. Với mỗi ứng viên, đánh giá: có mới không (sự kiện định kỳ như xổ số thường không đáng làm, nhưng đừng loại tuyệt đối), có bằng chứng cộng đồng hưởng ứng không, có góc phù hợp từng trang không. Không ép đủ số lượng.
4. Trend từ hàng chờ: `trend_submit_research` với claims có URL thật, `sources` (tiêu đề bài, đơn vị đăng, ngày đăng thật nếu biết), `decision` + `rationale` + `pageAngles`, và link bài Facebook **cụ thể** nếu có. Không có góc thì `trend_skip` (hoặc `decision: "skip"`) kèm lý do.
5. Sự kiện tự tìm ngoài Trends: `trend_discover` với cùng nội dung.
6. Nội dung nhạy cảm: không tìm clip, không tìm danh tính riêng tư, không nhắm người thường; chỉ góc trung tính hoặc bỏ hẳn.
7. Gọi `trend_status` cho item `pursue` để xem bản nháp. Không dùng Apify hay Gemini để tìm.

### Trạng thái item mới
`awaiting_research` (chờ Claude), `watch` (Claude theo dõi, không nháp), `skipped` (Claude bỏ qua). `GET /trends` thêm `decision`, `discoverySource:"google_trends"|"claude"` và `skipReason` (với item `skipped` thì `error = null`). `GET /status` thêm `settings.researchProvider`, `settings.hasTargets`, `lastRefreshAt`, `refreshedBy:"Claude"|"chạy thử"|null`. `POST /run {dryRun:true}` khi `claude_mcp` gọi cùng logic với `trend_refresh` (không model, không Teams) và trả **200** `{ status:"refreshed", runId:null, …output trend_refresh }`; provider khác vẫn trả 202 như cũ. Lượt refresh từ nút chạy thử được lưu `dryRun:true` bền trong DB; submit bảo toàn flag và worker đọc flag từ run dù caller quên truyền. Không được promote sang lượt thật; không enqueue/gửi Teams. Cooldown/dedupe lượt thử tách khỏi lượt thật.
- Mốc lấy trend gần nhất lưu ở dòng `trend_workflow_lease` key `trend-rss-refresh` (lượt thử: `trend-rss-refresh-dry`) (`expiresAt` = thời điểm, `token` = nguồn). **Không có migration mới.**

Sau khi nộp, Outlier chọn tối đa 1 link và chỉ gọi `fetchPostViaApify(link)` khi `apifyEnabled`, Apify đã cấu hình, còn ngân sách Apify chung, còn `maxApifyPosts` mỗi lượt và `maxApifyPostsDaily` mỗi ngày, trend không nhạy cảm và fencing còn hợp lệ. Apify không bao giờ được dùng để tìm bài. Checkpoint được ghi trước lời gọi; khi retry, Outlier dùng bài đã lưu và không gọi lại lượt bị gián đoạn để tránh tính phí hai lần.

`GET /api/trend-workflow/trends` có thêm `contentPath` (`facebook_post` | `brief_only`), `facebookSourceUrl` và `facebookReason`. Đường dựng (bài Facebook/tóm tắt tin) chỉ hiện trên trang Trend chủ động, không còn in trong thẻ Teams. Cài đặt mới: `researchProvider`, `apifyEnabled` (mặc định tắt), `maxFacebookPostsPerTrend` (0-1, mặc định 1), `maxApifyPosts` (0-10, mặc định 3), `maxApifyPostsDaily` (0-50, mặc định 10).

## Địa chỉ website (`publicBaseUrl`)
- Khi admin lưu cài đặt mà `publicBaseUrl` đang rỗng, server dùng `OUTLIER_PUBLIC_URL`, rồi `Origin` của chính request lưu (hoặc protocol + Host của request đó). Chỉ nhận http(s); không đọc header `X-Forwarded-*`. Giao diện không còn ô nhập địa chỉ này; nó tự gửi `window.location.origin` nếu đang rỗng.

## Quyền cài đặt Trend chủ động

Trang xem `/trend-radar` dành cho người đã đăng nhập; nút Cài đặt dẫn tới `/trend-radar/settings` chỉ xuất hiện khi `canConfigure` trong status là true. Vào trực tiếp trang cài đặt khi không có quyền sẽ thấy thông báo từ chối.

Các endpoint `GET /settings`, `PUT /settings`, `POST /run`, `POST /trends/:id/send-test`, `POST /outbox/:id/resolve` chỉ cho phép user đang hoạt động, có role admin và email trong bảng users thuộc danh sách `TREND_WORKFLOW_ADMIN_EMAILS` (phân tách bằng dấu phẩy, không phân biệt hoa thường, bỏ khoảng trắng). Khi biến trống, mặc định chỉ có `lamquangthinh3006@gmail.com`. Tài khoản không có email trong bảng users, kể cả tài khoản mật khẩu, không có quyền; username không thay thế email. Status chỉ trả trạng thái bật, lần dò và cờ quyền, không trả cấu hình đầy đủ. Webhook luôn chỉ ghi, không trả URL. Quyền MCP không thay đổi.

## Thùng rác và tự dọn (xoá mềm, từ 2026-11-04)

Chỉ có **xoá mềm**: không endpoint, job hay nút nào xoá vĩnh viễn trend item, bản nháp, remake hay deconstruction. Mọi thao tác "xoá" chỉ chuyển item vào Thùng rác và khôi phục được.

- Migration **0044_grey_hulk** (chỉ thêm cột, không đổi dữ liệu cũ) trên `trend_workflow_items`: `deleted_at timestamptz` (null = chưa xoá), `deleted_by text` (username hoặc `system`), `delete_reason text` (`manual` | `auto_skipped` | `auto_stale`). Rollback: deploy lại code trước bản này; cột có thể giữ nguyên (code cũ bỏ qua). Nếu cần bỏ cột thì xoá mềm mất hiệu lực và item trong Thùng rác hiện lại.
- `POST /api/trend-workflow/trends/delete` body `{ ids: string[] }` (1–200 UUID, trùng được gộp) → `{ count }` số item vừa chuyển. Item đã ở Thùng rác không tính lại. Outbox Teams `pending`/`retry`/`sending` chưa gửi của item chuyển `cancelled` (không xoá dòng).
- `POST /api/trend-workflow/trends/restore` body `{ ids }` → `{ count }`. Khôi phục **không** bật lại outbox đã huỷ.
- Hai endpoint trên và `GET /api/trend-workflow/trends?trash=1` chỉ cho người quản trị tính năng (cùng điều kiện các endpoint cài đặt); user thường `403`. Lỗi `400 INVALID_IDS`.
- `GET /api/trend-workflow/trends` thêm `total`, `trashTotal` (0 với user thường) và mặc định bỏ item đã xoá; `?trash=1` trả item đã xoá, sắp theo `deletedAt` mới nhất. Hỗ trợ `limit` (1–100) và `offset` (mặc định 0); UI đọc các trang để không bỏ sót trend cũ khi chọn nhiều. Item kèm `deletedAt`, `deletedBy`, `deleteReason`. `GET /trends/:id/card` của item đã xoá trả 404. `GET /status` thêm `settings.skippedRetentionDays` để giao diện ghi lý do.
- MCP: `trend_queue`, `trend_status`, `trend_skip`, `trend_submit_research` bỏ qua item đã xoá. **Dedupe 48 giờ của `trend_refresh`/`trend_discover` vẫn tính item đã xoá**, nên trend vừa xoá không bị kéo lại ngay.
- Worker: không chọn item đã xoá (không Apify, model, nháp, outbox). Item bị xoá giữa chừng: mỗi bước ghi của item (fence trong transaction) khoá dòng item và kiểm `deleted_at`; đã xoá thì dừng item đó, không ghi deconstruction/remake/draft/outbox, không đánh lỗi. Model call đã chạy dở vẫn có thể tốn phí nhưng kết quả không được lưu. Drain outbox khoá dòng item trước khi gửi; item đã xoá thì outbox thành `cancelled`.
- Bản nháp remake đã tạo giữ nguyên, vẫn mở được qua `/remakes?remakeId=`.

### Tự dọn vào Thùng rác
Chạy trong tick nền 5 phút nhưng có cổng theo giờ (`trend_workflow_lease` key `trend-cleanup`), nên tối đa **1 lượt/giờ** dù nhiều replica; tối đa **200 item/lượt**; lỗi tự dọn không chặn workflow. Chạy cả khi Trend chủ động tắt (chỉ phụ thuộc `autoCleanup`).
- `auto_skipped`: `status` ∈ `skipped`/`excluded`/`duplicate` (decision=skip luôn được lưu thành `skipped`) và `updatedAt` cũ hơn `skippedRetentionDays`.
- `auto_stale`: không có bản nháp, `createdAt` cũ hơn `staleRetentionDays`, và không đang xử lý: `watch`/`skipped`/`excluded`/`duplicate`/`done`/`brief_only`, hoặc `awaiting_research`/`error`/`budget_exhausted` đã hết lượt thử (`attempts ≥ 3`). `pending`/`researched` không bao giờ tự dọn.
- Item có bất kỳ dòng `trend_workflow_drafts` nào **không** tự dọn.
- Cài đặt (`GET/PUT /settings`): `autoCleanup` (mặc định `true`), `skippedRetentionDays` (mặc định 7, nguyên 1–90), `staleRetentionDays` (mặc định 30, nguyên 7–365). Ngoài khoảng/không phải số nguyên → `400 INVALID_RETENTION`.
