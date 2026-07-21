import { useEffect, useRef, useState } from "react";
import { Plus, Loader2, X, Pencil, Trash2, Upload, Sparkles, UserRound, Wand2 } from "lucide-react";
import {
  listCharacters,
  createCharacter,
  updateCharacter,
  deleteCharacter,
  generateCharacterReference,
  fileToDataUrl,
  imageDisplayUrl,
  type CharacterInput,
} from "../services/characters";
import ConfirmDialog from "../components/ConfirmDialog";
import type { CharacterRow, CharacterKind } from "../types";

const KIND_LABEL: Record<CharacterKind, string> = {
  nguoi: "Người",
  ai: "AI",
  linh_vat: "Linh vật",
};

const KIND_BADGE: Record<CharacterKind, string> = {
  nguoi: "bg-storm-50 text-storm-700",
  ai: "bg-blue-50 text-blue-700",
  linh_vat: "bg-amber-50 text-amber-700",
};

export default function Characters() {
  const [items, setItems] = useState<CharacterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formTarget, setFormTarget] = useState<CharacterRow | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CharacterRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"upload" | "generate" | "delete" | null>(null);
  const [drawingAll, setDrawingAll] = useState(false);
  const [drawAllProgress, setDrawAllProgress] = useState<string | null>(null);
  const [drawAllResult, setDrawAllResult] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setItems(await listCharacters());
    } catch (e: any) {
      setError(e?.message || "Lỗi tải thư viện nhân vật.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleUpload(c: CharacterRow, file: File) {
    setBusyId(c.id);
    setBusyAction("upload");
    setError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const updated = await updateCharacter(c.id, { refImageDataUrl: dataUrl });
      setItems((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
    } catch (e: any) {
      setError(e?.message || "Upload ảnh thất bại.");
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  }

  async function handleGenerate(c: CharacterRow) {
    setBusyId(c.id);
    setBusyAction("generate");
    setError(null);
    try {
      const updated = await generateCharacterReference(c.id);
      setItems((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
    } catch (e: any) {
      setError(e?.message || "AI vẽ ảnh thất bại.");
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  }

  // Vẽ cả bộ — lặp TUẦN TỰ qua các nhân vật chưa có referenceImageUrl, gọi lại
  // API generate-reference sẵn có cho từng cái. Lỗi 1 nhân vật thì ghi lại và
  // tiếp tục cái kế (không dừng cả loạt) — pattern "không crash" của CLAUDE.md.
  async function handleGenerateAll() {
    const todo = items.filter((c) => !c.referenceImageUrl);
    if (todo.length === 0) return;
    setDrawingAll(true);
    setDrawAllResult(null);
    setError(null);
    let okCount = 0;
    const failedNames: string[] = [];
    for (let i = 0; i < todo.length; i++) {
      const c = todo[i];
      setDrawAllProgress(`Đang vẽ ${i + 1}/${todo.length}: ${c.name}...`);
      try {
        const updated = await generateCharacterReference(c.id);
        setItems((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
        okCount++;
      } catch (e: any) {
        failedNames.push(c.name);
        console.warn(`[characters] Vẽ cả bộ — lỗi nhân vật "${c.name}":`, e?.message || e);
      }
    }
    setDrawAllProgress(null);
    setDrawAllResult(
      failedNames.length
        ? `Xong: vẽ được ${okCount}, lỗi ${failedNames.length} (${failedNames.join(", ")}).`
        : `Xong: vẽ được ${okCount}, lỗi 0.`
    );
    setDrawingAll(false);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    setBusyAction("delete");
    setError(null);
    try {
      await deleteCharacter(deleteTarget.id);
      setItems((prev) => prev.filter((x) => x.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e: any) {
      setError(e?.message || "Xoá nhân vật thất bại.");
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  }

  const isDemoMode = items.length > 0 && items.every((c) => c.id.startsWith("demo-"));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-stone-800 font-display">Nhân vật</h1>
          <p className="text-sm text-stone-500">
            Dàn nhân vật cố định + linh vật (mục 2, MATBAO_FANPAGE_ENGINE_v3.md) — thêm/sửa/xoá, upload
            ảnh reference hoặc để AI vẽ từ mô tả prompt.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleGenerateAll}
            disabled={isDemoMode || drawingAll || items.every((c) => !!c.referenceImageUrl)}
            className="flex items-center gap-1.5 text-sm font-medium text-storm-700 bg-storm-50 hover:bg-storm-100 px-3 py-2 rounded-lg transition-colors disabled:opacity-60"
            title={
              isDemoMode
                ? "Chưa cấu hình DATABASE_URL — chỉ xem được dữ liệu demo."
                : items.every((c) => !!c.referenceImageUrl)
                  ? "Tất cả nhân vật đã có ảnh reference."
                  : "Lần lượt cho AI vẽ ảnh reference cho các nhân vật chưa có ảnh."
            }
          >
            {drawingAll ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Wand2 className="w-4 h-4" aria-hidden="true" />
            )}
            Vẽ cả bộ (nhân vật chưa có ảnh)
          </button>
          <button
            onClick={() => setFormTarget("new")}
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-storm-600 hover:bg-storm-700 px-3 py-2 rounded-lg transition-colors disabled:opacity-60"
            disabled={isDemoMode}
            title={isDemoMode ? "Chưa cấu hình DATABASE_URL — chỉ xem được dữ liệu demo." : undefined}
          >
            <Plus className="w-4 h-4" aria-hidden="true" /> Thêm nhân vật mới
          </button>
        </div>
      </div>

      {drawAllProgress && (
        <div className="text-sm text-storm-700 bg-storm-50 border border-storm-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> {drawAllProgress}
        </div>
      )}
      {drawAllResult && !drawingAll && (
        <div className="text-sm text-stone-700 bg-stone-100 border border-stone-200 rounded-lg px-3 py-2">
          {drawAllResult}
        </div>
      )}

      {isDemoMode && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Đang xem dữ liệu demo tĩnh (thiếu DATABASE_URL) — không thể thêm/sửa/xoá cho tới khi cấu hình DB.
        </div>
      )}
      {error && (
        <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-stone-400 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Đang tải...
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-stone-400 text-sm">Chưa có nhân vật nào.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((c) => (
            <CharacterCard
              key={c.id}
              character={c}
              disabled={isDemoMode}
              busy={busyId === c.id ? busyAction : null}
              onEdit={() => setFormTarget(c)}
              onDelete={() => setDeleteTarget(c)}
              onUpload={(file) => handleUpload(c, file)}
              onGenerate={() => handleGenerate(c)}
            />
          ))}
        </div>
      )}

      {formTarget && (
        <CharacterForm
          initial={formTarget === "new" ? null : formTarget}
          onClose={() => setFormTarget(null)}
          onSaved={(row) => {
            setItems((prev) => {
              const exists = prev.some((x) => x.id === row.id);
              return exists ? prev.map((x) => (x.id === row.id ? row : x)) : [row, ...prev];
            });
            setFormTarget(null);
          }}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Xoá nhân vật?"
        message={`Xoá "${deleteTarget?.name}" khỏi thư viện nhân vật? Ảnh reference (nếu có) cũng sẽ bị xoá. Không thể hoàn tác.`}
        confirmText="Xoá"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function CharacterCard({
  character: c,
  disabled,
  busy,
  onEdit,
  onDelete,
  onUpload,
  onGenerate,
}: {
  character: CharacterRow;
  disabled: boolean;
  busy: "upload" | "generate" | "delete" | null;
  onEdit: () => void;
  onDelete: () => void;
  onUpload: (file: File) => void;
  onGenerate: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const busyAny = !!busy;

  return (
    <div className="flex flex-col gap-3 bg-white p-4 rounded-xl border border-stone-200 shadow-sm hover:border-stone-300 transition-all">
      <div className="flex items-start gap-3">
        <div className="w-16 h-16 rounded-lg overflow-hidden bg-stone-100 border border-stone-200 shrink-0 flex items-center justify-center">
          {c.referenceImageUrl ? (
            <img src={imageDisplayUrl(c.referenceImageUrl) || undefined} alt={c.name} className="w-full h-full object-cover" />
          ) : (
            <UserRound className="w-7 h-7 text-stone-300" aria-hidden="true" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-stone-800 truncate">{c.name}</span>
            <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${KIND_BADGE[c.kind]}`}>
              {KIND_LABEL[c.kind]}
            </span>
          </div>
          {c.personality && <p className="text-xs text-stone-500 mt-0.5 line-clamp-2">{c.personality}</p>}
          {c.catchphrase && <p className="text-xs text-storm-600 italic mt-0.5">"{c.catchphrase}"</p>}
        </div>
      </div>

      <div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] text-stone-400 hover:text-stone-600 underline underline-offset-2"
        >
          {expanded ? "Ẩn prompt mô tả" : "Xem prompt mô tả (dùng cho tool vẽ ảnh)"}
        </button>
        {expanded && (
          <p className="text-xs text-stone-500 bg-stone-50 rounded-lg p-2 mt-1 leading-relaxed">
            {c.promptDescription}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap mt-auto pt-1 border-t border-stone-100">
        <button
          onClick={onEdit}
          disabled={disabled || busyAny}
          className="flex items-center gap-1 text-xs font-medium text-stone-600 hover:bg-stone-100 px-2 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          title="Sửa thông tin nhân vật"
        >
          <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Sửa
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || busyAny}
          className="flex items-center gap-1 text-xs font-medium text-stone-600 hover:bg-stone-100 px-2 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          title="Upload ảnh reference"
        >
          {busy === "upload" ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Upload className="w-3.5 h-3.5" aria-hidden="true" />}
          Upload ảnh
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label={`Upload ảnh reference cho ${c.name}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = "";
          }}
        />
        <button
          onClick={onGenerate}
          disabled={disabled || busyAny}
          className="flex items-center gap-1 text-xs font-medium text-storm-700 bg-storm-50 hover:bg-storm-100 px-2 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          title="Dùng AI (Gemini) vẽ ảnh reference từ mô tả prompt"
        >
          {busy === "generate" ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />}
          AI vẽ ảnh
        </button>
        <button
          onClick={onDelete}
          disabled={disabled || busyAny}
          className="flex items-center gap-1 text-xs font-medium text-red-600 hover:bg-red-50 px-2 py-1.5 rounded-lg transition-colors disabled:opacity-50 ml-auto"
          title="Xoá nhân vật"
        >
          {busy === "delete" ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

function CharacterForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: CharacterRow | null;
  onClose: () => void;
  onSaved: (row: CharacterRow) => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [kind, setKind] = useState<CharacterKind>(initial?.kind || "nguoi");
  const [promptDescription, setPromptDescription] = useState(initial?.promptDescription || "");
  const [personality, setPersonality] = useState(initial?.personality || "");
  const [catchphrase, setCatchphrase] = useState(initial?.catchphrase || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const input: CharacterInput = {
      name,
      kind,
      promptDescription,
      personality: personality || undefined,
      catchphrase: catchphrase || undefined,
    };
    try {
      const row = initial ? await updateCharacter(initial.id, input) : await createCharacter(input);
      onSaved(row);
    } catch (e: any) {
      setError(e?.message || "Lưu nhân vật thất bại.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-stone-100">
          <h3 className="font-semibold text-stone-800 font-display">
            {initial ? `Sửa nhân vật — ${initial.name}` : "Thêm nhân vật mới"}
          </h3>
          <button onClick={onClose} className="p-1.5 text-stone-400 hover:bg-stone-100 rounded-full" aria-label="Đóng">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="ch-name">Tên nhân vật</label>
            <input
              id="ch-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="ch-kind">Loại</label>
            <select
              id="ch-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as CharacterKind)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            >
              <option value="nguoi">Người</option>
              <option value="ai">AI</option>
              <option value="linh_vat">Linh vật</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="ch-prompt">
              Mô tả prompt (dán nguyên vào tool tạo ảnh — mục 2.4)
            </label>
            <textarea
              id="ch-prompt"
              required
              rows={4}
              value={promptDescription}
              onChange={(e) => setPromptDescription(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="ch-personality">
              Tính cách / vai kể chuyện
            </label>
            <textarea
              id="ch-personality"
              rows={2}
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="ch-catchphrase">
              Câu cửa miệng (tuỳ chọn)
            </label>
            <input
              id="ch-catchphrase"
              value={catchphrase}
              onChange={(e) => setCatchphrase(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            />
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          <button
            type="submit"
            disabled={saving}
            className="mt-2 flex items-center justify-center gap-2 bg-storm-600 hover:bg-storm-700 text-white text-sm font-medium rounded-lg py-2.5 disabled:opacity-60"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Lưu nhân vật
          </button>
        </form>
      </div>
    </div>
  );
}
