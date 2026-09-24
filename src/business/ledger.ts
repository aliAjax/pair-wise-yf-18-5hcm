// 业务文件一：台账存取
// 负责订单 / 裸石 / 回执 / 冲突记录的类型定义、localStorage 持久化与种子台账。
// 不引入任何后端与新依赖。

export type StoneShape = "圆形" | "椭圆" | "梨形" | "祖母绿切";
export type StoneStatus = "待镶" | "成品" | "缺件";
export type StoneSlot = "主石位" | "围石A组" | "围石B组" | "配石位";

export interface Stone {
  id: string; // 宝石编号
  orderId: string; // 所属订单
  species: string; // 种类
  shape: StoneShape; // 形状
  carat: number; // 克拉重量
  sizeMm: number; // 尺寸（毫米，取最长径）
  clarity: string; // 净度
  color: string; // 颜色
  cut: string; // 切工
  slot: StoneSlot; // 镶嵌位置
  batch: string; // 分拣批次
  status: StoneStatus; // 分拣/核销状态
  defectNote?: string; // 缺陷备注
  reallocated?: boolean; // 核销前改配：已从原单摘出，待他单核销
  reallocatedTo?: string; // 改配去向：订单号 或 "return"（配石仓）
  reallocatedAt?: string;
  setAt?: string; // 成品交付时间
  setBy?: string; // 镶嵌师傅
  receiptId?: string; // 由哪张回执核销
  remark?: string;
}

export interface Order {
  id: string;
  title: string;
  customer: string;
}

export type ReceiptStatus = "待处理" | "已核对" | "已核销";
export type EntryResult = "成品" | "缺件" | "改配";

export interface ReceiptEntry {
  stoneId: string; // 原单裸石编号（开回执时的快照引用）
  result: EntryResult; // 师傅填报结果
  actualId: string; // 实际镶嵌编号，与 stoneId 不符即编号冲突
  target?: string; // result = 改配 时的去向订单，"return" 表示退回配石仓
}

export interface Receipt {
  id: string;
  orderId: string; // 每张回执绑定且仅绑定一个订单
  deliveredAt: string; // 交付时间（datetime-local 字符串）
  artisan: string; // 师傅
  finishedCount: number; // 报成品数
  note?: string;
  status: ReceiptStatus;
  createdAt: string;
  writtenOffAt?: string;
  resetReason?: string; // 改配导致退回待处理的说明
  entries: ReceiptEntry[];
}

export type ConflictType = "缺件" | "编号不符" | "串单";
export type ConflictResolution =
  | "缺件核销"
  | "改正编号"
  | "串单改配"
  | "以核对为准"
  | "改配核销";

export interface Conflict {
  id: string;
  receiptId: string;
  orderId: string;
  kind: ConflictType;
  stoneId?: string;
  actualId?: string;
  countOnly?: boolean; // 报成品数与成品条目不符
  detail: string;
  resolved: boolean;
  resolution?: ConflictResolution;
  resolvedAt?: string;
}

export interface Ledger {
  version: number;
  orders: Order[];
  stones: Stone[];
  receipts: Receipt[];
  conflicts: Conflict[];
  receiptSeq: number;
}

const STORAGE_KEY = "hxyfront-62006-ledger-v1";
const VERSION = 1;

