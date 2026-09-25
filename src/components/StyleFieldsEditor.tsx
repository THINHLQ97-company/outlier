import { useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import {
  STYLE_FIELD_SPECS,
  STYLE_GROUPS,
  missingKeyStyleFields,
  type StyleFieldSpec,
} from "../../shared/style-fields";

// Soạn tay các trường nét vẽ của một phong cách.
//
// Vì sao cần sửa tay khi đã có AI phân tích ảnh: phân tích đọc được cái NHÌN
// THẤY, không đọc được cái người chủ MUỐN. Ảnh mẫu có nền gradient thì AI ghi
// "gradient background", trong khi ý người chủ là nền phẳng — chỉ sửa tay mới
// chỉnh được. Và trường then chốt AI bỏ trống thì phải có chỗ điền vào.
//
// Trường hiện theo nhóm, mỗi ô kèm đúng câu hỏi nó trả lời (hint) làm placeholder
// — người dùng không phải đoán "rendering" nghĩa là gì.

function valueToInput(v: unknown, kind: StyleFieldSpec["kind"]): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(kind === "list" ? ", " : "; ");
  return String(v);
}

export default function StyleFieldsEditor({
  value,
  onChange,
}: {
  value: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
}) {
  // Mở sẵn nhóm đầu; các nhóm sau thu lại để form không dài quá một màn.
  const [open, setOpen] = useState<Set<string>>(new Set([STYLE_GROUPS[0]]));
  const missing = new Set(missingKeyStyleFields(value).map((f) => f.key));

  function toggle(group: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  function setField(spec: StyleFieldSpec, raw: string) {
    const next = { ...value };
    const text = raw.trim();
    if (!text) delete next[spec.key];
    else if (spec.kind === "list") next[spec.key] = text.split(/[;,\n]/).map((s) => s.trim()).filter(Boolean);
    else next[spec.key] = text;
    onChange(next);
  }

  // Khoá không thuộc bộ chuẩn (phong cách cũ, hoặc Claude tự thêm qua MCP) —
  // hiện ra để biết là còn đó, thay vì im lặng làm người dùng tưởng đã mất.
  const extraKeys = Object.keys(value).filter((k) => !STYLE_FIELD_SPECS.some((f) => f.key === k));

  return (
    <div className="flex flex-col gap-2">
      {missing.size > 0 && (
        <div className="ds-alert ds-alert-warning !text-xs">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Còn {missing.size} trường then chốt chưa có. Thiếu những trường này thì mỗi lần vẽ ra một kiểu khác nhau —
            nên điền, hoặc bấm "Phân tích nét vẽ" để AI đọc từ ảnh minh hoạ.
          </span>
        </div>
      )}

      {STYLE_GROUPS.map((group) => {
        const specs = STYLE_FIELD_SPECS.filter((f) => f.group === group);
        const filled = specs.filter((f) => valueToInput(value[f.key], f.kind).trim()).length;
        const groupMissing = specs.filter((f) => missing.has(f.key)).length;
        const isOpen = open.has(group);
        return (
          <div key={group} className="border border-stone-200 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => toggle(group)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-stone-50"
              aria-expanded={isOpen}
            >
              {isOpen ? (
                <ChevronDown className="w-3.5 h-3.5 text-stone-400" aria-hidden="true" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-stone-400" aria-hidden="true" />
              )}
              <span className="text-sm font-medium text-stone-700 flex-1">{group}</span>
              <span className="text-[11px] text-stone-400">
                {filled}/{specs.length}
              </span>
              {groupMissing > 0 && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
                  thiếu {groupMissing}
                </span>
              )}
            </button>

            {isOpen && (
              <div className="px-3 pb-3 pt-1 flex flex-col gap-2.5 border-t border-stone-100">
                {specs.map((spec) => {
                  const id = `sty-f-${spec.key}`;
                  return (
                    <div key={spec.key}>
                      <label htmlFor={id} className="flex items-center gap-1.5 text-xs font-medium text-stone-600">
                        {spec.label}
                        {spec.key_field && (
                          <span
                            className="text-[10px] font-normal px-1 py-0.5 rounded bg-storm-50 text-storm-700"
                            title="Thiếu trường này thì vẽ lại lệch hẳn"
                          >
                            then chốt
                          </span>
                        )}
                      </label>
                      {spec.kind === "list" ? (
                        <input
                          id={id}
                          className="ds-input w-full mt-1 text-xs"
                          placeholder={spec.hint}
                          value={valueToInput(value[spec.key], spec.kind)}
                          onChange={(e) => setField(spec, e.target.value)}
                        />
                      ) : (
                        <textarea
                          id={id}
                          rows={2}
                          className="ds-input w-full mt-1 text-xs"
                          placeholder={spec.hint}
                          value={valueToInput(value[spec.key], spec.kind)}
                          onChange={(e) => setField(spec, e.target.value)}
                        />
                      )}
                      {spec.kind === "list" && (
                        <p className="text-[10px] text-stone-400 mt-0.5">Cách nhau bằng dấu phẩy.</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {extraKeys.length > 0 && (
        <div className="border border-stone-200 rounded-lg px-3 py-2">
          <p className="text-xs font-medium text-stone-600">Trường ngoài bộ chuẩn</p>
          <dl className="text-[11px] text-stone-500 mt-1 flex flex-col gap-0.5">
            {extraKeys.map((k) => (
              <div key={k} className="flex gap-1">
                <dt className="font-medium text-stone-600 shrink-0">{k}:</dt>
                <dd className="truncate">{valueToInput(value[k], "text")}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[10px] text-stone-400 mt-1">
            Vẫn được dùng khi vẽ. Sửa được qua Claude (MCP) bằng style_set.
          </p>
        </div>
      )}
    </div>
  );
}
