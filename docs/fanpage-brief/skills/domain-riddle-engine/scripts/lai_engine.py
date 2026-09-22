#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
lai_engine.py — Phần CƠ HỌC của domain-riddle-engine.

Nhiệm vụ: nhận một chuỗi tiếng Việt (không dấu, hoặc có dấu / có cách),
sinh ra các CÁCH ĐỌC theo 4 phép biến đổi:
    (a) đặt lại dấu   dat_lai_dau()
    (b) ngắt lại từ   ngat_tu()
    (c) nói lái       noi_lai()          <-- chuyện của ÂM, người hay bỏ sót
    (d) đọc tiếng khác  (chưa làm ở script — để LLM/thủ công bổ sung)

Không chấm điểm, không gắn nhãn an toàn, không tra tên miền — những việc đó
do skill (LLM) làm theo SKILL.md. Script chỉ lo phần máy tính làm tốt hơn người.

Python 3, không cần thư viện ngoài.

⚠️ HARDENING (việc cho Claude Code):
  - ngat_tu() hiện dùng "validator hình dạng âm tiết" (regex) nên OVER-ACCEPT
    (chấp nhận vài âm tiết vô nghĩa). Nên thay bằng WORDLIST tiếng Việt thật.
  - dat_lai_dau() liệt kê biến thể dấu; cũng cần wordlist để lọc cái có nghĩa.
  - noi_lai() sinh MỌI hoán vị; cần wordlist để giữ lại cái "đọc ra được".
  - Phép (d) đọc tiếng khác chưa có.
