import type { GenerateContentResponse } from "@google/genai";
import type { TrendSettings } from "./trend-workflow-settings";

export class TrendBudgetExceeded extends Error {
  constructor() { super("Đã chạm trần lượt gọi model của lượt chạy hoặc trong ngày."); }
}
export class TrendLeaseLost extends Error {
  constructor() { super("Mất lease/fencing token; dừng lượt chạy để tránh ghi chồng."); }
}
export type WorkflowModelCall = (request: {
  model: string; contents: any; config: Record<string, any>;
}) => Promise<GenerateContentResponse>;
export const workflowModelCall: WorkflowModelCall = async request => {
  const { GoogleGenAI } = await import("@google/genai");
  // SDK retry cũng tạo request tính phí; tắt để chỉ bộ đếm này được retry.
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!, httpOptions: { retryOptions: { attempts: 1 } } });
  return ai.models.generateContent(request);
};
export async function withDeadline<T>(work: () => Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([work(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Lời gọi model quá thời gian cho phép.")), ms);
    })]);
  } finally { clearTimeout(timer); }
}
/** Mỗi HTTP attempt, kể cả fallback, phải reserve TRƯỚC khi gọi SDK. */
export function createTrendModelBudget(config: TrendSettings, reserve: () => Promise<boolean>, fence: () => Promise<void>, call: WorkflowModelCall = workflowModelCall) {
  let stopped: Error | null = null;
  const invoke = async (prompt: any, extra: Record<string, any> = {}) => {
    if (stopped) throw stopped;
    if (call === workflowModelCall && !process.env.GEMINI_API_KEY) throw new Error("Chưa cấu hình GEMINI_API_KEY; không gọi model.");
    const models = [...new Set([config.model, process.env.GEMINI_TEXT_MODEL_FALLBACK].filter(Boolean))] as string[];
    for (let index = 0; index < models.length; index++) {
      await fence();
      if (!await reserve()) { stopped = new TrendBudgetExceeded(); throw stopped; }
      try {
        const response = await withDeadline(() => call({ model: models[index], contents: prompt, config: {
          ...extra, maxOutputTokens: config.maxOutputTokens,
          httpOptions: { timeout: config.modelTimeoutMs, retryOptions: { attempts: 1 } },
        } }), config.modelTimeoutMs);
        await fence();
        return response;
      } catch (error: any) {
        if (error instanceof TrendLeaseLost || error instanceof TrendBudgetExceeded) throw error;
        // Chỉ fallback khi model không tồn tại; không nhân request khi timeout/quota.
        if (index + 1 === models.length || !(error?.status === 404 || /not found|unknown model|not supported/i.test(error?.message || ""))) throw error;
      }
    }
    throw new Error("Chưa cấu hình model.");
  };
  return {
    invoke,
    text: async (prompt: string) => (await invoke(prompt)).text || "",
    assertActive: () => { if (stopped) throw stopped; },
  };
}
