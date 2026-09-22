import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2, Link2, Link2Off, RefreshCw, ExternalLink, Star, Users } from "lucide-react";
import {
  addBrandFanpage,
  deleteBrandFanpage,
  connectFanpageMeta,
  disconnectFanpageMeta,
  syncFanpagePosts,
  setFanpageCharacters,
  type MetaSyncResult,
} from "../services/brands";
import { listCharacters } from "../services/characters";
import type { CharacterRow } from "../types";
import type { BrandFanpage } from "../types";
import FanpageStatsPanel from "./FanpageStatsPanel";

// Trang của CHÍNH thương hiệu — khác "Kênh theo dõi" (là kênh người khác để học).
//
// Nối được Meta thì đọc bài của page mình qua Graph API: miễn phí, đầy đủ, và
// bóc tính cách ra có câu trích từ bài thật có link. Không nối thì vẫn dùng
// được, chỉ là phải khai tay hoặc trả tiền Apify để đọc page của chính mình.

const PLATFORM_LABEL: Record<string, string> = {
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  instagram: "Instagram",
  threads: "Threads",
  zalo: "Zalo",
};

function formatDate(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function BrandFanpages({
  brandId,
  fanpages,
  canEdit,
  onChanged,
}: {
  brandId: string;
  fanpages: BrandFanpage[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [newUrl, setNewUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mỗi trang có thể đang chạy một việc riêng, nên trạng thái bận lưu theo id
  // chứ không dùng một cờ chung — bấm quét trang này không được làm đơ trang kia.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tokenFor, setTokenFor] = useState<string | null>(null);
  const [token, setToken] = useState("");
  // Link dạng facebook.com/tenpage thường đoán được, nhưng không phải lúc nào
  // cũng vậy — cho nhập thẳng Page ID thay vì để người dùng bí.
  const [pageId, setPageId] = useState("");
  const [syncResult, setSyncResult] = useState<MetaSyncResult | null>(null);

  // Thư viện nhân vật dùng chung cho mọi trang trong hồ sơ này — tải một lần.
  const [allCharacters, setAllCharacters] = useState<CharacterRow[]>([]);
  const [charsFor, setCharsFor] = useState<string | null>(null);
  useEffect(() => {
    listCharacters()
      .then(setAllCharacters)
      // Không có thư viện nhân vật thì phần còn lại vẫn dùng được bình thường.
      .catch(() => setAllCharacters([]));
  }, []);

  async function toggleCharacter(fp: BrandFanpage, characterId: string) {
    const current = fp.characterIds || [];
    const next = current.includes(characterId)
      ? current.filter((id) => id !== characterId)
      : [...current, characterId];
    setBusyId(fp.id);
    setError(null);
    try {
      await setFanpageCharacters(brandId, fp.id, next);
      onChanged();
    } catch (e: any) {
      setError(e?.message || "Không gán được nhân vật.");
    } finally {
      setBusyId(null);
    }
  }


  async function handleAdd() {
    const url = newUrl.trim();
    if (!url) return;
    setAdding(true);
    setError(null);
    try {
      await addBrandFanpage(brandId, { pageUrl: url });
      setNewUrl("");
      onChanged();
    } catch (e: any) {
      setError(e?.message || "Không thêm được trang.");
    } finally {
      setAdding(false);
    }
  }

  async function handleConnect(fp: BrandFanpage) {
    const value = token.trim();
    if (!value) return;
    setBusyId(fp.id);
    setError(null);
    try {
      const out = await connectFanpageMeta(brandId, fp.id, value, pageId.trim() || undefined);
      setToken("");
      setPageId("");
      setTokenFor(null);
      setError(null);
      onChanged();
      setSyncResult(null);
      alert(`Đã nối với "${out.page.name}". Giờ bấm "Quét bài về" để lấy bài của trang.`);
    } catch (e: any) {
      // Lỗi từ Meta nói khá rõ (token hết hạn, thiếu quyền, sai page) nên hiện
      // nguyên văn thay vì thay bằng câu chung chung.
      setError(e?.message || "Không nối được với Meta.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSync(fp: BrandFanpage) {
    setBusyId(fp.id);
    setError(null);
    setSyncResult(null);
    try {
      setSyncResult(await syncFanpagePosts(brandId, fp.id, 100));
      onChanged();
    } catch (e: any) {
      setError(e?.message || "Không quét được bài.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDisconnect(fp: BrandFanpage) {
    setBusyId(fp.id);
    try {
      await disconnectFanpageMeta(brandId, fp.id);
      onChanged();
    } catch (e: any) {
      setError(e?.message || "Không ngắt được kết nối.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(fp: BrandFanpage) {
    if (!confirm(`Xoá trang "${fp.pageName || fp.pageUrl}" khỏi hồ sơ?`)) return;
    setBusyId(fp.id);
    try {
      await deleteBrandFanpage(brandId, fp.id);
      onChanged();
    } catch (e: any) {
      setError(e?.message || "Không xoá được trang.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="ds-card">
      <div className="ds-card-body">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h3 className="font-bold text-stone-800">Trang của thương hiệu</h3>
          <p className="text-xs text-stone-400">
            Nơi thương hiệu tự đăng bài — khác “Kênh theo dõi” (kênh người khác để học).
          </p>
        </div>

        {canEdit && (
          <div className="flex gap-2 mt-3">
            <input
              className="ds-input flex-1"
              placeholder="Dán link fanpage, ví dụ https://facebook.com/tenpage"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              aria-label="Link trang của thương hiệu"
            />
            <button onClick={handleAdd} disabled={adding || !newUrl.trim()} className="ds-btn ds-btn-primary">
              {adding ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Plus className="w-4 h-4" aria-hidden="true" />}
              Thêm trang
            </button>
          </div>
        )}

        {error && (
          <div role="alert" className="ds-alert ds-alert-danger mt-3">
            {error}
          </div>
        )}

        {syncResult && (
          <div role="status" className="ds-alert ds-alert-success mt-3">
            Đã lấy {syncResult.postCount} bài của “{syncResult.pageName}” ({Math.round(syncResult.charCount / 1000)}k ký tự)
            {syncResult.videoRatio > 0 && ` · ${Math.round(syncResult.videoRatio * 100)}% là video`}. Bấm{" "}
            <strong>Bóc hồ sơ</strong> bên dưới để rút tính cách từ chính bài của trang.
          </div>
        )}

        {fanpages.length === 0 ? (
          <div className="ds-empty mt-3">
            <p>Chưa gắn trang nào.</p>
            <p className="text-xs text-stone-400 mt-1">
              Gắn fanpage bạn đang quản lý, rồi nối Meta để công cụ đọc bài của chính trang và tự rút ra tính cách.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2 mt-3">
            {fanpages.map((fp) => {
              const busy = busyId === fp.id;
              const connected = !!fp.metaConnectedAt;
              return (
                <li key={fp.id} className="border border-stone-200 rounded-xl p-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex gap-3">
                      {fp.metaPictureUrl && (
                        <img
                          src={fp.metaPictureUrl}
                          alt=""
                          className="w-11 h-11 rounded-full object-cover shrink-0 bg-stone-100"
                          loading="lazy"
                        />
                      )}
                      <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {fp.isPrimary && <Star className="w-3.5 h-3.5 text-amber-500" aria-label="Trang chính" />}
                        <span className="font-semibold text-stone-800 truncate">{fp.pageName || fp.pageUrl}</span>
                        <span className="ds-badge">{PLATFORM_LABEL[fp.platform] || fp.platform}</span>
                        {connected ? (
                          <span className="ds-badge ds-badge-success">Đã nối Meta</span>
                        ) : (
                          <span className="ds-badge">Chưa nối</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-stone-400 flex-wrap">
                        <a href={fp.pageUrl} target="_blank" rel="noreferrer" className="hover:underline inline-flex items-center gap-0.5">
                          Mở trang <ExternalLink className="w-3 h-3" aria-hidden="true" />
                        </a>
                        {fp.followerCount != null && <span>{fp.followerCount.toLocaleString("vi-VN")} người theo dõi</span>}
                        {fp.metaCategory && <span>{fp.metaCategory}</span>}
                        {fp.metaLastSyncAt && (
                          <span>
                            Quét lần cuối {formatDate(fp.metaLastSyncAt)}
                            {fp.metaLastPostCount != null && ` · ${fp.metaLastPostCount} bài`}
                          </span>
                        )}
                      </div>
                      {fp.metaAbout && (
                        <p className="text-[11px] text-stone-500 mt-1 line-clamp-2">{fp.metaAbout}</p>
                      )}
                      </div>
                    </div>

                    {canEdit && (
                      <div className="flex items-center gap-2 shrink-0">
                        {connected ? (
                          <>
                            <button onClick={() => handleSync(fp)} disabled={busy} className="ds-btn ds-btn-primary ds-btn-sm">
                              {busy ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                              ) : (
                                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                              )}
                              Quét bài về
                            </button>
                            <button
                              onClick={() => handleDisconnect(fp)}
                              disabled={busy}
                              className="ds-btn ds-btn-ghost ds-btn-sm"
                              title="Xoá token đã lưu"
                            >
                              <Link2Off className="w-3.5 h-3.5" aria-hidden="true" /> Ngắt
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setTokenFor(tokenFor === fp.id ? null : fp.id)}
                            className="ds-btn ds-btn-secondary ds-btn-sm"
                          >
                            <Link2 className="w-3.5 h-3.5" aria-hidden="true" /> Nối Meta
                          </button>
                        )}
                        <button
                          onClick={() => setCharsFor(charsFor === fp.id ? null : fp.id)}
                          className="ds-btn ds-btn-ghost ds-btn-sm"
                          title="Gán nhân vật đại diện cho trang này"
                        >
                          <Users className="w-3.5 h-3.5" aria-hidden="true" />
                          Nhân vật{(fp.characterIds?.length || 0) > 0 ? ` (${fp.characterIds!.length})` : ""}
                        </button>
                        <button
                          onClick={() => handleDelete(fp)}
                          disabled={busy}
                          className="text-xs font-medium text-red-600 hover:bg-red-50 px-2 py-1.5 rounded-lg transition-colors"
                          title="Xoá trang khỏi hồ sơ"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>

                  {tokenFor === fp.id && !connected && (
                    <div className="mt-3 pt-3 border-t border-stone-200">
                      <label htmlFor={`token-${fp.id}`} className="block text-xs font-medium text-stone-600">
                        Page Access Token
                      </label>
                      <p className="text-[11px] text-stone-400 mt-0.5">
                        Lấy ở Meta Graph API Explorer: chọn đúng page, cấp quyền{" "}
                        <code className="bg-stone-100 px-1 rounded">pages_read_engagement</code>. Token được kiểm tra
                        trước khi lưu, và lưu ở dạng mã hoá.
                      </p>
                      <input
                        id={`token-${fp.id}`}
                        type="password"
                        className="ds-input w-full font-mono text-xs mt-2"
                        placeholder="EAAG..."
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        autoComplete="off"
                      />

                      <label htmlFor={`pageid-${fp.id}`} className="block text-xs font-medium text-stone-600 mt-3">
                        Page ID <span className="font-normal text-stone-400">— bỏ trống nếu link đã có mã số</span>
                      </label>
                      <div className="flex gap-2 mt-1">
                        <input
                          id={`pageid-${fp.id}`}
                          className="ds-input flex-1 font-mono text-xs"
                          placeholder="Ví dụ 1234567890"
                          value={pageId}
                          onChange={(e) => setPageId(e.target.value)}
                          autoComplete="off"
                        />
                        <button
                          onClick={() => handleConnect(fp)}
                          disabled={busy || !token.trim()}
                          className="ds-btn ds-btn-primary ds-btn-sm"
                        >
                          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : null}
                          Kiểm tra và nối
                        </button>
                      </div>
                      <p className="text-[11px] text-stone-400 mt-1.5">
                        Cách nhanh nhất lấy cả hai: trong Graph API Explorer gọi{" "}
                        <code className="bg-stone-100 px-1 rounded">me/accounts?fields=id,name,access_token</code> —
                        kết quả có sẵn mã page và token của từng trang bạn quản lý.
                      </p>
                    </div>
                  )}

                  {charsFor === fp.id && (
                    <div className="mt-3 pt-3 border-t border-stone-200">
                      <h4 className="text-xs font-semibold text-stone-700">Nhân vật đại diện của trang</h4>
                      <p className="text-[11px] text-stone-400 mt-0.5">
                        Gán xong thì lúc vẽ ảnh cho bài, ảnh mẫu của nhân vật được đưa vào làm chuẩn — nhân vật
                        giữ nguyên ngoại hình qua các bài thay vì mỗi bài một kiểu.
                      </p>
                      {allCharacters.length === 0 ? (
                        <p className="text-xs text-stone-400 mt-2">
                          Thư viện nhân vật đang trống. Thêm ở menu Nhân vật trước.
                        </p>
                      ) : (
                        <ul className="flex flex-wrap gap-2 mt-2">
                          {allCharacters.map((c) => {
                            const picked = (fp.characterIds || []).includes(c.id);
                            return (
                              <li key={c.id}>
                                <button
                                  onClick={() => toggleCharacter(fp, c.id)}
                                  disabled={busy}
                                  aria-pressed={picked}
                                  className={`flex items-center gap-2 border rounded-lg px-2 py-1.5 transition-colors ${
                                    picked
                                      ? "border-storm-500 bg-storm-50"
                                      : "border-stone-200 hover:border-stone-300"
                                  }`}
                                >
                                  {c.referenceImageUrl ? (
                                    <img
                                      src={c.referenceImageUrl}
                                      alt=""
                                      className="w-7 h-7 rounded-full object-cover bg-stone-100"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <span
                                      className="w-7 h-7 rounded-full bg-stone-100 shrink-0"
                                      aria-hidden="true"
                                    />
                                  )}
                                  <span className="text-xs font-medium text-stone-700">{c.name}</span>
                                  {!c.referenceImageUrl && (
                                    <span className="text-[10px] text-amber-600" title="Chưa có ảnh mẫu">
                                      chưa có ảnh
                                    </span>
                                  )}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}

                  {fp.metaStatsJson && <FanpageStatsPanel stats={fp.metaStatsJson} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
