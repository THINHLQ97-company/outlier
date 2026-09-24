export type Role = "admin" | "member";

export interface AuthUser {
  username: string;
  role: Role;
}

// ===== Domain types — mirror server/db/schema.ts (camelCase over the wire) =====

export type SignalSource = "market_radar" | "group_insights" | "manual" | "claude_research" | "google_trends";
export type SignalStatus = "new" | "scored" | "queued" | "idea_bank" | "rejected";
export type AxisKey = "ai" | "ke_toan" | "hosting";

export interface SignalScore {
  do_nong?: number;
  do_cham?: number;
  do_hop_truc?: number;
  tuoi_tho?: number;
  do_an_toan?: number;
  total?: number;
  dinh_nhom_cam?: boolean;
  reasoning?: string; // lý do chấm (khi Claude chấm qua MCP)
  scored_by?: string;
  scored_at?: string;
}

// Góc hài Claude gợi ý cho 1 tín hiệu (qua MCP) — hiện ở tab Tín hiệu.
export interface SignalSuggestion {
  scene?: string;
  characters?: string[];
  dialogue?: { character: string; text: string }[];
  note?: string;
  suggested_by?: string;
  suggested_at?: string;
}

export interface Signal {
  id: string;
  source: SignalSource;
  radar: string | null;
  truc: AxisKey | null;
  title: string;
  rawSummary: string;
  sourceUrl: string | null;
  publishedDate: string;
  scoreJson: SignalScore;
  status: SignalStatus;
  clusterId?: string | null; // cụm dedup (Claude gom qua MCP)
  clusterLabel?: string | null; // nhãn cụm
  suggestionJson?: SignalSuggestion; // góc hài Claude gợi ý
  /** Dữ liệu gốc của nguồn, giữ nguyên cấu trúc để hiển thị cho tử tế. */
  sourceMetaJson?: SignalSourceMeta | null;
  createdBy: string | null;
  createdAt: string;
}

/** Mirror server/db/schema.ts (SignalSourceMeta). */
export interface SignalSourceMeta {
  approxTraffic?: string;
  news?: { title: string; url: string; source?: string }[];
  pictureUrl?: string;
  geo?: string;
}

export interface RubricVersion {
  id: string;
  weightsJson: Record<string, number>;
  thresholdsJson: Record<string, number>;
  note: string | null;
  isActive: boolean;
  createdAt: string;
  createdBy: string;
}

export interface ScriptVariant {
  formatMeme: string;
  panels: string[];
  caption: string;
  ctaSoft?: string;
}

export type ScriptSource = "signal" | "freeform";

export interface ScriptRow {
  id: string;
  signalId: string | null; // null với kịch bản tự viết (freeform)
  source: ScriptSource;
  title: string | null; // nhãn kịch bản tự viết
  truc: AxisKey;
  formatMeme: string;
  contentJson: ScriptVariant[];
  selectedVariant: number | null;
  isDemo: boolean;
  createdBy: string | null;
  createdAt: string;
}

export type CharacterKind = "nguoi" | "ai" | "linh_vat";

export interface CharacterRow {
  id: string;
  name: string;
  kind: CharacterKind;
  promptDescription: string;
  personality: string | null;
  catchphrase: string | null;
  referenceImageUrl: string | null;
  imageMissing?: boolean; // URL có nhưng file storage đã mất (vd redeploy) → cần vẽ lại
  createdAt: string;
  updatedAt: string;
}

export type PostStatus = "draft" | "cho_duyet" | "sua_thoai" | "rot" | "san_sang_dang" | "da_dang";

export interface ImageVariant {
  url: string;
  source: "social" | "placeholder";
}

export interface TextBox {
  id: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  text: string;
  color: string;
  align: "left" | "center" | "right";
}

export type PostOrigin = "pipeline" | "studio";

// Lời thoại gắn với nhân vật (Studio) — model tự vẽ bong bóng khi có thoại.
export interface DialogueLine {
  character: string;
  text: string;
}

