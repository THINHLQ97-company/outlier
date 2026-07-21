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

export interface ScriptRow {
  id: string;
  signalId: string;
  truc: AxisKey;
  formatMeme: string;
  contentJson: ScriptVariant[];
  selectedVariant: number | null;
  isDemo: boolean;
  createdBy: string | null;
  createdAt: string;
}

export interface CharacterRow {
  id: string;
  name: string;
  kind: "nguoi" | "ai" | "linh_vat";
  promptDescription: string;
  personality: string | null;
  catchphrase: string | null;
  referenceImageUrl: string | null;
  createdAt: string;
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

export interface OverlayConfig {
  textBoxes: TextBox[];
  watermarkBrand?: string;
}

export interface PostRow {
  id: string;
  scriptId: string;
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
