import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Download } from "lucide-react";
import type { OverlayConfig, TextBox } from "../types";

// FR4.3 — Text-overlay editor: kéo-thả text box lên ảnh (HTML5 Canvas thuần,
// không thư viện ngoài — ưu tiên đơn giản chạy được), watermark góc dưới phải
// opacity ~60%. Toạ độ text box lưu dạng phân số (0-1) của canvas gốc để
// export PNG cuối luôn đúng tỉ lệ bất kể kích thước hiển thị.
//
// B2.3 — canvas theo đúng tỉ lệ khung đã chọn khi VẼ (aspectRatio, xem
// overlayJson.aspectRatio). Chiều rộng giữ cố định (BASE_W/DISPLAY_W), chiều
// cao tính theo tỉ lệ H/W tương ứng. Toạ độ x,y vẫn là phân số (0-1) nên vẫn
// đúng — chỉ cần nhân đúng chiều (x → *_W, y → *_H).
const BASE_W = 1024;
const DISPLAY_W = 480;
// H/W theo từng tỉ lệ khung (label "W:H" → số học H/W).
const ASPECT_RATIO_HW: Record<string, number> = {
  "1:1": 1 / 1,
  "3:4": 4 / 3,
  "9:16": 16 / 9,
};

interface Props {
  imageUrl: string;
  initialOverlay: OverlayConfig;
  watermarkOptions: string[];
  onExport: (overlay: OverlayConfig, finalImageDataUrl: string) => void;
  exporting?: boolean;
  aspectRatio?: string;
}

function measureBoxSize(ctx: CanvasRenderingContext2D, box: TextBox, scale: number) {
  ctx.font = `700 ${box.fontSize * scale}px "Be Vietnam Pro", "Inter", sans-serif`;
  const width = Math.max(ctx.measureText(box.text || "Nhãn").width, box.width * scale);
  const height = box.fontSize * scale * 1.4;
  return { width, height };
}