export interface StudioParams {
  characterIds: string[];
  assetIds: string[];
  styleId?: string | null; // phong cách đã chọn (thư viện styles)
  dialogue?: DialogueLine[]; // lời thoại đã nhập
  panelLayout?: string; // key PANEL_LAYOUTS (1/2/4/auto)
  background?: string; // key BACKGROUND_OPTIONS (scene/white/minimal)
  useRag?: boolean; // đã bật RAG khi vẽ
  // Deprecated: Studio không còn sinh caption theo trục (posts.truc = null). Giữ
  // optional để không phá bài Studio cũ đã lưu studioParams.truc.
  truc?: AxisKey | null;
}

export interface OverlayConfig {
  textBoxes: TextBox[];
  watermarkBrand?: string;
  // B2.2 — tỉ lệ khung đã dùng khi sinh ảnh ("1:1" | "3:4" | "9:16"), đọc lại
  // để TextOverlayEditor/ImageStudio hiển thị đúng canvas kể cả khi mở lại
  // bằng "Sửa thoại". Mặc định "1:1" nếu thiếu (bài cũ trước B2.2).
  aspectRatio?: string;
  // Pipeline: dàn nhân vật đã chọn lúc sinh ảnh (để vẽ lại đúng).
  characterIds?: string[];
  // Studio: tham số vẽ tự do đã lưu (để vẽ lại đúng).
  studioParams?: StudioParams;
  // Lịch sử chỉnh sửa: mỗi bước = câu lệnh + ảnh kết quả (để xem lại/quay lại).
  editHistory?: { instruction: string; url: string }[];
  // Minh bạch: prompt JSON đã gửi Gemini + nhân vật + style + RAG.
  // characters = mọi nhân vật đã chọn (hiển thị); charactersRef = nhân vật có ảnh ref.
  promptDebug?: { prompt: string; characters: string[]; charactersRef?: string[]; style?: string | null; ragUsed?: number };
}

// ===== RAG — kho "ảnh đã thích" + hồ sơ sở thích =====
export interface RagExample {
  id: string;
  owner: string;
  isShared: boolean;
  postId: string | null;
  scene: string | null;
  paramsJson: {
    styleName?: string | null;
    characters?: string[];
    background?: string | null;
    panelLayout?: string | null;
    dialogue?: DialogueLine[];
    aspectRatio?: string | null;
  };
  imageUrl: string | null;
  createdAt: string;
  isMine: boolean;
}

export interface RagProfile {
  profileText: string | null;
  exampleCount: number;
  updatedAt: string | null;
}

export interface PostRow {
  id: string;
  scriptId: string | null; // null với bài Studio (vẽ tự do)
  origin: PostOrigin;
  owner: string | null;
  isShared: boolean;
  truc: AxisKey | null; // studio set trực tiếp; pipeline null → lấy từ script
  promptText: string | null; // mô tả tự do (studio)
  imageVariants: ImageVariant[];
  selectedImageUrl: string | null;
  overlayJson: OverlayConfig;
  finalImageUrl: string | null;
  caption: string | null;
  status: PostStatus;
  checklistJson: Record<string, boolean>;
  rejectReason: string | null;
  fbPostUrl: string | null;
  createdBy: string | null;
  createdAt: string;
  decidedAt: string | null;
  postedAt: string | null;
}

// ===== assets — kho template meme + ảnh tham chiếu =====
export type AssetKind = "meme_template" | "reference";

export interface AssetRow {
  id: string;
  owner: string;
  isShared: boolean;
  kind: AssetKind;
  name: string;
  imageUrl: string | null; // "/api/files/assets/<key>"
  note: string | null;
  createdAt: string;
  updatedAt: string;
  isMine: boolean; // server đính cờ: asset này thuộc user hiện tại (mới được sửa/xoá)
}

// ===== styles — thư viện phong cách vẽ (ảnh tham chiếu + mô tả JSON) =====
export interface StyleRow {
  id: string;
  owner: string;
  isShared: boolean;
  isDefault: boolean;
  name: string;
  styleJson: Record<string, any>;
  referenceImageUrl: string | null; // "/api/files/styles/<key>" (ảnh minh hoạ)
  imageMissing?: boolean; // URL có nhưng file storage đã mất → cần sinh lại
  isMine?: boolean; // server đính cờ: phong cách này thuộc user hiện tại
  createdAt: string;
  updatedAt: string;
}

