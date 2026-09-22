#!/usr/bin/env python3
"""
Sidecar Douyin — cầu nối duy nhất bằng Python trong dự án Node này.

Vì sao phải giữ Python: thư viện f2 tự ký X-Bogus/a_bogus/msToken cho Douyin,
và không có bản tương đương cho Node. Viết lại phần chống bot đó bằng Node là
việc lớn và sẽ hỏng mỗi lần Douyin đổi thuật toán — không đáng.

Giao thức: nhận JSON qua stdin, trả JSON qua stdout. Không in gì khác ra stdout
để phía Node parse được sạch; log lỗi đi stderr.

  vào : {"action":"video","url":"...","cookieFile":"..."}
        {"action":"check","cookieFile":"..."}
  ra  : {"ok":true, ...} hoặc {"ok":false,"error":"..."}
"""
import asyncio
import contextlib
import io
import json
import os
import sys


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


# f2 in log lỗi thẳng ra stdout (kèm màu và xuống dòng), làm hỏng giao thức JSON
# của sidecar — phía Node sẽ không parse nổi. Giữ lại stdout thật để in kết quả,
# còn mọi thứ f2 in ra thì đẩy sang stderr.
_REAL_STDOUT = sys.stdout


def emit(obj: dict) -> None:
    """In kết quả JSON ra stdout THẬT, không lẫn log của thư viện."""
    print(json.dumps(obj, ensure_ascii=False), file=_REAL_STDOUT)


@contextlib.contextmanager
def quiet_stdout():
    """Nuốt mọi thứ thư viện in ra stdout trong khối này, chuyển sang stderr."""
    buf = io.StringIO()
    try:
        sys.stdout = buf
        yield
    finally:
        sys.stdout = _REAL_STDOUT
        noise = buf.getvalue().strip()
        if noise:
            print(noise[:2000], file=sys.stderr)


def cookies_header(path: str, domain_sub: str = "douyin") -> str:
    """Đọc file cookies.txt (định dạng Netscape) thành chuỗi 'a=1; b=2'."""
    if not path or not os.path.exists(path):
        return ""
    out = []
    with open(path, encoding="utf-8", errors="ignore") as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) >= 7 and domain_sub in parts[0]:
                out.append(f"{parts[5]}={parts[6]}")
    return "; ".join(out)


def crawler_kwargs(cookie: str) -> dict:
    return {
        "headers": {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ),
            "Referer": "https://www.douyin.com/",
        },
        "cookie": cookie,
        "proxies": {"http://": None, "https://": None},
        "timeout": 20,
        "max_retries": 2,
        "max_connections": 3,
        "max_tasks": 1,
    }


async def fetch_video(url: str, cookie: str) -> dict:
    from f2.apps.douyin.crawler import DouyinCrawler
    from f2.apps.douyin.model import PostDetail
    from f2.apps.douyin.filter import PostDetailFilter
    from f2.apps.douyin.utils import AwemeIdFetcher

    aweme_id = await AwemeIdFetcher.get_aweme_id(url)
    async with DouyinCrawler(crawler_kwargs(cookie)) as c:
        resp = await c.fetch_post_detail(PostDetail(aweme_id=aweme_id))

    v = PostDetailFilter(resp)
    # Douyin trả 200 kèm thân rỗng khi cookie hỏng — phải tự bắt, không thì
    # phía trên tưởng thành công mà dữ liệu trống trơn.
    if v.nickname is None:
        return {"ok": False, "error": "Douyin trả về rỗng — cookie đã hết hạn hoặc máy chủ bị chặn."}

    urls = v.video_play_addr or []
    return {
        "ok": True,
        "awemeId": aweme_id,
        "title": v.desc_raw or None,
        "channelName": v.nickname_raw or None,
        "durationSec": int(v.duration / 1000) if v.duration else None,
        "coverUrl": (v.video_cover or [None])[0] if hasattr(v, "video_cover") else None,
        "playUrl": urls[0] if urls else None,
        "likes": getattr(v, "digg_count", None),
        "comments": getattr(v, "comment_count", None),
        "shares": getattr(v, "share_count", None),
        "views": getattr(v, "play_count", None),
    }


async def main() -> int:
    try:
        req = json.loads(sys.stdin.read() or "{}")
    except Exception as e:
        emit({"ok": False, "error": f"Yêu cầu không hợp lệ: {e}"})
        return 1

    action = req.get("action") or "video"
    cookie_file = req.get("cookieFile") or os.environ.get("DOUYIN_COOKIES_FILE", "")
    cookie = cookies_header(cookie_file)

    if action == "check":
        # Kiểm tra nhanh: cookie đọc được không, và gọi thử một video công khai.
        info = {"cookieFile": cookie_file, "cookieChars": len(cookie)}
        if not cookie:
            emit({"ok": False, "error": "Chưa có cookie Douyin.", **info})
            return 0
        try:
            with quiet_stdout():
                r = await fetch_video(req.get("url") or "https://www.douyin.com/video/7346151242258996582", cookie)
            emit({**r, **info})
        except Exception as e:
            emit({"ok": False, "error": f"{type(e).__name__}: {e}"[:300], **info})
        return 0

    url = req.get("url") or ""
    if not url:
        emit({"ok": False, "error": "Thiếu url."})
        return 1
    if not cookie:
        emit({"ok": False, "error": "Chưa có cookie Douyin — xem docs/COOKIE-HUONG-DAN.md."})
        return 0

    try:
        with quiet_stdout():
            result = await fetch_video(url, cookie)
        emit(result)
    except Exception as e:
        log(f"douyin_fetch: {type(e).__name__}: {e}")
        emit({"ok": False, "error": f"{type(e).__name__}: {e}"[:300]})
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
