import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, Lasso, Eraser } from "lucide-react";

// "Circle to edit" — hiện ảnh + lớp canvas vẽ tay để khoanh vùng cần chỉnh/xóa.
// Khi bấm Chỉnh: nếu có vùng khoanh → dựng MASK (nền đen, vùng khoanh trắng) ở
// đúng độ phân giải gốc của ảnh và gửi kèm; không khoanh → chỉnh cả ảnh như cũ.
export default function ImageRegionEditor({
  imageUrl,
  aspectRatio,
  editing,
  onSubmit,
}: {
  imageUrl: string;
  aspectRatio: string;
  editing: boolean;
  onSubmit: (instruction: string, maskDataUrl: string | null) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [hasRegion, setHasRegion] = useState(false);
  const [instruction, setInstruction] = useState("");
  // Điểm vẽ theo toạ độ hiển thị (CSS px trong khung ảnh).
  const pointsRef = useRef<{ x: number; y: number }[]>([]);
  const drawingRef = useRef(false);

  // Đồng bộ kích thước canvas với ảnh hiển thị (để vẽ đúng vị trí con trỏ).
  function syncCanvasSize() {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const w = img.clientWidth;
    const h = img.clientHeight;
    if (w && h && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
      redraw();
    }
  }

  useEffect(() => {
    syncCanvasSize();
    const onResize = () => syncCanvasSize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Đổi ảnh (chỉnh xong) → xoá vùng cũ.
  useEffect(() => {
    clearRegion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  function redraw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const pts = pointsRef.current;
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = "rgba(217, 119, 87, 0.28)"; // cam đất, mờ
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(217, 119, 87, 0.95)";
    ctx.setLineDash([6, 4]);
    ctx.stroke();
  }

  function pointFromEvent(e: React.PointerEvent) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (!drawMode || editing) return;
    syncCanvasSize();
    drawingRef.current = true;
    pointsRef.current = [pointFromEvent(e)];
    (e.target as Element).setPointerCapture?.(e.pointerId);
    redraw();
  }
  function handlePointerMove(e: React.PointerEvent) {
    if (!drawingRef.current) return;
    pointsRef.current.push(pointFromEvent(e));
    redraw();
  }
  function handlePointerUp() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    setHasRegion(pointsRef.current.length >= 3);
  }

  function clearRegion() {
    pointsRef.current = [];
    setHasRegion(false);
    redraw();
  }

  // Dựng mask ở độ phân giải gốc của ảnh: nền đen, vùng khoanh trắng.
  function buildMask(): string | null {
    const img = imgRef.current;
    const pts = pointsRef.current;
    if (!img || pts.length < 3) return null;
    const natW = img.naturalWidth || img.clientWidth;
    const natH = img.naturalHeight || img.clientHeight;
    const sx = natW / img.clientWidth;
    const sy = natH / img.clientHeight;
    const mask = document.createElement("canvas");
    mask.width = natW;
    mask.height = natH;
    const ctx = mask.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, natW, natH);
    ctx.beginPath();
    ctx.moveTo(pts[0].x * sx, pts[0].y * sy);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * sx, pts[i].y * sy);
    ctx.closePath();
    ctx.fillStyle = "#fff";
    ctx.fill();
    return mask.toDataURL("image/png");
  }

  function handleSubmit() {
    if (!instruction.trim() || editing) return;
    const mask = hasRegion ? buildMask() : null;
    onSubmit(instruction.trim(), mask);
    setInstruction("");
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Thanh công cụ khoanh vùng */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setDrawMode((v) => !v)}
          aria-pressed={drawMode}
          className={`ds-btn ds-btn-sm ${drawMode ? "ds-btn-primary" : ""}`}
          title="Bật/tắt chế độ khoanh vùng — kéo chuột để khoanh chỗ cần chỉnh/xóa"
        >
          <Lasso className="w-3.5 h-3.5" aria-hidden="true" /> {drawMode ? "Đang khoanh vùng" : "Khoanh vùng"}
        </button>
        {hasRegion && (
          <button
            type="button"
            onClick={clearRegion}
            className="ds-btn ds-btn-sm hover:!text-red-600 hover:!border-red-300"
            title="Xoá vùng đã khoanh"
          >
            <Eraser className="w-3.5 h-3.5" aria-hidden="true" /> Xoá vùng
          </button>
        )}
        <span className="text-[11px] text-stone-400">
          {drawMode ? "Kéo chuột trên ảnh để khoanh vùng." : hasRegion ? "Đã khoanh 1 vùng — câu lệnh chỉ áp trong vùng đó." : "Không khoanh = chỉnh cả ảnh."}
        </span>
      </div>

      {/* Ảnh + lớp vẽ */}
      <div className="relative w-full max-w-sm select-none" style={{ touchAction: drawMode ? "none" : "auto" }}>
        <img
          ref={imgRef}
          src={imageUrl}
          alt="Ảnh hiện tại"
          onLoad={syncCanvasSize}
          className="w-full rounded-xl border border-stone-200 block"
          style={{ aspectRatio: (aspectRatio || "1:1").replace(":", " / ") }}
          draggable={false}
        />
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className={`absolute inset-0 w-full h-full rounded-xl ${drawMode ? "cursor-crosshair" : "pointer-events-none"}`}
        />
      </div>

      {/* Câu lệnh + nút Chỉnh */}
      <div className="flex items-start gap-2">
        <textarea
          rows={2}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          disabled={editing}
          placeholder={
            hasRegion
              ? "VD: xóa vật thể trong vùng này / thay bằng bàn làm việc..."
              : "VD: Grok đang quỳ lạy (không đứng), nền trắng, bỏ 2 nhân vật không xác định ở góc..."
          }
          className="ds-textarea flex-1"
        />
        <button
          onClick={handleSubmit}
          disabled={editing || !instruction.trim()}
          className="ds-btn ds-btn-primary shrink-0"
        >
          {editing ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Sparkles className="w-4 h-4" aria-hidden="true" />}
          Chỉnh
        </button>
      </div>
      {editing && (
        <p className="text-[11px] text-storm-600 flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Gemini đang chỉnh ảnh (thường 15–40 giây)...
        </p>
      )}
    </div>
  );
}