export default function TextOverlayEditor({
  imageUrl,
  initialOverlay,
  watermarkOptions,
  onExport,
  exporting,
  aspectRatio = "1:1",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [textBoxes, setTextBoxes] = useState<TextBox[]>(initialOverlay.textBoxes?.length ? initialOverlay.textBoxes : []);
  const [watermarkBrand, setWatermarkBrand] = useState(initialOverlay.watermarkBrand || watermarkOptions[0] || "MATBAO");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dragState = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);

  const ratioHW = ASPECT_RATIO_HW[aspectRatio] ?? 1;
  const BASE_H = Math.round(BASE_W * ratioHW);
  const DISPLAY_H = Math.round(DISPLAY_W * ratioHW);
  // Tỉ lệ display/base giống hệt cho cả 2 trục (DISPLAY_W/BASE_W ===
  // DISPLAY_H/BASE_H, vì cả hai đều nhân cùng ratioHW) nên 1 scale dùng
  // chung cho font-size/measure là đủ.
  const scale = DISPLAY_W / BASE_W;

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      draw();
    };
    img.src = imageUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textBoxes, watermarkBrand, aspectRatio]);

  function draw() {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, DISPLAY_W, DISPLAY_H);
    if (img) ctx.drawImage(img, 0, 0, DISPLAY_W, DISPLAY_H);
    else {
      ctx.fillStyle = "#e7e5e4";
      ctx.fillRect(0, 0, DISPLAY_W, DISPLAY_H);
    }

    textBoxes.forEach((box) => {
      ctx.save();
      const x = box.x * DISPLAY_W;
      const y = box.y * DISPLAY_H;
      const { width, height } = measureBoxSize(ctx, box, scale);
      // nền trắng bo góc nhẹ để chữ luôn đọc được trên nền ảnh bất kỳ
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.fillRect(x - 6, y - height + 6, width + 12, height);
      if (box.id === selectedId) {
        ctx.strokeStyle = "#c66545"; // storm-600 (tông cam đất, xem src/index.css)
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 8, y - height + 4, width + 16, height + 4);
      }
      ctx.fillStyle = box.color || "#1e1b2e";
      ctx.font = `700 ${box.fontSize * scale}px "Be Vietnam Pro", "Inter", sans-serif`;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(box.text || "Nhãn", x, y);
      ctx.restore();
    });

    // Watermark góc dưới phải, opacity ~60% (mục 2.4 v3.md — bắt buộc).
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${22 * scale}px "Inter", sans-serif`;
    const wmWidth = ctx.measureText(watermarkBrand).width;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(DISPLAY_W - wmWidth - 28, DISPLAY_H - 22 * scale - 22, wmWidth + 16, 22 * scale + 12);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(watermarkBrand, DISPLAY_W - wmWidth - 20, DISPLAY_H - 16);
    ctx.restore();
  }

  function hitTest(px: number, py: number): TextBox | null {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return null;
    for (let i = textBoxes.length - 1; i >= 0; i--) {
      const box = textBoxes[i];
      const x = box.x * DISPLAY_W;
      const y = box.y * DISPLAY_H;
      const { width, height } = measureBoxSize(ctx, box, scale);
      if (px >= x - 8 && px <= x + width + 8 && py >= y - height + 4 && py <= y + 8) return box;
    }
    return null;
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const hit = hitTest(px, py);
    if (hit) {
      setSelectedId(hit.id);
      dragState.current = { id: hit.id, offsetX: px - hit.x * DISPLAY_W, offsetY: py - hit.y * DISPLAY_H };
    } else {
      setSelectedId(null);
    }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!dragState.current) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const { id, offsetX, offsetY } = dragState.current;
    const nx = Math.min(1, Math.max(0, (px - offsetX) / DISPLAY_W));
    const ny = Math.min(1, Math.max(0.03, (py - offsetY) / DISPLAY_H));
    setTextBoxes((prev) => prev.map((b) => (b.id === id ? { ...b, x: nx, y: ny } : b)));
  }

  function handleMouseUp() {
    dragState.current = null;
  }

  function addTextBox() {
    const id = `tb-${Date.now()}`;
    const box: TextBox = { id, x: 0.1, y: 0.2, width: 200, fontSize: 32, text: "Nhãn mới", color: "#1e1b2e", align: "left" };
    setTextBoxes((prev) => [...prev, box]);
    setSelectedId(id);
  }

  function updateSelected(patch: Partial<TextBox>) {
    setTextBoxes((prev) => prev.map((b) => (b.id === selectedId ? { ...b, ...patch } : b)));
  }

  function removeSelected() {
    setTextBoxes((prev) => prev.filter((b) => b.id !== selectedId));
    setSelectedId(null);
  }

  function handleExport() {
    const off = document.createElement("canvas");
    off.width = BASE_W;
    off.height = BASE_H;
    const ctx = off.getContext("2d")!;
    const img = imgRef.current;
    if (img) ctx.drawImage(img, 0, 0, BASE_W, BASE_H);
    else {
      ctx.fillStyle = "#e7e5e4";
      ctx.fillRect(0, 0, BASE_W, BASE_H);
    }
    textBoxes.forEach((box) => {
      const x = box.x * BASE_W;
      const y = box.y * BASE_H;
      ctx.font = `700 ${box.fontSize}px "Be Vietnam Pro", "Inter", sans-serif`;
      const width = Math.max(ctx.measureText(box.text || "Nhãn").width, box.width);
      const height = box.fontSize * 1.4;
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.fillRect(x - 12, y - height + 12, width + 24, height);
      ctx.fillStyle = box.color || "#1e1b2e";
      ctx.fillText(box.text || "Nhãn", x, y);
    });
    ctx.globalAlpha = 0.6;
    ctx.font = `700 46px "Inter", sans-serif`;
    const wmWidth = ctx.measureText(watermarkBrand).width;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(BASE_W - wmWidth - 56, BASE_H - 46 - 40, wmWidth + 32, 46 + 24);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(watermarkBrand, BASE_W - wmWidth - 40, BASE_H - 34);
    ctx.globalAlpha = 1;

    const dataUrl = off.toDataURL("image/png");
    onExport({ textBoxes, watermarkBrand, aspectRatio }, dataUrl);
  }

  const selected = textBoxes.find((b) => b.id === selectedId) || null;

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <canvas
        ref={canvasRef}
        width={DISPLAY_W}
        height={DISPLAY_H}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="rounded-xl border border-stone-300 shrink-0 cursor-move bg-stone-100"
        role="img"
        aria-label="Canvas chỉnh sửa text overlay lên ảnh"
      />
      <div className="flex flex-col gap-3 flex-1 min-w-[220px]">
        <button
          onClick={addTextBox}
          className="flex items-center justify-center gap-1.5 text-sm font-medium text-storm-700 bg-storm-50 hover:bg-storm-100 px-3 py-2 rounded-lg"
        >
          <Plus className="w-4 h-4" aria-hidden="true" /> Thêm nhãn (≤ 8 từ)
        </button>

        {selected ? (
          <div className="flex flex-col gap-2 bg-stone-50 rounded-lg p-3 border border-stone-200">
            <label className="text-xs font-medium text-stone-600" htmlFor="tb-text">Nội dung nhãn</label>
            <input
              id="tb-text"
              value={selected.text}
              onChange={(e) => updateSelected({ text: e.target.value })}
              className="w-full rounded-lg border border-stone-300 px-2.5 py-1.5 text-sm"
            />
            <label className="text-xs font-medium text-stone-600" htmlFor="tb-size">Cỡ chữ</label>
            <input
              id="tb-size"
              type="range"
              min={20}
              max={64}
              value={selected.fontSize}
              onChange={(e) => updateSelected({ fontSize: Number(e.target.value) })}
              className="accent-storm-600"
            />
            <button
              onClick={removeSelected}
              className="flex items-center justify-center gap-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg mt-1"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Xoá nhãn
            </button>
          </div>
        ) : (
          <p className="text-xs text-stone-400">Bấm vào 1 nhãn trên ảnh để chỉnh, hoặc kéo-thả để đổi vị trí.</p>
        )}

        <div>
          <label className="text-xs font-medium text-stone-600 block mb-1" htmlFor="wm-brand">Watermark</label>
          <select
            id="wm-brand"
            value={watermarkBrand}
            onChange={(e) => setWatermarkBrand(e.target.value)}
            className="w-full rounded-lg border border-stone-300 px-2.5 py-1.5 text-sm"
          >
            {watermarkOptions.map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>
        </div>

        <button
          onClick={handleExport}
          disabled={exporting}
          className="mt-2 flex items-center justify-center gap-2 bg-storm-600 hover:bg-storm-700 text-white text-sm font-medium rounded-lg py-2.5 disabled:opacity-60"
        >
          <Download className="w-4 h-4" aria-hidden="true" /> Export ảnh cuối + lưu
        </button>
      </div>
    </div>
  );
}