export function createSeedLedger(): Ledger {
  const orders: Order[] = [
    { id: "DD-1001", title: "18K金蓝宝石戒指", customer: "林女士" },
    { id: "DD-1002", title: "铂金祖母绿吊坠", customer: "陈先生" },
    { id: "DD-1003", title: "黄金蓝宝石手链", customer: "周女士" },
  ];

  const stones: Stone[] = [
    {
      id: "ST-2048",
      orderId: "DD-1001",
      species: "蓝宝石",
      shape: "椭圆",
      carat: 1.02,
      sizeMm: 6.0,
      clarity: "VVS",
      color: "皇家蓝",
      cut: "优",
      slot: "主石位",
      batch: "PC-0901",
      status: "待镶",
    },
    {
      id: "ST-2061",
      orderId: "DD-1001",
      species: "钻石",
      shape: "圆形",
      carat: 0.08,
      sizeMm: 2.5,
      clarity: "VS",
      color: "H",
      cut: "优",
      slot: "围石A组",
      batch: "PC-0901",
      status: "待镶",
    },
    {
      id: "ST-2062",
      orderId: "DD-1001",
      species: "钻石",
      shape: "圆形",
      carat: 0.07,
      sizeMm: 2.3,
      clarity: "VS",
      color: "H",
      cut: "良",
      slot: "围石A组",
      batch: "PC-0901",
      status: "待镶",
    },
    {
      id: "ST-2063",
      orderId: "DD-1001",
      species: "钻石",
      shape: "圆形",
      carat: 0.07,
      sizeMm: 2.3,
      clarity: "SI",
      color: "I",
      cut: "良",
      slot: "围石B组",
      batch: "PC-0902",
      status: "待镶",
    },
    {
      id: "ST-2070",
      orderId: "DD-1001",
      species: "红宝石",
      shape: "梨形",
      carat: 0.35,
      sizeMm: 4.5,
      clarity: "SI",
      color: "鸽血红",
      cut: "良",
      slot: "配石位",
      batch: "PC-0902",
      status: "待镶",
      defectNote: "亭部内含物明显，需客户确认后镶",
    },
    {
      id: "ST-2099",
      orderId: "DD-1002",
      species: "祖母绿",
      shape: "祖母绿切",
      carat: 0.6,
      sizeMm: 5.0,
      clarity: "SI",
      color: "沃顿绿",
      cut: "良",
      slot: "主石位",
      batch: "PC-0903",
      status: "待镶",
      defectNote: "内含物明显，需客户确认",
    },
    {
      id: "ST-2101",
      orderId: "DD-1002",
      species: "钻石",
      shape: "圆形",
      carat: 0.1,
      sizeMm: 2.8,
      clarity: "VVS",
      color: "G",
      cut: "优",
      slot: "围石A组",
      batch: "PC-0903",
      status: "待镶",
    },
    {
      id: "ST-2102",
      orderId: "DD-1002",
      species: "钻石",
      shape: "圆形",
      carat: 0.1,
      sizeMm: 2.8,
      clarity: "VVS",
      color: "G",
      cut: "优",
      slot: "围石B组",
      batch: "PC-0903",
      status: "待镶",
    },
    {
      id: "ST-3001",
      orderId: "DD-1003",
      species: "蓝宝石",
      shape: "圆形",
      carat: 0.2,
      sizeMm: 3.5,
      clarity: "VS",
      color: "矢车菊",
      cut: "优",
      slot: "主石位",
      batch: "PC-0904",
      status: "待镶",
    },
    {
      id: "ST-3002",
      orderId: "DD-1003",
      species: "蓝宝石",
      shape: "圆形",
      carat: 0.18,
      sizeMm: 3.3,
      clarity: "VS",
      color: "矢车菊",
      cut: "很好",
      slot: "配石位",
      batch: "PC-0904",
      status: "待镶",
    },
    {
      id: "ST-3003",
      orderId: "DD-1003",
      species: "钻石",
      shape: "圆形",
      carat: 0.05,
      sizeMm: 2.0,
      clarity: "SI",
      color: "J",
      cut: "良",
      slot: "配石位",
      batch: "PC-0904",
      status: "待镶",
    },
  ];

  // 种子回执：已核对但存在 串单 + 缺件 两条冲突，演示“列冲突并挡核销”，重开仍在
  const seedReceipt: Receipt = {
    id: "HZ-1001",
    orderId: "DD-1002",
    deliveredAt: "2026-09-22T15:20",
    artisan: "周师傅",
    finishedCount: 2,
    note: "客户现场取货，围石缺一颗待补",
    status: "已核对",
    createdAt: "2026-09-22T15:10",
    entries: [
      { stoneId: "ST-2099", result: "成品", actualId: "ST-2099" },
      { stoneId: "ST-2101", result: "成品", actualId: "ST-2062" },
      { stoneId: "ST-2102", result: "缺件", actualId: "" },
    ],
  };

  const conflicts: Conflict[] = [
    {
      id: "C-HZ-1001-ST-2101-串单",
      receiptId: "HZ-1001",
      orderId: "DD-1002",
      kind: "串单",
      stoneId: "ST-2101",
      actualId: "ST-2062",
      detail: "实际镶嵌编号 ST-2062 属于订单 DD-1001，疑似串单",
      resolved: false,
    },
    {
      id: "C-HZ-1001-ST-2102-缺件",
      receiptId: "HZ-1001",
      orderId: "DD-1002",
      kind: "缺件",
      stoneId: "ST-2102",
      detail: "师傅报缺件，裸石 ST-2102 未随成品交付",
      resolved: false,
    },
  ];

  return {
    version: VERSION,
    orders,
    stones,
    receipts: [seedReceipt],
    conflicts,
    receiptSeq: 1001,
  };
}

function isLedger(value: unknown): value is Ledger {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.orders) &&
    Array.isArray(v.stones) &&
    Array.isArray(v.receipts) &&
    Array.isArray(v.conflicts) &&
    typeof v.receiptSeq === "number"
  );
}

export function loadLedger(): Ledger {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isLedger(parsed) && parsed.version === VERSION) {
        return parsed;
      }
    }
  } catch {
    // 读取或解析失败时回退到种子台账
  }
  return createSeedLedger();
}

export function saveLedger(ledger: Ledger): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
  } catch {
    // 存储不可用时仅保留内存态
  }
}

export function resetLedger(): Ledger {
  const seed = createSeedLedger();
  saveLedger(seed);
  return seed;
}
