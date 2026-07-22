// One-time / idempotent seed script. Run manually via:
//   node --import tsx server/db/seed.ts   (or `npm run db:seed`)
//
// Seeds:
//   1. 5 nhân vật cố định + 5 AI + linh vật (từ shared/engine-data.ts, mục 2.4).
//   2. 1 rubric_versions mặc định (weights=1 mỗi tiêu chí, ngưỡng 16/12), active.
//   3. Vài tín hiệu demo (phòng khi chưa có MARKET_RADAR_MCP_TOKEN /
//      GROUP_INSIGHTS_MCP_TOKEN thật — xem server/services/*.client.ts).
//   4. (Optional) admin account từ ADMIN_SEED_USERNAME/PASSWORD, nếu set.
//
// KHÔNG PHÁ HUỶ dữ liệu: chỉ INSERT bản ghi CHƯA CÓ, TUYỆT ĐỐI không UPDATE đè
// dữ liệu người dùng đã chỉnh (mô tả nhân vật, ảnh reference...). An toàn chạy
// lại nhiều lần. (Trước đây seedCharacters update đè mỗi lần deploy → mất chỉnh
// sửa của người dùng; đã sửa 2026-07-21.)
import dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { getDb, getPool, isDbConfigured } from "./client";
import { characters, rubricVersions, signals, styles, users } from "./schema";
import { hashPassword } from "../password";
import { CHARACTERS, RUBRIC_DEFAULT_WEIGHTS, RUBRIC_DEFAULT_THRESHOLDS } from "../../shared/engine-data";

dotenv.config();

async function seedCharacters() {
  const db = getDb();
  let inserted = 0;
  for (const c of CHARACTERS) {
    const [existing] = await db.select().from(characters).where(eq(characters.name, c.name));
    if (existing) continue; // ĐÃ CÓ → giữ nguyên (không đè mô tả/ảnh người dùng chỉnh).
    await db.insert(characters).values({
      name: c.name,
      kind: c.kind,
      promptDescription: c.promptDescription,
      personality: c.personality,
      catchphrase: c.catchphrase,
      referenceImageUrl: null, // chưa có ảnh — generate qua "AI vẽ ảnh"/"Vẽ cả bộ".
    });
    inserted++;
  }
  console.log(`[seed] characters: thêm ${inserted} nhân vật mới (giữ nguyên ${CHARACTERS.length - inserted} đã có).`);
}

async function seedRubric() {
  const db = getDb();
  const existingActive = await db.select().from(rubricVersions).where(eq(rubricVersions.isActive, true));
  if (existingActive.length > 0) {
    console.log("[seed] rubric_versions: đã có version active, bỏ qua.");
    return;
  }
  await db.insert(rubricVersions).values({
    weightsJson: RUBRIC_DEFAULT_WEIGHTS,
    thresholdsJson: RUBRIC_DEFAULT_THRESHOLDS,
    note: "Rubric mặc định — trọng số bằng nhau, ngưỡng 16/12 theo spec v3.",
    isActive: true,
    createdBy: "system-seed",
  });
  console.log("[seed] rubric_versions: tạo version mặc định OK.");
}

