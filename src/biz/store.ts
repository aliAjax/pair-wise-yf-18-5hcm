// 台账存取：类型、种子数据、localStorage 读写与所有落库变更。
// 纯数据层，不含核销判断（见 receipt.ts）与页面交互（见 pages.tsx）。

export type StoneStatus = "pending" | "set" | "missing" | "lost";
// pending 待镶 / set 已镶成品 / missing 缺件核销 / lost 串单转出本单

export type StoneKind = "主石" | "围石" | "配石";

export interface Stone {
  code: string; // 宝石编号（唯一）
  orderId: string; // 所属订单（改配后更新）
  originalOrderId: string; // 原单编号
  kind: string; // 种类，如蓝宝石
  shape: string; // 形状，如圆形 / 椭圆 / 梨形 / 祖母绿切
  size: string; // 尺寸，如 6x4mm
  carat: number; // 克拉重量
  clarity: string; // 净度
  color: string; // 颜色
  cut: string; // 切工
  position: string; // 镶嵌位置
  batch: string; // 分拣批次
  status: StoneStatus;
  defectNote: string; // 缺陷备注
  reassignedFrom?: string; // 若为改配入单：原订单号
  settledReceiptId?: string; // 核销它的回执
  createdAt: number;
}

export interface Order {
  id: string;
  customer: string; // 客户/品名
  deliveryDue: string; // 交期
  createdAt: number;
}

// 回执内逐颗核对行
export interface ReceiptLine {
  expectedCode: string; // 原单要求的裸石编号（多收/串入时为空）
  returnedCode: string; // 师傅实际交回的编号（缺件时为空）
  finished: boolean; // 是否交回成品（否则为裸石退回 / 缺件）
  note: string;
  ackMissing?: boolean; // 台面确认：缺件核销
  ackReassigned?: boolean; // 台面确认：已改配，按改配核销
}

export type ReceiptStatus = "draft" | "verified" | "settled";
// draft 待处理 / verified 已提交待核销（含未解决冲突时被挡住）/ settled 已核销

export interface ReceiptConflictSnap {
  kind: string;
  lineIndex: number;
  code?: string;
  message: string;
  resolvable: boolean;
}

// 提交核对时留存的冲突记录快照，重开页面仍在
export interface ReceiptVerifySnapshot {
  at: number;
  canSettle: boolean;
  finishedActual: number;
  bareCount: number;
  missingWriteOff: number;
  reassignedWriteOff: number;
  countMismatch: boolean; // 自报成品数与实际成品数是否不符（仅提示，不挡核销）
  conflicts: ReceiptConflictSnap[];
}

export interface Receipt {
  id: string;
  orderId: string; // 绑定订单
  master: string; // 师傅
  deliveredAt: string; // 交付时间
  finishedCount: number; // 成品数（师傅自报）
  status: ReceiptStatus;
  lines: ReceiptLine[];
  submittedAt?: number;
  settledAt?: number;
  verifySnapshot?: ReceiptVerifySnapshot;
  rollbackNote?: string; // 改配导致回待处理的说明
  createdAt: number;
}

export interface Ledger {
  orders: Order[];
  stones: Stone[];
  receipts: Receipt[];
  seq: number;
}

const STORAGE_KEY = "hxyfront-62006-ledger-v1";

