export type Role = "admin" | "member";

export interface AuthUser {
  username: string;
  role: Role;
}

// ===== Domain types — mirror server/db/schema.ts (camelCase over the wire) =====

export type SignalSource = "market_radar" | "group_insights" | "manual";
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
  scored_by?: string;
  scored_at?: string;
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
  createdBy: string | null;
  createdAt: string;
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
  // Minh bạch: prompt JSON đã gửi Gemini + nhân vật thực sự vào ảnh.
  promptDebug?: { prompt: string; characters: string[] };
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
  createdAt: string;
  updatedAt: string;
}

export interface MeInfo {
  username: string;
  role: Role;
  isActive: boolean;
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
}
