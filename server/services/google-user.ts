// Giải quyết tài khoản từ hồ sơ Google (dùng chung cho login app + OAuth của MCP).
// Quy tắc cấp quyền: email trong GOOGLE_ADMIN_EMAILS → admin active ngay; email đã
// được duyệt (isActive) → cho vào; chưa có/chưa duyệt → tạo/giữ bản ghi "chờ duyệt".
import { eq } from "drizzle-orm";
import { users } from "../db/schema";
import { adminEmails, type GoogleProfile } from "./google-auth";

export interface ResolvedGoogleUser {
  user?: typeof users.$inferSelect;
  pending?: boolean; // true = tài khoản tồn tại/đã tạo nhưng chờ admin duyệt
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