function seed(): Ledger {
  const now = Date.now();
  const orders: Order[] = [
    { id: "DD-1001", customer: "星光蓝宝戒指", deliveryDue: "2026-09-28", createdAt: now - 86400000 * 6 },
    { id: "DD-1002", customer: "钻石群镶吊坠", deliveryDue: "2026-09-30", createdAt: now - 86400000 * 4 },
    { id: "DD-1003", customer: "祖母绿手链", deliveryDue: "2026-10-05", createdAt: now - 86400000 * 2 },
  ];

  // 订单、编号、种类、形状、尺寸、克拉、净度、颜色、切工、位置、批次、状态、缺陷
  type Row = [
    string, string, string, string, string, number, string, string, string, string, string, StoneStatus, string
  ];
  const rows: Row[] = [
    // DD-1001 星光蓝宝戒指：1 主石 + 4 围石
    ["ST-2048", "DD-1001", "蓝宝石", "椭圆", "6x4mm", 1.02, "VS", "皇家蓝", "椭圆明亮切", "主石位", "B-0912", "pending", ""],
    ["ST-2061", "DD-1001", "钻石", "圆形", "2.0mm", 0.08, "VVS", "D", "圆钻", "围石A组", "B-0912", "pending", ""],
    ["ST-2062", "DD-1001", "钻石", "圆形", "2.0mm", 0.08, "VVS", "E", "圆钻", "围石A组", "B-0912", "pending", ""],
    ["ST-2063", "DD-1001", "钻石", "圆形", "2.0mm", 0.07, "VS", "F", "圆钻", "围石B组", "B-0912", "pending", "腰棱轻微磨损"],
    ["ST-2064", "DD-1001", "钻石", "圆形", "2.0mm", 0.08, "VVS", "D", "圆钻", "围石B组", "B-0912", "pending", ""],
    // DD-1002 钻石群镶吊坠
    ["ST-2101", "DD-1002", "钻石", "圆形", "3.0mm", 0.2, "VS", "G", "圆钻", "主石位", "B-0913", "pending", ""],
    ["ST-2102", "DD-1002", "钻石", "圆形", "1.5mm", 0.03, "SI", "H", "圆钻", "围石C组", "B-0913", "pending", ""],
    ["ST-2103", "DD-1002", "钻石", "圆形", "1.5mm", 0.03, "SI", "H", "圆钻", "围石C组", "B-0913", "pending", ""],
    ["ST-2104", "DD-1002", "钻石", "梨形", "4x3mm", 0.15, "VS", "F", "梨形切", "点缀位", "B-0913", "pending", ""],
    // DD-1003 祖母绿手链
    ["ST-2201", "DD-1003", "祖母绿", "祖母绿切", "5x3mm", 0.6, "SI", "绿", "阶梯切", "主石位", "B-0914", "pending", "内含物明显，需客户确认"],
    ["ST-2202", "DD-1003", "祖母绿", "祖母绿切", "4x3mm", 0.35, "SI", "绿", "阶梯切", "配石位1", "B-0914", "pending", ""],
    ["ST-2203", "DD-1003", "钻石", "圆形", "1.3mm", 0.02, "VS", "G", "圆钻", "配石位2", "B-0914", "pending", ""],
  ];

  const stones: Stone[] = rows.map((r, i) => ({
    code: r[0],
    orderId: r[1],
    originalOrderId: r[1],
    kind: r[2],
    shape: r[3],
    size: r[4],
    carat: r[5],
    clarity: r[6],
    color: r[7],
    cut: r[8],
    position: r[9],
    batch: r[10],
    status: r[11],
    defectNote: r[12],
    createdAt: now - 3600000 * (rows.length - i),
  }));

  return {
    orders,
    stones,
    receipts: [],
    seq: 1,
  };
}

export function loadLedger(): Ledger {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Ledger;
      if (parsed && Array.isArray(parsed.stones) && Array.isArray(parsed.orders)) {
        return parsed;
      }
    }
  } catch {
    // 存储损坏时回退到种子数据
  }
  const fresh = seed();
  saveLedger(fresh);
  return fresh;
}

export function saveLedger(ledger: Ledger): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
}

export function resetLedger(): Ledger {
  const fresh = seed();
  saveLedger(fresh);
  return fresh;
}

export function nextReceiptId(ledger: Ledger): string {
  const id = `HZ-${String(ledger.seq).padStart(4, "0")}`;
  return id;
}

// ---- 台账变更操作（均返回新台账并落库）----

export function addStone(ledger: Ledger, input: Omit<Stone, "originalOrderId" | "createdAt">): Ledger {
  const next: Ledger = {
    ...ledger,
    stones: [
      ...ledger.stones,
      { ...input, originalOrderId: input.orderId, createdAt: Date.now() },
    ],
  };
  saveLedger(next);
  return next;
}

