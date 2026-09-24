import { createSeedLedger } from "../src/business/ledger";
import type { Ledger } from "../src/business/ledger";
import {
  ARTISANS,
  EMPTY_FILTER,
  canWriteOff,
  checkReceipt,
  createReceipt,
  getStats,
  openConflicts,
  pendingStones,
  reallocateStone,
  resolveConflict,
  selectStones,
  sizeBucketCounts,
  writeOff,
} from "../src/business/writeoff";

let passed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) {
    console.error(`✗ ${name} ${extra}`);
    process.exitCode = 1;
  } else {
    passed++;
    console.log(`✓ ${name}`);
  }
}

// ---- 场景 1：种子回执 HZ-1001 有串单+缺件两条冲突，挡核销 ----
let ledger: Ledger = createSeedLedger();
check("种子：1 张已核对回执", ledger.receipts[0].status === "已核对");
check("种子：2 条未决冲突", openConflicts(ledger, "HZ-1001").length === 2);
check("种子：核销被挡", canWriteOff(ledger, "HZ-1001").ok === false);
check("种子：待镶 11 颗", getStats(ledger).pendingCount === 11);

const swap = openConflicts(ledger, "HZ-1001").find((c) => c.kind === "串单")!;
const missing = openConflicts(ledger, "HZ-1001").find((c) => c.kind === "缺件")!;
resolveConflict(ledger, swap.id, "串单改配");
resolveConflict(ledger, missing.id, "缺件核销");
check("冲突处理完可核销", canWriteOff(ledger, "HZ-1001").ok === true);
writeOff(ledger, "HZ-1001");
check("核销后状态=已核销", ledger.receipts[0].status === "已核销");
// ST-2099 成品；ST-2062 串单改配到本单成为成品；ST-2101 改配缺件；ST-2102 缺件
check("核销后待镶降到 7", getStats(ledger).pendingCount === 7);
const finished = selectStones(ledger, "finished", EMPTY_FILTER);
check("成品清单含 ST-2099", finished.some((s) => s.id === "ST-2099"));
check("成品清单含串单改配的 ST-2062", finished.some((s) => s.id === "ST-2062"));
check("ST-2062 已改挂到 DD-1002", ledger.stones.find((s) => s.id === "ST-2062")!.orderId === "DD-1002");
check("ST-2102 缺件", ledger.stones.find((s) => s.id === "ST-2102")!.status === "缺件");
const counts = sizeBucketCounts(ledger, "finished", EMPTY_FILTER);
check("尺寸筛选成品总数=2", counts.all === 2);
// ST-2099 5.0mm 属 large；ST-2062 2.5mm 属 small
check("成品小尺寸桶=1（ST-2062）", counts.small === 1);
check("成品大尺寸桶=1（ST-2099）", counts.large === 1);

// ---- 场景 2：开新回执，编号不符挡核销 ----
ledger = createSeedLedger();
const stones = pendingStones(ledger, "DD-1001");
const receipt = createReceipt(ledger, {
  orderId: "DD-1001",
  deliveredAt: "2026-09-24T10:00",
  artisan: ARTISANS[0],
  finishedCount: stones.length,
  note: "",
  entries: stones.map((s) =>
    s.id === "ST-2061"
      ? { stoneId: s.id, result: "成品", actualId: "ST-9999" }
      : { stoneId: s.id, result: "成品", actualId: s.id },
  ),
});
check("新回执=待处理", receipt.status === "待处理");
check("待处理时不能核销", canWriteOff(ledger, receipt.id).reason?.includes("逐颗核对") === true);
checkReceipt(ledger, receipt.id);
check("核对后=已核对", ledger.receipts.find((r) => r.id === receipt.id)!.status === "已核对");
const bad = openConflicts(ledger, receipt.id);
check("列出编号不符冲突", bad.length === 1 && bad[0].kind === "编号不符");
check("仍挡核销", canWriteOff(ledger, receipt.id).ok === false);
resolveConflict(ledger, bad[0].id, "改正编号");
writeOff(ledger, receipt.id);
check("全部成品核销后待镶=6（11-5）", getStats(ledger).pendingCount === 6);

// ---- 场景 3：核销前改配，原回执回待处理 ----
ledger = createSeedLedger();
const before = createReceipt(ledger, {
  orderId: "DD-1003",
  deliveredAt: "2026-09-24T11:00",
  artisan: ARTISANS[1],
  finishedCount: 3,
  note: "",
  entries: pendingStones(ledger, "DD-1003").map((s) => ({ stoneId: s.id, result: "成品", actualId: s.id })),
});
checkReceipt(ledger, before.id);
check("DD-1003 回执已核对无冲突", openConflicts(ledger, before.id).length === 0);
const res = reallocateStone(ledger, "ST-3001", "DD-1001");
check("改配返回被退回的回执", res.resetReceipts.includes(before.id));
check("退回后=待处理", ledger.receipts.find((r) => r.id === before.id)!.status === "待处理");
check("有退回说明", !!ledger.receipts.find((r) => r.id === before.id)!.resetReason);
check(
  "改配裸石进入改配待核视图",
  selectStones(ledger, "reallocated", EMPTY_FILTER).some((s) => s.id === "ST-3001"),
);
check("改配后待镶数减少(10)", getStats(ledger).pendingCount === 10);
checkReceipt(ledger, before.id);
check("重新核对列出编号不符冲突", openConflicts(ledger, before.id).some((c) => c.stoneId === "ST-3001"));
check("冲突记录保留", ledger.conflicts.filter((c) => c.receiptId === before.id).length >= 1);

// ---- 场景 4：报成品数不符 → 缺件冲突 ----
ledger = createSeedLedger();
createReceipt(ledger, {
  orderId: "DD-1003",
  deliveredAt: "2026-09-24T12:00",
  artisan: ARTISANS[0],
  finishedCount: 5, // 只有 3 个成品条目
  note: "",
  entries: pendingStones(ledger, "DD-1003").map((s) => ({ stoneId: s.id, result: "成品", actualId: s.id })),
});
const rid = ledger.receipts[0].id;
checkReceipt(ledger, rid);
check("成品数不符生成缺件冲突", openConflicts(ledger, rid).some((c) => c.countOnly === true));
check("核销被挡", canWriteOff(ledger, rid).ok === false);

console.log(`\n${passed} 项断言全部通过`);
