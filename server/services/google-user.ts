// Giải quyết tài khoản từ hồ sơ Google (dùng chung cho login app + OAuth của MCP).
// Quy tắc cấp quyền: email trong GOOGLE_ADMIN_EMAILS → admin active ngay; email đã
// được duyệt (isActive) → cho vào; chưa có/chưa duyệt → tạo/giữ bản ghi "chờ duyệt".
import { eq } from "drizzle-orm";
import { users } from "../db/schema";
import { adminEmails, type GoogleProfile } from "./google-auth";

export interface ResolvedGoogleUser {
  user?: typeof users.$inferSelect;
  pending?: boolean; // true = tài khoản tồn tại/đã tạo nhưng chờ admin duyệt
  rejectedDomain?: boolean; // true = email ngoài domain cho phép, không tạo bản ghi
}

// Domain được phép tự đăng ký. Mặc định chỉ nội bộ Mắt Bão; đặt
// GOOGLE_ALLOWED_DOMAINS="matbao.com,doitac.vn" để mở thêm, hoặc "*" để tắt kiểm tra.
function allowedDomains(): string[] {
  const raw = (process.env.GOOGLE_ALLOWED_DOMAINS || "matbao.com").trim();
  return raw.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
}

export function domainAllowed(email: string): boolean {
  const domains = allowedDomains();
  if (domains.includes("*")) return true;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  return domains.includes(email.slice(at + 1).toLowerCase());
}

export async function resolveGoogleUser(db: any, profile: GoogleProfile): Promise<ResolvedGoogleUser> {
  const email = profile.email;
  const [existing] = await db.select().from(users).where(eq(users.email, email));

  // Admin allowlist (env) → luôn đảm bảo tài khoản admin active.
  if (adminEmails().includes(email)) {
    let user = existing;
    if (!user) {
      [user] = await db
        .insert(users)
        .values({ username: email, email, role: "admin", isActive: true, authProvider: "google", googleSub: profile.sub, avatarUrl: profile.picture })
        .returning();
    } else {
      [user] = await db
        .update(users)
        .set({ role: "admin", isActive: true, authProvider: "google", googleSub: profile.sub, avatarUrl: profile.picture, updatedAt: new Date() })
        .where(eq(users.id, existing.id))
        .returning();
    }
    return { user };
  }

  // Email ngoài domain cho phép và CHƯA có tài khoản → từ chối, không tạo bản ghi rác.
  // Cố ý chỉ áp cho tài khoản mới: người đã được admin duyệt trước đây (kể cả email
  // ngoài domain) vẫn đăng nhập được bình thường — siết bảo mật không được khoá
  // người đang dùng ra ngoài.
  if (!existing && !domainAllowed(email)) {
    console.warn(`[auth] từ chối đăng ký Google ngoài domain: ${email}`);
    return { rejectedDomain: true };
  }

  // Chưa có tài khoản → tạo "chờ duyệt".
  if (!existing) {
    await db
      .insert(users)
      .values({ username: email, email, role: "member", isActive: false, authProvider: "google", googleSub: profile.sub, avatarUrl: profile.picture })
      .returning();
    return { pending: true };
  }

  // Có nhưng chưa được duyệt → vẫn chờ (cập nhật thông tin Google mới nhất).
  if (!existing.isActive) {
    await db.update(users).set({ googleSub: profile.sub, avatarUrl: profile.picture, updatedAt: new Date() }).where(eq(users.id, existing.id));
    return { pending: true };
  }

  // Đã được duyệt → cho vào.
  const [user] = await db
    .update(users)
    .set({ googleSub: profile.sub, avatarUrl: profile.picture, authProvider: "google", updatedAt: new Date() })
    .where(eq(users.id, existing.id))
    .returning();
  return { user };
}