// ===== users — quản lý tài khoản (admin) =====
export interface UserRow {
  id: string;
  username: string;
  role: Role;
  isActive: boolean;
  authProvider?: "local" | "google";
  email?: string | null;
  avatarUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeInfo {
  username: string;
  role: Role;
  isActive: boolean;
}

// ===== brands — hồ sơ thương hiệu, mỗi field kèm trích dẫn nguồn =====
// Mirror server/db/schema.ts (BrandEvidence/BrandField/BrandRow) + tuyến
// server/routes/brands.routes.ts (BrandSource). Nguyên tắc P1: field nào
// không kiểm chứng được (không có evidence) thì để null, không bịa.
export interface BrandEvidence {
  quote: string; // câu trích nguyên văn trong tài liệu
  sourceId: string;
  sourceUrl?: string;
  offset: number;
}

export interface BrandField<T = string> {
  value: T;
  evidence: BrandEvidence[];
  source: "extracted" | "manual"; // manual = người dùng tự nhập tay
  note?: string;
}

export interface BrandRow {
  id: string;
  owner: string;
  isShared: boolean;
  name: string;
  sells: BrandField<string[]> | null;
  audience: BrandField<string> | null;
  toneOfVoice: BrandField<string> | null;
  addressing: BrandField<string> | null;
  bannedTerms: BrandField<string[]> | null;
  allowedClaims: BrandField<string[]> | null;
  ingestStatus: "empty" | "running" | "ready" | "error";
  createdAt: string;
  updatedAt: string;
}

export type BrandSourceKind = "website" | "fanpage" | "pdf" | "text";

export interface BrandSource {
  id: string;
  kind: BrandSourceKind;
  sourceUrl?: string | null;
  title?: string | null;
  charCount: number;
  status: string;
  errorMessage?: string | null;
  createdAt?: string;
}

/** Số liệu rút từ lần quét fanpage gần nhất — mirror server/services/fanpage-stats.ts. */
export interface FanpageTopPost {
  id: string;
  message: string;
  permalink?: string;
  thumbnailUrl?: string;
  createdTime: string;
  likes: number;
  comments: number;
  shares: number;
  mediaType: string;
  /** Gấp mấy lần bài trung vị của CHÍNH trang này. */
  outperformRatio: number;
}

export interface FanpageStats {
  postCount: number;
  spanDays: number;
  postsPerWeek: number;
  medianLikes: number;
  medianComments: number;
  medianShares: number;
  medianLength: number;
  formatMix: Record<string, number>;
  topHours: { hour: number; count: number }[];
  topPosts: FanpageTopPost[];
}

/** Trang/kênh của chính thương hiệu — khác kênh theo dõi đối thủ. */
export interface BrandFanpage {
  id: string;
  brandId: string;
  platform: string;
  pageUrl: string;
  pageName?: string | null;
  handle?: string | null;
  followerCount?: number | null;
  topics?: string[];
  formats?: string[];
  postingCadence?: string | null;
  audienceNote?: string | null;
  note?: string | null;
  isPrimary: boolean;
  /** Nhân vật đại diện của trang (characters.id) — dùng làm mẫu khi vẽ ảnh. */
  characterIds?: string[];
  /** Đã nối Meta chưa — có nối thì đọc bài của chính page được, miễn phí. */
  metaPageId?: string | null;
  metaPictureUrl?: string | null;
  metaCategory?: string | null;
  metaAbout?: string | null;
  metaStatsJson?: FanpageStats | null;
  metaConnectedAt?: string | null;
  metaLastSyncAt?: string | null;
  metaLastPostCount?: number | null;
  createdAt: string;
}

export interface BrandDetail extends BrandRow {
  sources: BrandSource[];
  fanpages?: BrandFanpage[];
}

// Field bị AI khai nhưng không kiểm chứng lại được trong tài liệu → hệ thống
// chủ động chặn, không ghi vào hồ sơ. Trả về sau khi bấm "Bóc hồ sơ".
export interface BrandRejectedField {
  field: string;
  reason: string;
  claimedQuote?: string;
}

// ===== radar — tìm content đang "bật lên" trong ngách =====
// Mirror server/db/schema.ts (radarJobs/radarItems) + tuyến
// server/routes/radar.routes.ts. Điểm outperform tính trên thang 0..1000 ở
// DB, hiển thị chia 10 ra thang 100 cho dễ so sánh (xem RadarResults.tsx).
export type RadarQueryKind = "keyword" | "competitor";
export type RadarJobStatus = "pending" | "scanning" | "enriching" | "ready" | "error";
export type RadarConfidence = "low" | "medium" | "high";
export type RadarMetricsSource = "scan" | "apify";

export interface RadarJob {
  id: string;
  owner: string;
  brandId?: string | null;
  query: string;
  queryKind: RadarQueryKind;
  platforms: string[];
  status: RadarJobStatus;
  scannedCount: number;
  enrichedCount: number;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RadarScoreBreakdown {
  vsChannelMedian: number | null;
  vsFollowers: number | null;
  sessionRelative?: number | null;
  freshness: number;
  reasons: string[];
}

export interface RadarItem {
  id: string;
  jobId: string;
  platform: string;
  itemKey: string;
  url: string;
  title?: string | null;
  coverUrl?: string | null;
  durationSec?: number | null;
  publishedAt?: string | null;
  channelKey?: string | null;
  channelName?: string | null;
  followerCount?: number | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  metricsSource: RadarMetricsSource;
  outperformScore?: number | null;
  confidence: RadarConfidence;
  scoreBreakdown?: RadarScoreBreakdown | null;
  // Chỉ có ý nghĩa trong ngữ cảnh "Kênh theo dõi" (không phải Radar quét
  // rời): bài này mới xuất hiện so với lần làm mới trước — xem
  // server/routes/channels.routes.ts. Radar thường không set field này.
  isNew?: boolean;
}

export interface RadarJobDetail extends RadarJob {
  items: RadarItem[];
  minSampleForBaseline: number;
}

// POST /api/radar trả về NGAY (status="scanning"), việc quét chạy nền — client
// phải tự theo dõi bằng cách gọi lại GET /api/radar/:id (xem pollRadarJob ở
// services/radar.ts). KHÔNG còn kiểu chờ-tới-xong như trước.
export interface RadarCreateResult extends RadarJob {
  polling: true;
  message: string;
}

export interface RadarEnrichQuote {
  count: number;
  estimatedCostUsd: number;
  resultsUsedToday: number;
  apifyConfigured: boolean;
}

// POST /api/radar/:id/enrich có 2 dạng phản hồi:
// - Không còn bài nào cần bổ sung → trả ngay, không cần theo dõi tiếp.
// - Đã bắt đầu bổ sung (status="enriching") → cũng trả NGAY, việc bổ sung chạy
//   nền, client phải poll GET /api/radar/:id như trên.
export interface RadarEnrichSkipped {
  enriched: 0;
  message: string;
}

export interface RadarEnrichStarted extends RadarJob {
  polling: true;
  willEnrich: number;
  estimatedCostUsd: number;
  message: string;
}

export type RadarEnrichResult = RadarEnrichSkipped | RadarEnrichStarted;

// ===== channels — "Kênh theo dõi": mỗi ngày xem kênh đối thủ vừa đăng gì =====
// Mirror server/db/schema.ts (watchedChannels) + tuyến
// server/routes/channels.routes.ts. Mỗi lần làm mới tạo lại một radarJob bên
// dưới (dùng chung chấm điểm với Radar) rồi so với các lần trước để đánh dấu
// bài mới (RadarItem.isNew) — đây là giá trị cốt lõi của màn này.
export type ChannelScanStatus = "idle" | "scanning" | "error";

export interface WatchedChannel {
  id: string;
  owner: string;
  platform: string;
  channelUrl: string;
  channelKey?: string | null;
  channelName?: string | null;
  followerCount?: number | null;
  note?: string | null;
  isActive: boolean;
  useApify: boolean;
  lastScanAt?: string | null;
  lastJobId?: string | null;
  lastNewCount: number;
  /** Số lần đã quét — nhãn "MỚI" chỉ có nghĩa từ lần thứ hai. */
  scanCount: number;
  scanStatus: ChannelScanStatus;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WatchedChannelDetail extends WatchedChannel {
  items: RadarItem[];
}

// POST /api/channels và POST /api/channels/:id/refresh trả về NGAY
// (scanStatus="scanning"), việc quét chạy nền — client tự theo dõi bằng
// pollChannel() (xem services/channels.ts), giống pattern pollRadarJob.
export interface ChannelCreateResult extends WatchedChannel {
  polling: true;
  message: string;
}

// ===== deconstruct — "Bóc cấu trúc": vì sao bài này giữ được người xem =====
// Mirror server/db/schema.ts (deconstructions) + tuyến
// server/routes/deconstruct.routes.ts. atSec luôn tính từ đầu video gốc — UI
// dùng để dựng link tua thẳng tới đúng giây (xem src/pages/Deconstruct.tsx).
export interface RetentionBeat {
  atSec: number;
  what: string;
  whyItWorks: string;
}

export interface DeconstructedStructure {
  hook3s?: { atSec: number; what: string; technique?: string } | null;
  problemOpen?: { atSec: number; what: string; how?: string } | null;
  retentionBeats?: RetentionBeat[];
  twist?: { atSec: number; what: string } | null;
  cta?: { atSec: number; what: string; style?: string } | null;
  formula?: string | null;
  notes?: string | null;
}

export type DeconstructionStatus = "pending" | "downloading" | "analyzing" | "ready" | "error";
export type DeconstructAnalysisMode = "video" | "transcript";

/** Mirror server/db/schema.ts (AudienceInsight). */
export interface AudienceInsight {
  sampleSize: number;
  themes: {
    label: string;
    count: number;
    quotes: string[];
    sentiment?: "tích cực" | "tiêu cực" | "trung tính" | "lẫn lộn";
  }[];
  questions: string[];
  objections: string[];
  remakeAngles: string[];
  warning?: string;
}

export interface DeconstructionRow {
  id: string;
  owner: string;
  radarItemId?: string | null;
  sourceUrl: string;
  platform?: string | null;
  title?: string | null;
  durationSec?: number | null;
  /** video | post | image | unknown — quyết định remake đi đường bài viết hay video. */
  contentKind?: string | null;
  /** Người đọc bài gốc quan tâm gì — rút từ bình luận. */
  audienceInsight?: AudienceInsight | null;
  commentsFetchedAt?: string | null;
  thumbnailUrl?: string | null;
  status: DeconstructionStatus;
  /** true = nội dung chỉ lấy được bằng dịch vụ có phí, cần người dùng đồng ý. */
  needsPaid?: boolean;
  estimatedCostUsd?: string | null;
  errorMessage?: string | null; // ready: cảnh báo (mốc bị loại) · error: lỗi thật
  transcript?: string | null;
  structure?: DeconstructedStructure | null;
  analyzedBy?: string | null;
  analysisMode?: DeconstructAnalysisMode | null;
  createdAt: string;
  updatedAt: string;
}

// POST /api/deconstructions trả về NGAY (status="downloading"), việc phân
// tích chạy nền — client phải tự theo dõi bằng pollDeconstruction (xem
// services/deconstruct.ts), giống pattern pollRadarJob.
export interface DeconstructionCreateResult extends DeconstructionRow {
  polling: true;
  message: string;
}

// ===== remakes — "Viết lại": bản viết theo cấu trúc bài gốc nhưng cho thương
// hiệu, luôn kèm kết quả kiểm tra trước khi đem dùng. Mirror
// server/db/schema.ts (remakes) + server/services/guardrail.ts (GuardrailReport)
// + tuyến server/routes/remakes.routes.ts.
export type GuardrailCode = "copied_text" | "unverified_claim" | "banned_term" | "wrong_addressing";

export interface GuardrailIssue {
  code: GuardrailCode;
  severity: "block" | "warn";
  message: string;
  excerpt?: string; // đoạn văn bản có vấn đề
  atIndex?: number; // vị trí ký tự trong bản nháp
  hint?: string; // gợi ý cách sửa
}

export interface GuardrailReport {
  passed: boolean; // false = còn lỗi mức chặn
  issues: GuardrailIssue[];
  checkedAt: string;
  stats: { maxOverlapWords: number; wordCount: number };
}

export type RemakeFormat = "video_script" | "post";
export type RemakeStatus = "pending" | "writing" | "ready" | "error";

export interface RemakeRevision {
  at: string;
  note: string;
  draft: string;
}

export interface RemakeRow {
  id: string;
  owner: string;
  brandId: string;
  deconstructionId?: string | null;
  format: RemakeFormat;
  status: RemakeStatus;
  errorMessage?: string | null;
  draft?: string | null;
  guardrailJson?: GuardrailReport | null;
  revisionsJson?: RemakeRevision[];
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  /** Các phương án ảnh đã vẽ cho bản viết này. */
  imagesJson?: RemakeImage[];
  selectedImageUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Một phương án ảnh — mirror server/db/schema.ts (RemakeImage). */
export interface RemakeImage {
  url: string;
  prompt: string;
  aspectRatio: string;
  createdAt: string;
  isDemo?: boolean;
}

// POST /api/remakes và /api/remakes/:id/revise trả về NGAY (status
// "pending"/"writing"), việc viết chạy nền — client phải tự theo dõi bằng
// pollRemake() (xem services/remakes.ts), giống pattern pollDeconstruction.
export interface RemakeCreateResult extends RemakeRow {
  polling: true;
  message: string;
  // Chỉ có khi TẠO MỚI và hồ sơ thương hiệu còn trống — PHẢI hiện cho người
  // dùng biết bản viết sẽ chung chung (xem server/routes/remakes.routes.ts).
  hint?: string;
}

// ===== video_projects/video_scenes — "Dựng video": biến một bản viết thành
// video. Mirror server/db/schema.ts (videoProjects/videoScenes) + tuyến
// server/routes/videos.routes.ts. Quy trình 4 bước có điểm dừng vì bước dựng
// hình (generate) TỐN TIỀN THẬT — xem services/videos.ts.
export type VideoAspectRatio = "9:16" | "16:9";
export type VideoProjectStatus = "draft" | "splitting" | "scenes_ready" | "generating" | "rendering" | "ready" | "error";
export type VideoSceneStatus = "pending" | "generating" | "ready" | "error";

export interface VideoProject {
  id: string;
  owner: string;
  remakeId?: string | null;
  title?: string | null;
  aspectRatio: VideoAspectRatio;
  status: VideoProjectStatus;
  errorMessage?: string | null;
  scriptText?: string | null;
  finalVideoKey?: string | null;
  generatedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface VideoScene {
  id: string;
  projectId: string;
  orderIndex: number;
  narration?: string | null;
  visualPrompt?: string | null;
  durationSec: number;
  status: VideoSceneStatus;
  errorMessage?: string | null;
  clipKey?: string | null;
  createdAt: string;
  updatedAt: string;
}

// GET /api/videos/:id — kèm cảnh + ước tính chi phí phần còn phải dựng.
export interface VideoProjectDetail extends VideoProject {
  scenes: VideoScene[];
  pendingScenes: number;
  estimatedCostUsd: number;
  usdPerScene: number;
}

// POST /api/videos trả về NGAY (status="splitting") — tách cảnh chạy nền,
// client tự theo dõi bằng pollVideo() (xem services/videos.ts).
export interface VideoCreateResult extends VideoProject {
  polling: true;
  message: string;
  note?: string;
}

// GET /api/videos/:id/quote — ước tính chi phí TRƯỚC khi dựng hình, PHẢI hiện
// cho người dùng xác nhận trước khi gọi generateVideoScenes().
export interface VideoQuote {
  pendingScenes: number;
  estimatedCostUsd: number;
  usdPerScene: number;
  note: string;
}

// POST /api/videos/:id/generate — trả về NGAY, dựng hình chạy nền (TỐN
// TIỀN). Nếu mọi cảnh đã có hình, backend trả kèm `message` mà KHÔNG có
// `polling`/`willGenerate` (không tốn thêm tiền).
export interface VideoGenerateResult extends VideoProject {
  polling?: true;
  willGenerate?: number;
  estimatedCostUsd?: number;
  message: string;
}

// POST /api/videos/:id/render — trả về NGAY, ghép chạy nền (miễn phí).
export interface VideoRenderResult extends VideoProject {
  polling?: true;
  message: string;
}

// ===== gallery — post có ảnh, kèm trục + quyền sở hữu =====
export interface GalleryPost {
  id: string;
  origin: PostOrigin;
  owner: string | null;
  isShared: boolean;
  status: PostStatus;
  truc: AxisKey | null;
  finalImageUrl: string | null;
  selectedImageUrl: string | null;
  imageVariants: ImageVariant[];
  caption: string | null;
  createdAt: string;
  isMine: boolean;
  isFavorite?: boolean; // client đính: user đã thả tim ảnh này (từ /api/rag/favorite-ids)
}
