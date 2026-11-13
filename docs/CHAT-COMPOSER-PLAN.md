# Kế hoạch module Dựng đoạn chat

**Dự án:** Outlier (`share-projects/fanpage-content-create`)
**Định hướng:** công cụ nội bộ cho team Content
**Trạng thái:** kế hoạch đề xuất
**Cập nhật:** 2026-11-13

## 1. Mục tiêu

Team Content hiện có thể phải dùng hai tài khoản Messenger/Zalo thật, tự nhắn qua lại,
đổi thiết bị hoặc tài khoản, rồi chụp màn hình để tạo content dạng hội thoại. Cách này
chậm, khó sửa, khó lặp lại và phụ thuộc vào tài khoản thật.

Module **Dựng đoạn chat** thay thế luồng đó bằng một trình soạn thảo hội thoại trực tiếp
trong Outlier:

1. Tạo cuộc trò chuyện mockup.
2. Tạo hai hoặc nhiều nhân vật.
3. Soạn toàn bộ tin nhắn trong một màn hình.
4. Chuyển người gửi ở từng tin hoặc theo từng nhóm tin.
5. Đổi tên, biệt danh, avatar, màu sắc, emoji và trạng thái hiển thị.
6. Xem trước trên giao diện gần Messenger/Zalo.
7. Xuất thành ảnh content để dùng trên social.
8. Lưu lại để sửa, nhân bản hoặc tái sử dụng trong các content sau.

Đây là **mockup hội thoại phục vụ sáng tạo nội dung**, không phải ứng dụng nhắn tin
thật, không kết nối tài khoản Messenger/Zalo và không gửi tin nhắn đến người thật.
Giao diện có thể rất gần các sản phẩm quen thuộc, nhưng module vẫn là sản phẩm nội bộ
độc lập với preset riêng.

## 2. Phạm vi và ranh giới

### 2.1. Trong phạm vi

- Preset giao diện `Messenger-like`.
- Preset giao diện `Zalo-like`.
- Preset `Custom` để chỉnh màu và kiểu hiển thị.
- Hội thoại 2 người và nhóm nhiều người.
- Tên hiển thị, biệt danh và avatar riêng trong từng cuộc trò chuyện.
- Thêm, sửa, xóa, sắp xếp tin nhắn.
- Đổi người gửi nhanh.
- Emoji, reaction và emoji mặc định của cuộc trò chuyện.
- Timestamp, ngày, trạng thái đã gửi/đã nhận/đã xem.
- Typing indicator và system notice dạng mockup.
- Tin nhắn chữ, ảnh, sticker placeholder, link preview mockup.
- Đổi theme, màu bubble, nền và chế độ sáng/tối.
- Preview responsive.
- Xuất PNG trước; chuẩn bị cấu trúc cho JPG/WebP.
- Lưu project và output vào Library.
- Mở lại, nhân bản và chỉnh sửa project cũ.
- Tạo project từ dữ liệu dialogue hiện có trong Outlier.

### 2.2. Ngoài phạm vi MVP

- Chat realtime.
- Gửi tin nhắn thật.
- Đăng nhập hoặc đồng bộ Messenger/Zalo.
- Đọc dữ liệu từ tài khoản cá nhân.
- Tự động seeding comment hoặc auto-reply trên fanpage.
- Đồng bộ contact thật.
- Voice/video call thật.
- AI tự render chữ trong ảnh.
- Cam kết pixel-perfect vĩnh viễn với mọi phiên bản ứng dụng bên thứ ba.

### 2.3. Nguyên tắc thương hiệu và an toàn

- Dùng tên preset nội bộ: `Messenger-like`, `Zalo-like`, `Custom`.
- Không đưa logo hoặc tài sản thương hiệu độc quyền vào engine mặc định nếu chưa có
  quyền sử dụng.
- Không gọi output là ảnh chụp màn hình thật.
- Dữ liệu project luôn có `isMockup: true` ở tầng metadata.
- Có tùy chọn watermark/nhãn mockup khi xuất ảnh.
- Không dùng nội dung mockup để giả làm bằng chứng giao dịch, trao đổi nội bộ hoặc
  lời khai của người thật.

## 3. Tình trạng codebase hiện tại

Outlier đã có nền tảng tốt để tích hợp:

- React 19 + Vite + TypeScript ở client.
- Express + PostgreSQL + Drizzle ở server.
- Authentication và phân quyền hiện có.
- Storage nội bộ qua `server/storage.ts`.
- Bảng `characters` và giao diện quản lý nhân vật.
- Studio tạo content ở `src/pages/Studio.tsx`.
- Library/gallery ở `src/pages/Library.tsx` và
  `server/routes/gallery.routes.ts`.
- Format `chat` đã có trong `shared/post-formats.ts`.
- `ImageConcept.messages` hiện có dạng đơn giản `{ from, text }` trong
  `src/types.ts`.

Dữ liệu chat hiện tại chỉ phục vụ concept ảnh. Không nên mở rộng bằng cách nhét toàn bộ
editor vào `posts.overlayJson`, vì sẽ khó truy vấn, mở lại, versioning và tái sử dụng.
Nên tạo domain `chat_projects` riêng, sau đó liên kết tùy chọn với `posts` hoặc
`remakes`.

## 4. Kiến trúc đề xuất

### 4.1. Ba lớp

#### Lớp dữ liệu

Lưu một tài liệu hội thoại có cấu trúc, không lưu ảnh chụp màn hình làm nguồn chính.

```text
ChatProject
  ├── participants[]
  ├── messages[]
  ├── theme
  ├── platformPreset
  ├── exportSettings
  └── versions[] (Phase 2)
```

#### Lớp editor

```text
ChatComposerPage
  ├── ChatProjectToolbar
  ├── ParticipantPanel
  ├── MessageTimeline
  ├── MessageEditor
  ├── ChatPreview
  ├── ThemePanel
  └── ExportPanel
```

#### Lớp renderer

Một bộ component renderer dùng chung cho:

- preview trong editor;
- thumbnail trong Library;
- export ảnh;
- nhúng vào Remake;
- server-side render trong phase sau.

Không tạo một layout khác cho preview và export, vì sẽ gây lệch hình.

### 4.2. Không dùng AI để vẽ giao diện chat

Gemini hoặc model khác chỉ nên hỗ trợ sinh **dữ liệu hội thoại/gợi ý nội dung**. Giao diện
chat phải được render bằng React/CSS/SVG hoặc Canvas có dữ liệu cấu trúc. Cách này bảo
đảm:

- chữ tiếng Việt đúng tuyệt đối;
- message đúng thứ tự;
- avatar và tên đúng nhân vật;
- emoji không bị model vẽ sai;
- người dùng chỉnh được từng trường;
- export lặp lại được.

## 5. Data model

### 5.1. `chat_projects`

```text
id                 uuid primary key
owner              text not null
is_shared          boolean not null default false
title              text not null
platform           text not null
preset_version     text not null
theme_json         jsonb not null
export_json        jsonb not null
metadata_json      jsonb not null -- isMockup, source, note
created_at         timestamp
updated_at         timestamp
```

Giá trị `platform` dự kiến:

```text
messenger_like | zalo_like | custom
```

### 5.2. `chat_participants`

```text
id                 uuid primary key
project_id         uuid references chat_projects
character_id       uuid nullable references characters
name               text not null
display_name        text not null
nickname            text
avatar_url          text nullable
avatar_asset_id     uuid nullable references assets
role               text nullable
side               text not null -- left | right | auto
status_json         jsonb not null
sort_order         integer not null
created_at         timestamp
updated_at         timestamp
```

`character_id` cho phép tái sử dụng nhân vật Outlier. Các trường `display_name`,
`nickname`, avatar và `side` là override riêng của project, không làm thay đổi nhân vật
gốc.

### 5.3. `chat_messages`

```text
id                 uuid primary key
project_id         uuid references chat_projects
participant_id     uuid references chat_participants
message_type       text not null
text               text
media_url          text nullable
metadata_json      jsonb not null
sent_at            timestamp nullable
sort_order         integer not null
reply_to_id        uuid nullable references chat_messages
is_pinned          boolean not null default false
created_at         timestamp
updated_at         timestamp
```

`message_type` MVP:

```text
text | emoji | image | system | typing | link_preview | sticker
```

`metadata_json` có thể chứa reaction, read state, link preview, sticker key và thông
số hiển thị. Khi cần query hoặc thống kê lớn mới tách reaction thành bảng riêng.

