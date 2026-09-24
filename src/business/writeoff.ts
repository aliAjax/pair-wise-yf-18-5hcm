// 业务文件二：核销判断
// 纯领域逻辑，不接触 React / DOM / 存储：回执核对、冲突判定与处理、
// 核销执行、核销前改配、台账统计与尺寸筛选。所有函数直接改写传入的台账对象，
// 由交互层先深拷贝再调用，保证状态可追溯。

import type {
  Conflict,
  ConflictResolution,
  ConflictType,
  Ledger,
  Order,
  Receipt,
  ReceiptEntry,
  Stone,
  StoneShape,
} from "./ledger";

export const SHAPES: StoneShape[] = ["圆形", "椭圆", "梨形", "祖母绿切"];
export const ARTISANS = ["周师傅", "李师傅", "王师傅"];
export const BATCHES = ["PC-0901", "PC-0902", "PC-0903", "PC-0904"];

export const SIZE_BUCKETS: { key: string; label: string; test: (mm: number) => boolean }[] = [
  { key: "all", label: "全部尺寸", test: () => true },
  { key: "small", label: "≤2.5mm", test: (mm) => mm <= 2.5 },
  { key: "mid", label: "2.6–4.0mm", test: (mm) => mm > 2.5 && mm <= 4.0 },
  { key: "large", label: ">4.0mm", test: (mm) => mm > 4.0 },
];

export type ScopeKey = "pending" | "finished" | "reallocated" | "written";
export const SCOPES: { key: ScopeKey; label: string }[] = [
  { key: "pending", label: "待镶" },
  { key: "finished", label: "成品清单" },
  { key: "reallocated", label: "改配待核" },
  { key: "written", label: "已核销回执" },
];

// ---------------------------------------------------------------- 基础查询

export function findOrder(ledger: Ledger, orderId: string): Order | undefined {
  return ledger.orders.find((o) => o.id === orderId);
}

export function orderStones(ledger: Ledger, orderId: string): Stone[] {
  return ledger.stones.filter((s) => s.orderId === orderId);
}

/** 开新回执时可引用的原单裸石：仍在待镶且未被改配摘出。 */
export function pendingStones(ledger: Ledger, orderId: string): Stone[] {
  return orderStones(ledger, orderId).filter((s) => s.status === "待镶" && !s.reallocated);
}

export function receiptConflicts(ledger: Ledger, receiptId: string): Conflict[] {
  return ledger.conflicts.filter((c) => c.receiptId === receiptId);
}