async function seedDemoSignals() {
  const db = getDb();
  const existing = await db.select().from(signals);
  if (existing.length > 0) {
    console.log(`[seed] signals: đã có ${existing.length} tín hiệu, bỏ qua seed demo.`);
    return;
  }
  const now = Date.now();
  const daysAgo = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000);

  const demo = [
    {
      source: "market_radar",
      radar: "marketing-kd",
      truc: "ai",
      title: "Cộng đồng than phiền ChatGPT trả lời dài dòng, hay bịa số liệu",
      rawSummary:
        "Nhiều bài đăng trong nhóm marketing than AI viết báo cáo 4000 chữ, review bằng niềm tin vì không ai đọc hết, phát hiện bịa số liệu sau khi trình sếp.",
      sourceUrl: null,
      publishedDate: daysAgo(1),
      status: "new",
      scoreJson: {},
    },
    {
      source: "market_radar",
      radar: "ke-toan",
      truc: "ke_toan",
      title: "Deadline quyết toán thuế TNCN đang tới gần, kế toán than chạy KPI",
      rawSummary:
        "Radar kế toán ghi nhận tần suất bài đăng tăng về hạn nộp tờ khai, sếp đi công tác chưa ký kịp hồ sơ giảm trừ gia cảnh.",
      sourceUrl: null,
      publishedDate: daysAgo(2),
      status: "queued",
      // Lưu ý: `total` chỉ cộng 4 tiêu chí (do_nong, do_cham, do_hop_truc,
      // tuoi_tho) — mỗi tiêu chí thang 1-5 nên tổng tối đa = 20 (khớp
      // ngưỡng ≥16/20 ở PRD §4 FR2.2). `do_an_toan` là CỔNG pass/fail
      // (dính nhóm ⛔ mục 3.3 = loại thẳng), không cộng vào tổng — xem
      // server/services/rubric-scoring.ts.
      scoreJson: {
        do_nong: 5,
        do_cham: 5,
        do_hop_truc: 4,
        tuoi_tho: 4,
        do_an_toan: 5,
        total: 18,
        dinh_nhom_cam: false,
        scored_by: "system-seed",
      },
    },
    {
      source: "group_insights",
      radar: "Group Dev & Sysadmin Việt Nam",
      truc: "hosting",
      title: "Cluster than phiền domain hết hạn không nhận email nhắc, mất domain oan",
      rawSummary:
        "Cross-group cluster: nhiều thớt kể chuyện quên gia hạn domain dù đã nhận 12 email nhắc, domain bị người khác mua lại.",
      sourceUrl: null,
      publishedDate: daysAgo(3),
      status: "queued",
      scoreJson: {
        do_nong: 4,
        do_cham: 5,
        do_hop_truc: 5,
        tuoi_tho: 4,
        do_an_toan: 5,
        total: 18,
        dinh_nhom_cam: false,
        scored_by: "system-seed",
      },
    },
    {
      source: "manual",
      radar: null,
      truc: "hosting",
      title: "[P0 demo] Sự cố hạ tầng toàn cầu — CDN lớn báo downtime diện rộng",
      rawSummary:
        "Nhập tay theo FR1.3: sự cố hạ tầng toàn cầu chưa có nguồn tự động, ví dụ minh hoạ mức ưu tiên P0 (ra bài trong 2h).",
      sourceUrl: null,
      publishedDate: daysAgo(0),
      status: "new",
      scoreJson: {},
      createdBy: "system-seed",
    },
    {
      source: "market_radar",
      radar: "marketing-kd",
      truc: "ai",
      title: "Trend chê Copilot tự mời, không tắt được trong Office",
      rawSummary:
        "Dân văn phòng đùa Copilot xuất hiện dù không gọi, giải pháp nó gợi ý toàn là lập thêm file Excel theo dõi.",
      sourceUrl: null,
      publishedDate: daysAgo(10),
      status: "idea_bank",
      scoreJson: {
        do_nong: 3,
        do_cham: 4,
        do_hop_truc: 4,
        tuoi_tho: 3,
        do_an_toan: 5,
        total: 14, // 3+4+4+3=14, nằm trong khoảng kho ý tưởng 12-15
        dinh_nhom_cam: false,
        scored_by: "system-seed",
      },
    },
  ] as const;

  for (const s of demo) {
    await db.insert(signals).values({
      source: s.source,
      radar: s.radar,
      truc: s.truc,
      title: s.title,
      rawSummary: s.rawSummary,
      sourceUrl: s.sourceUrl,
      publishedDate: s.publishedDate,
      status: s.status,
      scoreJson: s.scoreJson,
      createdBy: (s as any).createdBy ?? null,
    });
  }
  console.log(`[seed] signals: tạo ${demo.length} tín hiệu demo OK (dùng khi chưa có MCP token thật).`);
}