### 5.4. `chat_exports`

```text
id                 uuid primary key
project_id         uuid references chat_projects
format             text not null -- png | jpg | webp
width              integer not null
height             integer not null
file_url           text not null
renderer_version   text not null
created_by         text not null
created_at         timestamp
```

Avatar upload và file export phải đi qua storage nội bộ; không lưu base64 lớn trong
JSONB/database.

## 6. API dự kiến

### Project

```text
GET    /api/chat-projects
POST   /api/chat-projects
GET    /api/chat-projects/:id
PATCH  /api/chat-projects/:id
DELETE /api/chat-projects/:id
POST   /api/chat-projects/:id/duplicate
```

### Participant

```text
POST   /api/chat-projects/:id/participants
PATCH  /api/chat-projects/:id/participants/:participantId
DELETE /api/chat-projects/:id/participants/:participantId
POST   /api/chat-projects/:id/participants/reorder
```

### Message

```text
POST   /api/chat-projects/:id/messages
PATCH  /api/chat-projects/:id/messages/:messageId
DELETE /api/chat-projects/:id/messages/:messageId
POST   /api/chat-projects/:id/messages/reorder
POST   /api/chat-projects/:id/messages/bulk-change-sender
```

### Export

```text
POST   /api/chat-projects/:id/export
GET    /api/chat-projects/:id/exports
GET    /api/chat-exports/:exportId
DELETE /api/chat-exports/:exportId
```

MVP có thể lưu project bằng một request document duy nhất để giảm số lần gọi API. Khi
editor ổn định, có thể dùng endpoint riêng cho autosave hoặc debounce PATCH.

## 7. Giao diện người dùng

### 7.1. Route và điều hướng

- Route chính: `/chat-composer`.
- Route sửa project: `/chat-composer/:id`.
- Thêm mục **Dựng đoạn chat** trong nhóm **Sản xuất** của
  `src/components/Layout.tsx`.
- Từ Studio có nút chuyển sang Chat Composer.
- Từ Library có nút mở lại project.

### 7.2. Bố cục desktop

```text
┌──────────────────────────────────────────────────────────┐
│ Toolbar: tên project | preset | Undo | Save | Export     │
├───────────────┬────────────────────────┬─────────────────┤
│ Participants  │ Live chat preview      │ Inspector       │
│ + avatar      │                        │ message/theme   │
│               │                        │ export          │
├───────────────┴────────────────────────┴─────────────────┤
│ Message timeline / quick add                              │
└──────────────────────────────────────────────────────────┘
```

Trên mobile, chuyển thành tab hoặc drawer:

1. Nội dung.
2. Preview.
3. Thiết lập.

### 7.3. Participant panel

- Thêm participant.
- Chọn từ Characters.
- Tạo participant cục bộ.
- Đổi display name/nickname.
- Upload avatar.
- Chọn màu nhận diện.
- Chọn bên trái/phải hoặc auto.
- Trạng thái online/offline.
- Xóa participant và cảnh báo các message liên quan.

### 7.4. Message timeline

Mỗi dòng cần có:

- select người gửi;
- ô nhập nội dung;
- loại message;
- timestamp;
- thao tác duplicate/delete;
- kéo thả;
- reaction;
- reply;
- nút đổi người gửi.

Thao tác nhanh cần có:

- thêm tin nhắn sau dòng đang chọn;
- đổi vai A/B;
- đổi người gửi cho nhiều dòng;
- nhân bản một đoạn hội thoại;
- xóa một đoạn;
- nhập nhiều dòng từ text theo format đơn giản.

## 8. Preset giao diện

### 8.1. Preset Messenger-like

- Header hội thoại.
- Avatar tròn.
- Bubble trái/phải.
- Bubble màu theo theme.
- Nhóm bubble liên tiếp.
- Seen indicator.
- Reaction.
- Emoji hội thoại.
- Typing indicator.
- Link preview và ảnh mockup.

### 8.2. Preset Zalo-like

- Header xanh.
- Avatar và tên hội thoại.
- Bubble đơn giản, rõ chữ.
- Ngày phân cách.
- Đã xem.
- Sticker/ảnh mockup.
- Reaction.
- Nền hội thoại.
- Thông báo hệ thống.

### 8.3. Preset Custom

Cho phép chỉnh:

