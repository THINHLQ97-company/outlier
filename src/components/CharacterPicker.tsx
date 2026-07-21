import { UserRound } from "lucide-react";
import { imageDisplayUrl } from "../services/http";
import type { CharacterRow } from "../types";

// Multi-select dàn nhân vật — dùng chung cho Studio (vẽ tự do) và ImageStudio
// (chọn nhân vật tuỳ chọn trước khi sinh ảnh từ kịch bản). Hiện avatar
// (imageDisplayUrl(referenceImageUrl), placeholder icon nếu chưa có ảnh) +
// tên, click để chọn/bỏ chọn. Cho phép chọn 0 nhân vật.
interface Props {
  characters: CharacterRow[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}

export default function CharacterPicker({ characters, selectedIds, onToggle }: Props) {
  if (characters.length === 0) {
    return <p className="text-xs text-stone-400">Chưa có nhân vật nào trong thư viện.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {characters.map((c) => {
        const selected = selectedIds.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onToggle(c.id)}
            aria-pressed={selected}
            className={`flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full border text-sm transition-colors ${
              selected ? "border-storm-500 bg-storm-50 text-storm-800" : "border-stone-200 bg-white text-stone-600 hover:border-storm-300"
            }`}
          >
            <span className="w-7 h-7 rounded-full overflow-hidden bg-stone-100 border border-stone-200 shrink-0 flex items-center justify-center">
              {c.referenceImageUrl ? (
                <img src={imageDisplayUrl(c.referenceImageUrl) || undefined} alt="" className="w-full h-full object-cover" />
              ) : (
                <UserRound className="w-4 h-4 text-stone-300" aria-hidden="true" />
              )}
            </span>
            {c.name}
          </button>
        );
      })}
    </div>
  );
}