"""

import unicodedata
import itertools
import re
import sys
import json

# ------------------------------------------------------------------ #
#  Bảng thanh điệu (dấu) dưới dạng ký tự tổ hợp Unicode
# ------------------------------------------------------------------ #
TONE_CHAR = {0: "", 1: "́", 2: "̀", 3: "̉", 4: "̃", 5: "̣"}
#            ngang    sắc          huyền        hỏi          ngã          nặng
TONE_NAME = {0: "ngang", 1: "sắc", 2: "huyền", 3: "hỏi", 4: "ngã", 5: "nặng"}
TONE_OF_MARK = {v: k for k, v in TONE_CHAR.items() if v}

# Phụ âm đầu, xếp DÀI trước ngắn để bắt đúng (ngh trước ng trước n ...)
ONSETS = sorted(
    ["ngh", "ng", "nh", "ch", "gh", "gi", "kh", "ph", "qu", "th", "tr",
     "b", "c", "d", "đ", "g", "h", "k", "l", "m", "n", "p", "r", "s", "t", "v", "x"],
    key=len, reverse=True,
)

VOWELS = set("aăâeêioôơuưy")
OFFGLIDE = set("iyuo")          # bán nguyên âm cuối
CODAS = ["ch", "ng", "nh", "c", "m", "n", "p", "t"]  # dài trước ngắn
_RHYME_SHAPE = re.compile(r"^[aăâeêioôơuưy]{1,3}(?:ch|ng|nh|c|m|n|p|t)?$")


# ------------------------------------------------------------------ #
#  Tách / ghép âm tiết
# ------------------------------------------------------------------ #
def strip_quality(ch):
    """Trả về nguyên âm gốc bỏ mọi dấu (ê->e, ơ->o, ư->u, ă/â->a...)."""
    d = unicodedata.normalize("NFD", ch)
    return "".join(c for c in d if not unicodedata.combining(c))


def has_quality(ch):
    """True nếu nguyên âm mang dấu chất (mũ/móc/trăng): â ê ô ơ ư ă."""
    d = unicodedata.normalize("NFD", ch)
    return any(c in ("̂", "̆", "̛") for c in d[1:])


def cat_dau(s):
    """Cắt hết dấu (thanh + chất) -> chuỗi không dấu. đ->d."""
    s = s.replace("đ", "d").replace("Đ", "D")
    d = unicodedata.normalize("NFD", s)
    return "".join(c for c in d if not unicodedata.combining(c))


def decompose(syllable):
    """
    Tách 1 âm tiết -> (onset, rhyme_base, tone).
    rhyme_base giữ dấu chất (ê, ơ...) nhưng BỎ dấu thanh.
    """
    nfd = unicodedata.normalize("NFD", syllable.lower())
    tone, rest = 0, []
    for c in nfd:
        if c in TONE_OF_MARK:
            tone = TONE_OF_MARK[c]
        else:
            rest.append(c)
    base = unicodedata.normalize("NFC", "".join(rest))
    onset = ""
    for o in ONSETS:
        if base.startswith(o) and len(base) > len(o):  # phải còn vần
            onset = o
            break
    rhyme = base[len(onset):]
    return onset, rhyme, tone


def _main_vowel_index(rhyme):
    """Chỉ số nguyên âm sẽ nhận dấu thanh (luật đặt dấu 'kiểu cũ')."""
    chars = list(rhyme)
    vpos = [i for i, c in enumerate(chars) if strip_quality(c) in VOWELS]
    if not vpos:
        return None
    qpos = [i for i in vpos if has_quality(chars[i])]
    if qpos:
        return qpos[-1]          # có nguyên âm dấu-chất -> ưu tiên (ươ -> ơ)
    if len(vpos) == 1:
        return vpos[0]
    has_coda = (vpos[-1] != len(chars) - 1)   # sau nguyên âm cuối còn phụ âm
    if has_coda:
        return vpos[-1]          # có coda -> dấu trên nguyên âm cuối cụm
    last_v = strip_quality(chars[vpos[-1]])
    if last_v in OFFGLIDE and len(vpos) >= 2:
        return vpos[-2]          # mở, cuối là bán nguyên âm -> lùi 1 (ai->a, oai->a)
    return vpos[0]               # ua->u, ia->i, oa->o


def place_tone(rhyme, tone):
    """Đặt dấu thanh lên đúng nguyên âm của vần."""
    if not tone:
        return unicodedata.normalize("NFC", rhyme)
    idx = _main_vowel_index(rhyme)
    if idx is None:
        return unicodedata.normalize("NFC", rhyme)
    chars = list(rhyme)
    d = unicodedata.normalize("NFD", chars[idx]) + TONE_CHAR[tone]
    chars[idx] = unicodedata.normalize("NFC", d)
    return unicodedata.normalize("NFC", "".join(chars))


def recompose(onset, rhyme, tone):
    return onset + place_tone(rhyme, tone)


# ------------------------------------------------------------------ #
#  (b) NGẮT LẠI TỪ — tách chuỗi không dấu thành các âm tiết hợp lệ
# ------------------------------------------------------------------ #
def _is_syllable_shape(chunk):
    """Validator HÌNH DẠNG (chưa dùng wordlist) — over-accept, cần hardening."""
    onset = ""
    for o in ONSETS:
        if chunk.startswith(o) and len(chunk) > len(o):
            onset = o
            break
    rhyme = chunk[len(onset):]
    return bool(_RHYME_SHAPE.match(rhyme))


def ngat_tu(nospace, max_syllables=5):
    """Mọi cách tách chuỗi không dấu thành 2..max âm tiết hợp lệ về hình dạng."""
    s = cat_dau(nospace).lower().replace(" ", "")
    results = []

    def backtrack(rest, acc):
        if not rest:
            if 2 <= len(acc) <= max_syllables:
                results.append(" ".join(acc))
            return
        if len(acc) >= max_syllables:
            return
        for cut in range(1, len(rest) + 1):
            head = rest[:cut]
            if _is_syllable_shape(head):
                backtrack(rest[cut:], acc + [head])

    backtrack(s, [])
    # bỏ trùng, ưu tiên cách chia ÍT âm tiết (thường "đọc ra" hơn)
    seen, out = set(), []
    for r in sorted(results, key=lambda x: (x.count(" "), x)):
        if r not in seen:
            seen.add(r)
            out.append(r)
    return out


# ------------------------------------------------------------------ #
#  (a) ĐẶT LẠI DẤU — liệt kê biến thể dấu cho MỘT âm tiết không dấu
# ------------------------------------------------------------------ #
_QUALITY_VARIANTS = {
    "a": ["a", "ă", "â"], "e": ["e", "ê"], "o": ["o", "ô", "ơ"],
    "u": ["u", "ư"], "i": ["i"], "y": ["y"],
}


def dat_lai_dau(syllable_nodau):
    """
    Cho 1 âm tiết KHÔNG DẤU -> các cách bỏ dấu (thanh + chất) có hình dạng hợp lệ.
    LƯU Ý: over-generate; cần wordlist để giữ cái có nghĩa (hardening).
    """
    onset = ""
    base = syllable_nodau.lower()
    for o in [x for x in ONSETS if x != "đ"]:
        if base.startswith(o) and len(base) > len(o):
            onset = o
            break
    rhyme = base[len(onset):]
    # tách nguyên âm / coda
    m = re.match(r"^([aeiouy]+)([a-z]*)$", rhyme)
    if not m:
        return []
    vowels, coda = m.group(1), m.group(2)
    # sinh biến thể chất cho cụm nguyên âm
    choices = [_QUALITY_VARIANTS.get(v, [v]) for v in vowels]
    out = set()
    for combo in itertools.product(*choices):
        vform = "".join(combo)
        rh = vform + coda
        if not _RHYME_SHAPE.match(rh):
            continue
        for tone in range(6):
            out.add(recompose(onset, rh, tone))
    return sorted(out)


# ------------------------------------------------------------------ #
#  (c) NÓI LÁI — hoán vị trên CẶP âm tiết
# ------------------------------------------------------------------ #
def _pair_transforms(s1, s2):
    """Trả dict {tên_phép: (âm1, âm2)} cho một cặp âm tiết đã decompose."""
    o1, r1, t1 = s1
    o2, r2, t2 = s2
    return {
        "trao_van_thanh": (recompose(o1, r2, t2), recompose(o2, r1, t1)),  # kinh điển
        "trao_van":       (recompose(o1, r2, t1), recompose(o2, r1, t2)),
        "trao_thanh":     (recompose(o1, r1, t2), recompose(o2, r2, t1)),
        "trao_phu_am":    (recompose(o2, r1, t1), recompose(o1, r2, t2)),
        "dao_am_tiet":    (recompose(o2, r2, t2), recompose(o1, r1, t1)),  # đổi chỗ cả tiếng
    }


def noi_lai(phrase):
    """
    Nhận cụm (có/không dấu, có cách hoặc dính liền) -> mọi cách nói lái.
    Trả list dict: {phep, cap_index, ket_qua}.
    """
    # tách âm tiết: nếu có cách thì theo cách; nếu dính liền thì lấy cách ngắt đầu tiên
    if " " in phrase.strip():
        toks = phrase.strip().split()
    else:
        seg = ngat_tu(phrase)
        toks = seg[0].split() if seg else [phrase]
    sylls = [decompose(t) for t in toks]
    n = len(sylls)
    out = []
    for i, j in itertools.combinations(range(n), 2):
        trans = _pair_transforms(sylls[i], sylls[j])
        for name, (a, b) in trans.items():
            new = [recompose(*s) for s in sylls]
            new[i], new[j] = a, b
            out.append({"phep": name, "cap_index": [i, j], "ket_qua": " ".join(new)})
    # bỏ trùng
    seen, uniq = set(), []
    for r in out:
        key = (r["ket_qua"], r["phep"])
        if key not in seen:
            seen.add(key)
            uniq.append(r)
    return uniq


# ------------------------------------------------------------------ #
#  Gom tất cả cách đọc cho MỘT chuỗi tên miền
# ------------------------------------------------------------------ #
def sinh_cach_doc(chuoi):
    """Đầu ra thô để skill (LLM) chấm điểm + gắn nhãn. KHÔNG tự phán."""
    nospace = cat_dau(chuoi).replace(" ", "")
    cach_ngat = ngat_tu(nospace)
    # đặt lại dấu cho từng âm tiết của cách ngắt gọn nhất
    dat_dau = {}
    if cach_ngat:
        for syl in cach_ngat[0].split():
            dat_dau[syl] = dat_lai_dau(syl)
    lai = noi_lai(nospace)
    return {
        "chuoi": nospace,
        "ngat_tu": cach_ngat,
        "dat_lai_dau": dat_dau,
        "noi_lai": lai,
        "ghi_chu": "phép (d) đọc-tiếng-khác chưa có trong script; LLM bổ sung.",
    }


# ------------------------------------------------------------------ #
#  Tự kiểm tra (hai ví dụ chuẩn của anh Duy)
# ------------------------------------------------------------------ #
def _selftest():
    r1 = noi_lai("điều tới chụ")
    assert any(x["ket_qua"] == "đụ tới chiều" for x in r1), \
        "FAIL: 'điều tới chụ' phải lái ra 'đụ tới chiều'"
    r2 = noi_lai("cũ như ỹ")
    assert any(x["ket_qua"] == "ỹ như cũ" for x in r2), \
        "FAIL: 'cũ như ỹ' phải lái ra 'ỹ như cũ'"
    # đặt dấu đúng: 'chua' + huyền -> 'chùa' (không phải 'chuà')
    assert recompose("ch", "ua", 2) == "chùa", \
        "FAIL: đặt dấu 'ua' sai (bug cũ 'chuà')"
    assert recompose("", "iêu", 2) == "iều"
    print("✓ selftest OK: đụ tới chiều | ỹ như cũ | chùa | iều")


if __name__ == "__main__":
    _selftest()
    args = [a for a in sys.argv[1:]]
    if not args:
        print("\nDùng:  python3 lai_engine.py <chuỗi> [<chuỗi> ...]")
        print("Ví dụ: python3 lai_engine.py dichvutumat 'điều tới chụ' danhphan")
        sys.exit(0)
    for a in args:
        print("\n" + "=" * 60)
        print("CHUỖI:", a)
        print(json.dumps(sinh_cach_doc(a), ensure_ascii=False, indent=2))