```ts
interface ChatTheme {
  mode: "light" | "dark";
  headerColor: string;
  backgroundColor: string;
  incomingBubbleColor: string;
  outgoingBubbleColor: string;
  incomingTextColor: string;
  outgoingTextColor: string;
  accentColor: string;
  borderRadius: number;
  showAvatars: boolean;
  showSeen: boolean;
  showTimestamps: boolean;
  conversationEmoji?: string;
}
```

Preset phải có `preset_version` để có thể sửa renderer sau này mà không làm thay đổi
các output cũ ngoài ý muốn.

## 9. Export

### 9.1. MVP

Ưu tiên client-side export vì không phải cài Chromium và output khớp preview. Cần:

- chờ font load trước khi export;
- preload avatar và media;
- kiểm soát CORS ảnh nội bộ;
- ẩn scrollbar và các control editor;
- render đúng kích thước output;
- xử lý emoji fallback;
- giữ chữ tiếng Việt đầy đủ dấu.

Kích thước mặc định:

```text
1080 x 1080   -- vuông
1080 x 1350   -- feed dọc
1080 x 1920   -- story/reel
1920 x 1080   -- ngang
```

### 9.2. Phase sau

Nếu cần batch export, export qua MCP hoặc output tuyệt đối đồng nhất giữa môi trường,
đưa renderer lên server-side bằng Playwright/Chromium. Khi đó cần đánh giá lại:

- RAM/CPU container;
- thời gian render;
- queue job;
- giới hạn file;
- tự dọn export cũ;
- nhãn `mb.env` và autostop của môi trường preview/staging.

## 10. Tích hợp pipeline Outlier

### Studio

Thêm lựa chọn:

```text
Tạo ảnh minh họa | Dựng đoạn chat
```

Nếu chọn chat, chuyển sang `/chat-composer` với nhân vật và dialogue đã chọn nếu có.

### Signals/Trend

Nếu `suggestionJson.dialogue` có dữ liệu, thêm hành động **Dựng thành đoạn chat**.
Dữ liệu chuyển đổi:

```text
suggestion.dialogue[]
  → chat_participants
  → chat_messages
```

### Remake

Format `chat` hiện tại vẫn được giữ để tương thích. Khi concept có `messages`, cho
phép mở vào Chat Composer thay vì gửi trực tiếp cho image model.

Luồng đề xuất:

```text
Remake concept
  → tạo ChatProject
  → người dùng chỉnh hội thoại
  → export ảnh
  → lưu Library
```

### Library

Mở rộng `origin` để phân biệt:

```text
studio | pipeline | remake | chat_composer
```

Gallery cần có thumbnail, tên project, preset, owner, trạng thái shared và nút mở lại.

## 11. Tự động hóa trong tương lai

Module nên được thiết kế như một bước trong pipeline content, không chỉ là một trình
vẽ ảnh thủ công.

### Phase automation 1: template

- Template hội thoại theo tình huống.
- Biến placeholder:
  - tên nhân vật;
  - sản phẩm;
  - câu hỏi;
  - punchline;
  - CTA.
- Nhân bản project từ template.
- Lưu version và ghi chú biến thể.

### Phase automation 2: AI sinh kịch bản

AI nhận brief và trả về schema có cấu trúc:

```json
{
  "participants": [
    { "key": "customer", "displayName": "Minh" },
    { "key": "staff", "displayName": "Chị Bão" }
  ],
  "messages": [
    { "from": "customer", "text": "..." },
    { "from": "staff", "text": "..." }
  ],
  "notes": "..."
}
```

AI không được tự ý ghi thẳng vào project đang chỉnh sửa. Luồng đúng là:

1. Sinh bản nháp.
2. Hiển thị diff/preview.
3. Người dùng chấp nhận hoặc sửa.
4. Chạy guardrail.
5. Mới lưu thành version.

### Phase automation 3: MCP

Có thể thêm các tool:

```text
chat_project_create
chat_project_get
chat_project_update
chat_project_generate_draft
chat_project_export
chat_project_duplicate
```

Các tác vụ export/render lâu phải trả `job_id`, không giữ request mở.

### Phase automation 4: content batch