export function openConflicts(ledger: Ledger, receiptId: string): Conflict[] {
  return receiptConflicts(ledger, receiptId).filter((c) => !c.resolved);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------- 回执创建 / 删除

export function createReceipt(
  ledger: Ledger,
  draft: {
    orderId: string;
    deliveredAt: string;
    artisan: string;
    finishedCount: number;
    note?: string;
    entries: ReceiptEntry[];
  },
): Receipt {
  assert(findOrder(ledger, draft.orderId), "请选择绑定订单");
  assert(draft.deliveredAt.trim() !== "", "请填写交付时间");
  assert(draft.artisan.trim() !== "", "请填写师傅");
  assert(draft.finishedCount >= 0, "成品数不能为负");
  assert(draft.entries.length > 0, "原单已无待镶裸石，不能开回执");

  ledger.receiptSeq += 1;
  const receipt: Receipt = {
    id: `HZ-${ledger.receiptSeq}`,
    orderId: draft.orderId,
    deliveredAt: draft.deliveredAt,
    artisan: draft.artisan,
    finishedCount: draft.finishedCount,
    note: draft.note?.trim() || undefined,
    status: "待处理",
    createdAt: new Date().toISOString(),
    entries: draft.entries.map((e) => ({ ...e })),
  };
  ledger.receipts.unshift(receipt);
  return receipt;
}

export function deleteReceipt(ledger: Ledger, receiptId: string): void {
  const receipt = ledger.receipts.find((r) => r.id === receiptId);
  assert(receipt, "回执不存在");
  assert(receipt.status !== "已核销", "已核销回执不能删除");
  ledger.receipts = ledger.receipts.filter((r) => r.id !== receiptId);
  ledger.conflicts = ledger.conflicts.filter((c) => c.receiptId !== receiptId);
}

// ---------------------------------------------------------------- 逐颗核对

function addConflict(
  list: Conflict[],
  base: Omit<Conflict, "id" | "resolved" | "detail"> & { detail: string },
): void {
  list.push({ id: `C-${base.receiptId}-${base.stoneId ?? base.kind}-${Date.now()}-${list.length}`, resolved: false, ...base });
}

/**
 * 裸石按原单逐颗核对：
 * - 缺件：师傅报缺件 → 列缺件冲突，挡核销
 * - 编号不符：实际编号在台账中查不到，或已不在待镶
 * - 串单：实际编号属于别的订单
 * - 报成品数与成品条目数不一致 → 缺件类冲突
 */
export function checkReceipt(ledger: Ledger, receiptId: string): Receipt {
  const receipt = ledger.receipts.find((r) => r.id === receiptId);
  assert(receipt, "回执不存在");
  assert(receipt.status !== "已核销", "回执已核销，无需再核对");

  // 重新核对：清掉上一轮冲突记录（含已处理的），冲突以最新一次核对为准
  ledger.conflicts = ledger.conflicts.filter((c) => c.receiptId !== receiptId);
  const fresh: Conflict[] = [];

  const stoneMap = new Map(ledger.stones.map((s) => [s.id, s]));

  for (const entry of receipt.entries) {
    const expected = stoneMap.get(entry.stoneId);

    if (entry.result === "缺件") {
      addConflict(fresh, {
        receiptId,
        orderId: receipt.orderId,
        kind: "缺件",
        stoneId: entry.stoneId,
        detail: `师傅报缺件，原单裸石 ${entry.stoneId} 未随成品交付`,
      });
      continue;
    }

    if (entry.result === "改配") {
      // 主动改配不属于冲突，但目标必须有效
      const target = entry.target;
      if (!target || (!findOrder(ledger, target) && target !== "return")) {
        addConflict(fresh, {
          receiptId,
          orderId: receipt.orderId,
          kind: "编号不符",
          stoneId: entry.stoneId,
          detail: `裸石 ${entry.stoneId} 标记改配，但未选择有效去向`,
        });
      }
      continue;
    }

    // result === "成品"
    if (!expected) {
      addConflict(fresh, {
        receiptId,
        orderId: receipt.orderId,
        kind: "编号不符",
        stoneId: entry.stoneId,
        detail: `原单裸石 ${entry.stoneId} 在台账中不存在`,
      });
      continue;
    }

    const actualId = entry.actualId.trim();
    if (!actualId) {
      addConflict(fresh, {
        receiptId,
        orderId: receipt.orderId,
        kind: "编号不符",
        stoneId: entry.stoneId,
        detail: `裸石 ${entry.stoneId} 报成品但未填实际镶嵌编号`,
      });
      continue;
    }

    if (actualId === entry.stoneId) {
      if (expected.status !== "待镶" || expected.reallocated) {
        addConflict(fresh, {
          receiptId,
          orderId: receipt.orderId,
          kind: "编号不符",
          stoneId: entry.stoneId,
          detail: `裸石 ${entry.stoneId} 当前为「${expected.reallocated ? "已改配" : expected.status}」，无法按成品核对`,
        });
      }
      continue;
    }

    // 实际编号与原单编号不符
    const actual = stoneMap.get(actualId);
    if (!actual) {
      addConflict(fresh, {
        receiptId,
        orderId: receipt.orderId,
        kind: "编号不符",
        stoneId: entry.stoneId,
        actualId,
        detail: `实际镶嵌编号 ${actualId} 在台账中查不到（原单应为 ${entry.stoneId}）`,
      });
    } else if (actual.orderId !== receipt.orderId) {
      addConflict(fresh, {
        receiptId,
        orderId: receipt.orderId,
        kind: "串单",
        stoneId: entry.stoneId,
        actualId,
        detail: `实际镶嵌编号 ${actualId} 属于订单 ${actual.orderId}，疑似串单`,
      });
    } else {
      addConflict(fresh, {
        receiptId,
        orderId: receipt.orderId,
        kind: "编号不符",
        stoneId: entry.stoneId,
        actualId,
        detail: `实际镶嵌编号 ${actualId} 属于同单另一颗，与原单 ${entry.stoneId} 不符`,
      });
    }
  }

  const finishedEntries = receipt.entries.filter((e) => e.result === "成品").length;
  if (receipt.finishedCount !== finishedEntries) {
    addConflict(fresh, {
      receiptId,
      orderId: receipt.orderId,
      kind: "缺件",
      countOnly: true,
      detail: `报成品数 ${receipt.finishedCount} 与成品条目 ${finishedEntries} 不一致，请核实缺件`,
    });
  }

  ledger.conflicts.push(...fresh);
  receipt.status = "已核对";
  receipt.resetReason = undefined;
  return receipt;
}

// ---------------------------------------------------------------- 冲突处理

export const CONFLICT_OPTIONS: Record<ConflictType, { value: ConflictResolution; label: string }[]> = {
  缺件: [{ value: "缺件核销", label: "确认缺件，按缺件核销" }],
  串单: [
    { value: "串单改配", label: "对方订单的裸石串到本单，按改配计入本单" },
    { value: "改正编号", label: "只是填错编号，改正为原单编号" },
  ],
  编号不符: [
    { value: "改正编号", label: "编号填错，改正为原单编号" },
    { value: "以核对为准", label: "裸石无误，以师傅核对为准放行" },
    { value: "改配核销", label: "原石已改配他用，本颗按改配核销" },
  ],
};

export function resolveConflict(
  ledger: Ledger,
  conflictId: string,
  resolution: ConflictResolution,
): void {
  const conflict = ledger.conflicts.find((c) => c.id === conflictId);
  assert(conflict, "冲突记录不存在");
  assert(!conflict.resolved, "该冲突已处理");
  conflict.resolved = true;
  conflict.resolution = resolution;
  conflict.resolvedAt = new Date().toISOString();
}

export function reopenConflict(ledger: Ledger, conflictId: string): void {
  const conflict = ledger.conflicts.find((c) => c.id === conflictId);
  assert(conflict, "冲突记录不存在");
  const receipt = ledger.receipts.find((r) => r.id === conflict.receiptId);
  assert(receipt && receipt.status !== "已核销", "已核销回执的冲突不能撤销");
  conflict.resolved = false;
  conflict.resolution = undefined;
  conflict.resolvedAt = undefined;
}

// ---------------------------------------------------------------- 核销

export function canWriteOff(ledger: Ledger, receiptId: string): { ok: boolean; reason?: string } {
  const receipt = ledger.receipts.find((r) => r.id === receiptId);
  if (!receipt) return { ok: false, reason: "回执不存在" };
  if (receipt.status === "已核销") return { ok: false, reason: "回执已核销" };
  if (receipt.status === "待处理") return { ok: false, reason: "请先逐颗核对" };
  const blocking = openConflicts(ledger, receiptId);
  if (blocking.length > 0) {
    return { ok: false, reason: `还有 ${blocking.length} 条冲突未处理，已挡下核销` };
  }
  return { ok: true };
}

/** 核销：缺件/改配的裸石从原单核销掉，成品计入成品清单。 */
export function writeOff(ledger: Ledger, receiptId: string): Receipt {
  const guard = canWriteOff(ledger, receiptId);
  assert(guard.ok, guard.reason ?? "当前不能核销");

  const receipt = ledger.receipts.find((r) => r.id === receiptId)!;
  const stoneMap = new Map(ledger.stones.map((s) => [s.id, s]));
  const findConflict = (kind: Conflict["kind"], stoneId?: string, actualId?: string) =>
    ledger.conflicts.find(
      (c) => c.receiptId === receiptId && c.kind === kind && c.stoneId === stoneId && (actualId === undefined || c.actualId === actualId),
    );

  for (const entry of receipt.entries) {
    const stone = stoneMap.get(entry.stoneId);

    if (entry.result === "缺件") {
      if (stone) {
        stone.status = "缺件";
        stone.reallocated = false;
        stone.reallocatedTo = undefined;
        stone.receiptId = receipt.id;
        stone.remark = "缺件核销";
      }
      continue;
    }

    if (entry.result === "改配") {
      if (stone) {
        stone.status = "缺件"; // 从本单角度核销，不再占用待镶数
        stone.reallocated = true;
        stone.reallocatedTo = entry.target;
        stone.reallocatedAt = receipt.deliveredAt;
        stone.receiptId = receipt.id;
        stone.remark = entry.target === "return" ? "退回配石仓" : `改配至 ${entry.target}`;
      }
      continue;
    }

    // 成品：确定真正交付的是哪颗裸石
    const actualId = entry.actualId.trim();
    const mismatch = actualId && actualId !== entry.stoneId ? findConflict("编号不符", entry.stoneId, actualId) : undefined;
    const swap = actualId && actualId !== entry.stoneId ? findConflict("串单", entry.stoneId, actualId) : undefined;

    if (swap?.resolved && swap.resolution === "串单改配") {
      // 别单裸石串到本单：实际那颗成为本单成品，原单那颗改配到本单
      const actual = stoneMap.get(actualId);
      if (actual) {
        const fromOrder = actual.orderId;
        actual.orderId = receipt.orderId;
        actual.status = "成品";
        actual.setAt = receipt.deliveredAt;
        actual.setBy = receipt.artisan;
        actual.receiptId = receipt.id;
        actual.remark = `串单改配（编号 ${actualId} 原属 ${fromOrder}）`;
      }
      if (stone) {
        stone.status = "缺件";
        stone.reallocated = true;
        stone.reallocatedTo = receipt.orderId;
        stone.reallocatedAt = receipt.deliveredAt;
        stone.receiptId = receipt.id;
        stone.remark = "串单改配至本回执订单";
      }
    } else if (mismatch?.resolved && mismatch.resolution === "以核对为准") {
      // 师傅确认交付的就是实际编号那颗（同单错号或补石）
      const actual = stoneMap.get(actualId);
      const target = actual ?? stone;
      if (target) {
        target.status = "成品";
        target.setAt = receipt.deliveredAt;
        target.setBy = receipt.artisan;
        target.receiptId = receipt.id;
        target.remark = actualId !== entry.stoneId ? `按核对编号 ${actualId} 核销` : undefined;
      }
      if (actual && stone && actual.id !== stone.id) {
        stone.status = "缺件";
        stone.reallocated = true;
        stone.reallocatedTo = receipt.orderId;
        stone.reallocatedAt = receipt.deliveredAt;
        stone.receiptId = receipt.id;
        stone.remark = `改配至 ${actualId}`;
      }
    } else {
      // 正常成品 / 改正编号 / 改配核销放行：以原单那颗为准
      if (stone) {
        stone.status = "成品";
        stone.setAt = receipt.deliveredAt;
        stone.setBy = receipt.artisan;
        stone.receiptId = receipt.id;
        stone.reallocated = false;
        stone.reallocatedTo = undefined;
      }
      // 改正编号情形下把条目实际编号回填，清单与原单保持一致
      if (actualId && actualId !== entry.stoneId) {
        entry.actualId = entry.stoneId;
      }
    }
  }

  receipt.status = "已核销";
  receipt.writtenOffAt = new Date().toISOString();
  return receipt;
}

// ---------------------------------------------------------------- 核销前改配

/**
 * 台账侧核销前改配：把一颗待镶裸石改配到其他订单 / 配石仓。
 * 该订单尚未核销（待处理或已核对）的回执全部退回待处理，需重新逐颗核对；
 * 冲突记录保留（重开仍在），重新核对时按最新台账重算。
 */
export function reallocateStone(
  ledger: Ledger,
  stoneId: string,
  target: string,
): { resetReceipts: string[] } {
  const stone = ledger.stones.find((s) => s.id === stoneId);
  assert(stone, "裸石不存在");
  assert(stone.status === "待镶", "只有待镶裸石可以改配");
  assert(target === "return" || !!findOrder(ledger, target), "改配去向无效");
  if (target !== "return") {
    assert(target !== stone.orderId, "不能改配到原订单");
  }

  stone.reallocated = true;
  stone.reallocatedTo = target;
  stone.reallocatedAt = new Date().toISOString();
  stone.remark = target === "return" ? "核销前改配：退回配石仓" : `核销前改配至 ${target}`;

  const resetReceipts: string[] = [];
  for (const receipt of ledger.receipts) {
    if (receipt.orderId === stone.orderId && receipt.status !== "已核销") {
      receipt.status = "待处理";
      receipt.resetReason = `裸石 ${stoneId} 核销前改配，原回执退回待处理，请重新逐颗核对`;
      resetReceipts.push(receipt.id);
    }
  }
  return { resetReceipts };
}

/** 改配待核的裸石被新订单回执核销后由 writeOff 走正常成品路径；此处提供撤销改配。 */
export function undoReallocation(ledger: Ledger, stoneId: string): void {
  const stone = ledger.stones.find((s) => s.id === stoneId);
  assert(stone, "裸石不存在");
  assert(stone.reallocated, "该裸石没有改配标记");
  assert(stone.status === "待镶", "已核销的改配不能撤销");
  stone.reallocated = false;
  stone.reallocatedTo = undefined;
  stone.reallocatedAt = undefined;
  stone.remark = undefined;
}

// ---------------------------------------------------------------- 统计与筛选

export interface LedgerStats {
  batchCount: number;
  pendingCount: number;
  pendingCarat: number;
  finishedCount: number;
  openConflictCount: number;
  pendingReceiptCount: number;
  defectCount: number;
}

export function getStats(ledger: Ledger): LedgerStats {
  const pending = ledger.stones.filter((s) => s.status === "待镶" && !s.reallocated);
  const batches = new Set(pending.map((s) => s.batch));
  return {
    batchCount: batches.size,
    pendingCount: pending.length,
    pendingCarat: pending.reduce((sum, s) => sum + s.carat, 0),
    finishedCount: ledger.stones.filter((s) => s.status === "成品").length,
    openConflictCount: ledger.conflicts.filter(
      (c) => !c.resolved && ledger.receipts.some((r) => r.id === c.receiptId && r.status !== "已核销"),
    ).length,
    pendingReceiptCount: ledger.receipts.filter((r) => r.status !== "已核销").length,
    defectCount: ledger.stones.filter((s) => !!s.defectNote).length,
  };
}

export interface StoneFilter {
  shape: StoneShape | "all";
  sizeBucket: string;
  batch: string;
  keyword: string;
}

export const EMPTY_FILTER: StoneFilter = { shape: "all", sizeBucket: "all", batch: "all", keyword: "" };

/** 待镶数 / 成品清单 / 改配待核三个视图共用筛选；尺寸筛选随核销结果同步变化。 */
export function selectStones(ledger: Ledger, scope: ScopeKey, filter: StoneFilter): Stone[] {
  const bucket = SIZE_BUCKETS.find((b) => b.key === filter.sizeBucket) ?? SIZE_BUCKETS[0];
  const kw = filter.keyword.trim().toLowerCase();

  return ledger.stones.filter((s) => {
    if (scope === "pending" && !(s.status === "待镶" && !s.reallocated)) return false;
    if (scope === "finished" && s.status !== "成品") return false;
    if (scope === "reallocated" && !(s.status === "待镶" && s.reallocated)) return false;
    if (scope === "written" && s.status === "待镶") return false;

    if (filter.shape !== "all" && s.shape !== filter.shape) return false;
    if (!bucket.test(s.sizeMm)) return false;
    if (filter.batch !== "all" && s.batch !== filter.batch) return false;
    if (kw) {
      const haystack = `${s.id} ${s.species} ${s.orderId} ${s.slot} ${s.remark ?? ""}`.toLowerCase();
      if (!haystack.includes(kw)) return false;
    }
    return true;
  });
}

/** 各尺寸桶在当前视图下的数量，供筛选 chips 同步显示。 */
export function sizeBucketCounts(ledger: Ledger, scope: ScopeKey, filter: StoneFilter): Record<string, number> {
  const base = selectStones(ledger, scope, { ...filter, sizeBucket: "all" });
  const counts: Record<string, number> = {};
  for (const bucket of SIZE_BUCKETS) {
    counts[bucket.key] = base.filter((s) => bucket.test(s.sizeMm)).length;
  }
  return counts;
}
