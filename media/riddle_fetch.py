#!/usr/bin/env python3
"""
Sidecar sinh cách đọc lệch cho tên miền không dấu.

Bọc quanh `lai_engine.py` (lấy từ skill domain-riddle-engine). Bản gốc in
selftest và tiêu đề ra stdout — y hệt lỗi đã gặp với f2 — nên phải chặn lại,
chỉ để JSON đi ra stdout thật.

  vào : {"chuoi":"dieutoichu"}  hoặc  {"chuoi":["a","b"]}
  ra  : {"ok":true,"results":[{chuoi, ngat_tu, dat_lai_dau, noi_lai, ghi_chu}]}
"""
import contextlib
import io
import json
import os
import sys

_REAL_STDOUT = sys.stdout


def emit(obj: dict) -> None:
    print(json.dumps(obj, ensure_ascii=False), file=_REAL_STDOUT)


@contextlib.contextmanager
def quiet_stdout():
    """Nuốt mọi thứ thư viện in ra stdout, đẩy sang stderr."""
    buf = io.StringIO()
    try:
        sys.stdout = buf
        yield
    finally:
        sys.stdout = _REAL_STDOUT
        noise = buf.getvalue().strip()
        if noise:
            print(noise[:2000], file=sys.stderr)


def main() -> int:
    try:
        req = json.loads(sys.stdin.read() or "{}")
    except Exception as e:
        emit({"ok": False, "error": f"Yêu cầu không hợp lệ: {e}"})
        return 1

    raw = req.get("chuoi")
    items = [raw] if isinstance(raw, str) else (raw if isinstance(raw, list) else [])
    items = [str(x).strip() for x in items if str(x).strip()][:50]
    if not items:
        emit({"ok": False, "error": "Thiếu chuỗi cần sinh cách đọc."})
        return 0

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        with quiet_stdout():
            from lai_engine import sinh_cach_doc
    except Exception as e:
        emit({"ok": False, "error": f"Không nạp được bộ sinh: {type(e).__name__}: {e}"[:250]})
        return 0

    out = []
    for s in items:
        try:
            with quiet_stdout():
                out.append(sinh_cach_doc(s))
        except Exception as e:
            out.append({"chuoi": s, "error": f"{type(e).__name__}: {e}"[:200]})
    emit({"ok": True, "results": out})
    return 0


if __name__ == "__main__":
    sys.exit(main())