- Sinh nhiều biến thể hội thoại.
- Đổi nhân vật theo brand.
- Sinh nhiều tỷ lệ ảnh.
- Xuất batch.
- Đưa vào Library hoặc lịch content.
- Vẫn giữ bước duyệt người thật trước khi dùng trên social.

## 12. Guardrail nội dung

Module phải hiển thị rõ đây là mockup và không được làm mất kiểm soát nội dung.

Cần có:

- `isMockup: true` trong metadata.
- Audit `createdBy`, `createdAt`, `updatedAt`.
- Tùy chọn watermark/label khi export.
- Không cho AI tự khẳng định đây là tin nhắn thật.
- Cảnh báo khi nội dung chứa thông tin cá nhân có vẻ thật.
- Không đưa token/API key vào client hoặc file export.
- Avatar upload giới hạn MIME, dung lượng và kích thước.
- Chỉ owner/admin được sửa hoặc xóa project riêng.
- Project shared tuân theo ownership hiện tại của Outlier.

Nếu sau này có AI sinh nội dung, cần tái sử dụng các guardrail brand hiện có: từ cấm,
xưng hô, claim sản phẩm và kiểm tra nội dung trước export.

## 13. Roadmap triển khai

### Phase 0 — PRD, mockup, contract

**Kết quả:**

- `docs/CHAT-COMPOSER-PRD.md` hoặc bổ sung mục tương ứng vào PRD chính.
- Mockup các màn:
  - empty state;
  - editor 2 người;
  - nhóm 4 người;
  - inspector theme;
  - lỗi upload avatar;
  - export thành công/thất bại.
- Chốt preset, thuật ngữ và message type.
- Chốt acceptance criteria.

### Phase 1 — MVP editor

**Phạm vi:**

- Migration bốn bảng chính.
- API CRUD project/participant/message.
- Route `/chat-composer`.
- Editor hội thoại 2 người.
- Nhóm nhiều người.
- Đổi tên, nickname, avatar.
- Đổi sender.
- Theme cơ bản.
- Preset Messenger-like và Zalo-like.
- Preview responsive.
- Lưu/mở lại/nhân bản.
- Export PNG.

### Phase 2 — Content workflow

**Phạm vi:**

- Nối Studio.
- Nối Remake format `chat`.
- Nối Signal/Suggestion dialogue.
- Lưu output vào Library.
- Template hội thoại.
- Duplicate và chỉnh biến thể.
- Import nhiều dòng text.
- Bulk change sender.
- Tùy chọn watermark/mockup label.

### Phase 3 — Fidelity và production features

**Phạm vi:**

- Reply/quote.
- Reaction nhiều participant.
- Sticker.
- Link preview.
- Voice message mockup.
- Poll/location mockup.
- Dark mode hoàn chỉnh.
- JPG/WebP.
- Batch export.
- Server-side render.
- MCP tools.

### Phase 4 — Tự động hóa content

**Phạm vi:**

- AI sinh draft theo brief.
- Template có biến.
- Nhiều biến thể hội thoại.
- Guardrail trước export.
- Batch content.
- Gắn vào content calendar sau khi module nền ổn định.

## 14. Acceptance criteria

### Editor

- Tạo project mới trong một màn hình.
- Thêm tối thiểu 10 participant.
- Đổi nickname mà không đổi dữ liệu Character gốc.
- Upload avatar và thấy ngay trong preview.
- Đổi sender của một hoặc nhiều message.
- Kéo-thả hoặc đổi thứ tự message.
- Đổi theme không làm mất nội dung.
- Nhân bản project thành project mới.

### Preview

- Tin nhắn tiếng Việt đầy đủ dấu.
- Emoji không làm vỡ bubble.
- Avatar không méo.
- Message dài tự xuống dòng.
- Tin liên tiếp được nhóm đúng.
- Timestamp và trạng thái seen ở đúng vị trí.
- Preview desktop/mobile có empty và error state.

### Export

- PNG giống preview.
- Không có scrollbar/control editor trong output.
- Có bốn kích thước chuẩn đã định nghĩa.
- Avatar và font load đủ trước khi export.
- Export lỗi không làm mất project.
- Output xuất hiện trong Library và mở lại được project nguồn.

### Tích hợp

- Từ Remake có thể chuyển dialogue thành ChatProject.
- Từ Signal có thể tạo đoạn chat.
- Format `chat` cũ vẫn không bị hỏng.
- Pipeline tạo ảnh AI hiện tại vẫn chạy bình thường.
- Không có secret ở client.
- Có test schema, API, renderer và quyền truy cập.

