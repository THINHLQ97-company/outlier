import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

// Stateful Drizzle adapter mock. Executes predicates/CAS against rows, no sockets,
// no real Postgres or provider. This is not a substitute for staging SQL testing.
const dialect = new PgDialect();
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
export function mockDb(initial: Record<string, any[]> = {}) {
  const tables: Record<string, any[]> = initial;
  let sequence = 0;
  const rows = (table: any) => tables[getTableName(table)] ||= [];
  const matches = (row: any, predicate: any) => {
    if (!predicate) return true;
    const q = dialect.sqlToQuery(predicate);
    for (const m of q.sql.matchAll(/"[^"]+"\."([^"]+)" < "[^"]+"\."([^"]+)"/g)) if (!(row[camel(m[1])] < row[camel(m[2])])) return false;
    for (const m of q.sql.matchAll(/"[^"]+"\."([^"]+)" is not null/g)) if (row[camel(m[1])] == null) return false;
    const rx = /"([^"]+)"\."([^"]+)"\s*(=|>=|<=|<|>)\s*\$(\d+)|"([^"]+)"\."([^"]+)" in \(([^)]+)\)|"([^"]+)"\."([^"]+)" is null/g;
    for (const m of q.sql.matchAll(rx)) {
      const v = row[camel(m[2] || m[6] || m[9])];
      if (m[7]) { const values = [...m[7].matchAll(/\$(\d+)/g)].map(x => q.params[+x[1] - 1]); if (!values.includes(v)) return false; }
      else if (m[9]) { if (v != null) return false; }
      else { const raw: any = q.params[+m[4] - 1]; const p: any = v instanceof Date ? new Date(raw) : raw; if (!(m[3] === "=" ? v === p : m[3] === ">=" ? v >= p : m[3] === "<=" ? v <= p : m[3] === "<" ? v < p : v > p)) return false; }
    }
    return true;
  };
  const db: any = {
    transaction: async (fn: any) => fn(db),
    select: () => ({ from(table: any) {
      let predicate: any; let joined = false;
      const query: any = {
        where(p: any) { predicate = p; return query; }, orderBy() { return query; }, limit() { return query; }, offset() { return query; },
        innerJoin() { joined = true; return query; },
        for() { return query; },
        then(resolve: any, reject: any) { return Promise.resolve().then(() => {
          if (joined) return rows(table).filter(r => matches({ ...(tables.trend_workflow_runs || []).find(run => run.id === r.runId), ...r }, predicate)).map(r => ({ trend_workflow_items: { ...r } }));
          if (predicate && dialect.sqlToQuery(predicate).sql.includes('"created_at"') && getTableName(table) === "trend_workflow_runs") return [{ used: rows(table).reduce((n, r) => n + r.modelCalls, 0) }];
          return rows(table).filter(r => matches(r, predicate)).map(r => ({ ...r }));
        }).then(resolve, reject); },
      }; return query;
    } }),
    insert(table: any) { return { values(values: any) {
      let conflict: any;
      const execute = () => {
        const existing = rows(table).find(r => values.key ? r.key === values.key : values.slot ? r.slot === values.slot : values.inputKey ? r.runId === values.runId && r.inputKey === values.inputKey : false);
        if (existing) {
          if (conflict?.set && matches(existing, conflict.where)) { Object.assign(existing, values, { generation: existing.generation + 1 }); return [existing]; }
          return [];
        }
        const row = { id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`, attempts: 0, generation: 1, modelCalls: 0, apifyPosts: 0, status: "pending", brief: null, lastAttemptSlot: null, createdAt: new Date(), ...values };
        rows(table).push(row); return [row];
      };
      const q: any = { onConflictDoNothing() { return q; }, onConflictDoUpdate(c: any) { conflict = c; return q; }, returning: async () => execute(), then: (resolve: any) => Promise.resolve(execute()).then(resolve) }; return q;
    } }; },
    update(table: any) { return { set(patch: any) { return { where(predicate: any) {
      const execute = () => rows(table).filter(r => matches(r, predicate)).map(r => {
        for (const [key, value] of Object.entries(patch)) { if (value === undefined) continue;
          r[key] = value && typeof value === "object" && "queryChunks" in value ? (r[key] || 0) + 1 : value;
        } return { ...r };
      });
      return { returning: async () => execute(), then: (resolve: any) => Promise.resolve(execute()).then(resolve) };
    } }; } }; },
  };
  return { db, tables };
}