/**
 * 改配：把裸石从原单改配到目标单。
 * 任何绑定该石原单/目标单的未核销回执回待处理（rollbackNote 记录原因），
 * 已核销回执不动。
 */
export function reassignStone(ledger: Ledger, stoneCode: string, targetOrderId: string): Ledger {
  const stone = ledger.stones.find((s) => s.code === stoneCode);
  if (!stone || stone.orderId === targetOrderId) return ledger;

  const fromOrder = stone.orderId;
  const stones = ledger.stones.map((s) =>
    s.code === stoneCode
      ? { ...s, orderId: targetOrderId, reassignedFrom: fromOrder }
      : s
  );

  const receipts = ledger.receipts.map((r) => {
    if (r.status === "settled") return r;
    const touches =
      (r.orderId === fromOrder || r.orderId === targetOrderId) &&
      r.lines.some((l) => l.expectedCode === stoneCode || l.returnedCode === stoneCode);
    if (!touches) return r;
    return {
      ...r,
      status: "draft" as ReceiptStatus,
      submittedAt: undefined,
      verifySnapshot: undefined,
      rollbackNote: `裸石 ${stoneCode} 已由 ${fromOrder} 改配至 ${targetOrderId}，回执回待处理，请重新核对`,
    };
  });

  const next = { ...ledger, stones, receipts };
  saveLedger(next);
  return next;
}

export function addReceipt(
  ledger: Ledger,
  receipt: Omit<Receipt, "id" | "seq"> & { id?: string }
): Ledger {
  const id = receipt.id ?? nextReceiptId(ledger);
  const next: Ledger = {
    ...ledger,
    seq: ledger.seq + 1,
    receipts: [...ledger.receipts, { ...receipt, id } as Receipt],
  };
  saveLedger(next);
  return next;
}

export function updateReceipt(ledger: Ledger, receiptId: string, patch: Partial<Receipt>): Ledger {
  const next: Ledger = {
    ...ledger,
    receipts: ledger.receipts.map((r) => (r.id === receiptId ? { ...r, ...patch } : r)),
  };
  saveLedger(next);
  return next;
}

/** 删除未核销回执（已核销记录只可查看，不可删）。 */
export function deleteReceipt(ledger: Ledger, receiptId: string): Ledger {
  const target = ledger.receipts.find((r) => r.id === receiptId);
  if (!target || target.status === "settled") return ledger;
  const next: Ledger = {
    ...ledger,
    receipts: ledger.receipts.filter((r) => r.id !== receiptId),
  };
  saveLedger(next);
  return next;
}

/** 结算落库：把核对结果写回裸石台账。由页面在核销判断通过后调用。 */
export interface SettleEffect {
  stoneCode: string;
  status: StoneStatus;
}

export function settleReceipt(
  ledger: Ledger,
  receiptId: string,
  effects: SettleEffect[]
): Ledger {
  const effectMap = new Map(effects.map((e) => [e.stoneCode, e.status]));
  const settledAt = Date.now();
  const stones = ledger.stones.map((s) => {
    const status = effectMap.get(s.code);
    return status ? { ...s, status, settledReceiptId: receiptId } : s;
  });
  const receipts = ledger.receipts.map((r) =>
    r.id === receiptId
      ? { ...r, status: "settled" as ReceiptStatus, settledAt, rollbackNote: undefined }
      : r
  );
  const next = { ...ledger, stones, receipts };
  saveLedger(next);
  return next;
}

// ---- 查询辅助 ----

export function stonesOfOrder(ledger: Ledger, orderId: string): Stone[] {
  return ledger.stones.filter((s) => s.orderId === orderId);
}

export function pendingCount(ledger: Ledger, orderId?: string): number {
  return ledger.stones.filter(
    (s) => s.status === "pending" && (!orderId || s.orderId === orderId)
  ).length;
}