## 15. Test plan

### Unit test

- Validate project/theme/preset.
- Validate participant và sender.
- Validate thứ tự message.
- Validate message type.
- Validate kích thước export.
- Validate ownership/shared access.
- Chuyển đổi `dialogue` cũ sang ChatProject.

### API test

- CRUD project.
- CRUD participant/message.
- Không đọc được project private của user khác.
- Shared project đọc được đúng phạm vi.
- Owner/admin mới được sửa/xóa theo policy.
- Avatar upload từ chối MIME/dung lượng sai.
- Export lỗi không tạo bản ghi giả.

### UI/E2E test

- Tạo chat 2 người.
- Tạo chat nhóm 4 người.
- Đổi sender hàng loạt.
- Đổi preset.
- Đổi avatar/nickname.
- Export ba tỷ lệ.
- Mở project từ Library.
- Tạo project từ Remake dialogue.
- Kiểm tra responsive mobile.

### Visual regression

Chụp và so sánh các fixture cố định cho:

- Messenger-like sáng/tối.
- Zalo-like.
- Chat 2 người.
- Chat nhóm.
- Message dài tiếng Việt.
- Emoji và reaction.
- Typing indicator.

## 16. Rủi ro và cách xử lý

*(Dòng → là: Cách xử lý)*

- **Người xem hiểu nhầm là screenshot thật**
  → Metadata mockup, label/watermark tùy chọn, không dùng logo mặc định
- **Clone giao diện quá sát làm khó bảo trì**
  → Preset version, token hóa theme, renderer độc lập
- **AI viết sai chữ trong ảnh**
  → Render DOM/CSS, AI chỉ sinh JSON dialogue
- **Emoji khác nhau giữa máy**
  → Font/emoji fallback, test trên môi trường export
- **Avatar chứa dữ liệu nhạy cảm**
  → Giới hạn upload, ownership, storage nội bộ, signed URL về sau
- **JSONB phình lớn**
  → Bảng project/participant/message riêng, không lưu base64
- **Export client lệch preview**
  → Dùng chung renderer, chờ font/media load, visual regression
- **Render server tốn tài nguyên**
  → Để phase sau, queue và giới hạn kích thước
- **AI tự sinh claim sai brand**
  → Chạy guardrail brand trước khi cho export
- **Tự động hóa tạo hàng loạt nội dung kém chất lượng**
  → Luôn có draft → review → approve, không tự đăng

## 17. Definition of Done cho MVP

- [ ] Có mockup editor và các empty/error state.
- [ ] Có schema migration và rollback/forward migration đã kiểm tra.
- [ ] Có CRUD API với ownership guard.
- [ ] Có route `/chat-composer` và navigation.
- [ ] Tạo được hội thoại 2 người và nhóm nhiều người.
- [ ] Có preset Messenger-like, Zalo-like và Custom tối thiểu.
- [ ] Đổi được tên, nickname, avatar, sender, theme và emoji.
- [ ] Có preview responsive.
- [ ] Export PNG theo bốn kích thước chuẩn.
- [ ] Lưu output vào Library.
- [ ] Mở lại và nhân bản project được.
- [ ] Nối được ít nhất một nguồn dialogue hiện có trong Outlier.
- [ ] `npm run lint` chạy thành công.
- [ ] Test unit/API/E2E cốt lõi chạy thành công.
- [ ] Cập nhật `docs/ARCH.md`, `docs/PRD.md` hoặc tài liệu module và README.
- [ ] Không commit secret.

## 18. Quyết định triển khai được đề xuất

Bắt đầu bằng **Phase 0 + Phase 1**, không làm realtime và không cài Chromium ở vòng
đầu. Ưu tiên chứng minh được vòng lặp có giá trị nhất:

```text
Content brief
  → tạo hội thoại trong một editor
  → đổi vai/đổi avatar/chỉnh theme
  → preview giống preset quen thuộc
  → export PNG
  → lưu Library
```

Sau khi team Content dùng thử và xác nhận editor nhanh hơn cách dùng hai tài khoản thật,
mới đầu tư Phase 2–4 cho template, AI draft, batch export và MCP automation.