// Phong cách mặc định (seed) — mỗi phong cách = styleJson mô tả cấu trúc, chưa
// có ảnh minh hoạ (referenceImageUrl=null; sinh sau bằng /generate-reference).
// NON-DESTRUCTIVE: chỉ INSERT khi CHƯA có phong cách isDefault nào.
const DEFAULT_STYLES: { name: string; styleJson: Record<string, string> }[] = [
  {
    name: "Comic hành động",
    styleJson: {
      medium: "western comic book art blended with manga action energy",
      linework: "bold heavy black inks, dynamic tapered outlines",
      shading: "cross-hatching and halftone dots, high contrast",
      color_palette: "vivid saturated colors, strong primary accents",
      effects: "action speed lines, impact bursts, onomatopoeia shapes",
      mood: "dramatic, high-energy, cinematic lighting",
    },
  },
  {
    name: "Màu nước webcomic",
    styleJson: {
      medium: "soft watercolor webcomic",
      linework: "clean thin ink outlines",
      shading: "gentle watercolor washes, minimal gradients",
      color_palette: "warm muted tones on off-white paper",
      effects: "paper texture, soft edges",
      mood: "warm, friendly, slice-of-life",
    },
  },
  {
    name: "Hoạt hình phẳng",
    styleJson: {
      medium: "flat vector cartoon",
      linework: "bold clean uniform outlines",
      shading: "flat solid color fills, minimal shading",
      color_palette: "bright solid colors, modern sticker look",
      effects: "simple geometric shapes",
      mood: "playful, modern, clean",
    },
  },
  {
    name: "Manga đen trắng",
    styleJson: {
      medium: "black and white manga",
      linework: "expressive clean linework, varied line weight",
      shading: "screentone dot shading, hatching",
      color_palette: "monochrome black and white, high contrast",
      effects: "speed lines, emotive manga effects",
      mood: "expressive, dramatic, inky",
    },
  },
];

async function seedStyles() {
  const db = getDb();
  const existingDefault = await db.select().from(styles).where(eq(styles.isDefault, true));
  if (existingDefault.length > 0) {
    console.log(`[seed] styles: đã có ${existingDefault.length} phong cách mặc định, bỏ qua.`);
    return;
  }
  for (const s of DEFAULT_STYLES) {
    await db.insert(styles).values({
      owner: "system",
      isShared: true,
      isDefault: true,
      name: s.name,
      styleJson: s.styleJson,
      referenceImageUrl: null,
    });
  }
  console.log(`[seed] styles: tạo ${DEFAULT_STYLES.length} phong cách mặc định OK (mặc định: "${DEFAULT_STYLES[0].name}").`);
}

async function seedAdminUser() {
  const username = process.env.ADMIN_SEED_USERNAME;
  const password = process.env.ADMIN_SEED_PASSWORD;
  if (!username || !password) {
    console.log("[seed] ADMIN_SEED_USERNAME/PASSWORD không set — bỏ qua tạo tài khoản admin.");
    return;
  }
  const db = getDb();
  const passwordHash = hashPassword(password);
  const [existing] = await db.select().from(users).where(eq(users.username, username));
  if (existing) {
    // KHÔNG reset mật khẩu/role của tài khoản đã có (tránh đè mật khẩu người
    // dùng đã đổi mỗi lần deploy). Quản lý tài khoản qua menu Quản trị.
    console.log(`[seed] users: admin "${username}" đã tồn tại — giữ nguyên (không reset).`);
    return;
  }
  await db.insert(users).values({ username, passwordHash, role: "admin" });
  console.log(`[seed] users: tạo tài khoản admin "${username}" OK.`);
}

async function main() {
  if (!isDbConfigured()) {
    console.error("[seed] DATABASE_URL chưa cấu hình — không thể seed.");
    process.exit(1);
  }
  await seedCharacters();
  await seedRubric();
  await seedDemoSignals();
  await seedStyles();
  await seedAdminUser();
  console.log("[seed] Done.");
  await getPool().end();
}

main().catch((e) => {
  console.error("[seed] Lỗi:", e?.message || e);
  process.exit(1);
});
