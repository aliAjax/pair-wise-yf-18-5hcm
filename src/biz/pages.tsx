// 页面交互：分拣台账与回执台的全部视图与事件处理。
// 业务规则不写在本文件——存取走 store.ts，逐颗核对走 receipt.ts。

import { useMemo, useState } from "react";
import {
  addReceipt,
  addStone,
  deleteReceipt,
  loadLedger,
  pendingCount,
  reassignStone,
  resetLedger,
  settleReceipt,
  stonesOfOrder,
  updateReceipt,
  type Ledger,
  type Order,
  type Receipt,
  type ReceiptLine,
  type ReceiptVerifySnapshot,
  type Stone,
  type StoneStatus,
} from "./store";
import {
  buildLinesFromOrder,
  conflictLabel,
  statusLabel,
  verifyReceipt,
  type Conflict,
  type VerifyResult,
} from "./receipt";

const SHAPES = ["圆形", "椭圆", "梨形", "祖母绿切"];
const MASTERS = ["陈师傅", "李师傅", "周师傅"];

type Tab = "stones" | "receipts" | "finished";

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtTime(ts?: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDelivered(value: string): string {
  return value ? value.replace("T", " ") : "—";
}

const STATUS_BADGE: Record<StoneStatus, string> = {
  pending: "badge badge-pending",
  set: "badge badge-set",
  missing: "badge badge-missing",
  lost: "badge badge-lost",
};

const RECEIPT_STATUS_TEXT: Record<Receipt["status"], string> = {
  draft: "待处理",
  verified: "待核销",
  settled: "已核销",
};

function StatusBadge({ status }: { status: StoneStatus }) {
  return <span className={STATUS_BADGE[status]}>{statusLabel(status)}</span>;
}

// ---------- 镶嵌位置示意图 ----------

function PositionMap({ stones }: { stones: Stone[] }) {
  return (
    <div className="position-map" title="镶嵌位置示意图">
      <svg viewBox="0 0 260 150" role="img" aria-label="镶嵌位置示意图">
        <ellipse cx="130" cy="75" rx="92" ry="52" fill="#fbf6f8" stroke="var(--border)" />
        <circle
          cx="130"
          cy="75"
          r="22"
          fill={stones.some((s) => s.position === "主石位" && s.status === "set") ? "#fce7f0" : "#fff"}
          stroke="var(--primary)"
          strokeWidth="2"
        />
        <text x="130" y="79" textAnchor="middle" fontSize="11" fill="var(--primary)">主石</text>
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2;
          const x = 130 + Math.cos(a) * 58;
          const y = 75 + Math.sin(a) * 33;
          const set = stones.some((s) => s.status === "set");
          return <circle key={i} cx={x} cy={y} r="5" fill={set ? "#d5f2ee" : "#fff"} stroke="var(--secondary)" />;
        })}
      </svg>
    </div>
  );
}

// ---------- 新增裸石表单 ----------

const EMPTY_STONE = {
  code: "",
  kind: "钻石",
  shape: "圆形",
  size: "",
  carat: 0,
  clarity: "VS",
  color: "",
  cut: "圆钻",
  position: "",
  batch: "",
  defectNote: "",
};

function StoneForm({
  orders,
  onCreate,
}: {
  orders: Order[];
  onCreate: (stone: Omit<Stone, "originalOrderId" | "createdAt">) => void;
}) {
  const [orderId, setOrderId] = useState(orders[0]?.id ?? "");
  const [form, setForm] = useState(EMPTY_STONE);

  const update = (key: keyof typeof EMPTY_STONE, value: string | number) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = () => {
    if (!form.code.trim() || !orderId || !form.size.trim() || !form.position.trim()) return;
    onCreate({
      code: form.code.trim(),
      orderId,
      kind: form.kind,
      shape: form.shape,
      size: form.size.trim(),
      carat: Number(form.carat) || 0,
      clarity: form.clarity,
      color: form.color.trim(),
      cut: form.cut,
      position: form.position.trim(),
      batch: form.batch.trim() || "手工录入",
      status: "pending",
      defectNote: form.defectNote.trim(),
    });
    setForm(EMPTY_STONE);
  };

  const fields: Array<[keyof typeof EMPTY_STONE, string, string?]> = [
    ["code", "宝石编号"],
    ["kind", "种类"],
    ["shape", "形状"],
    ["size", "尺寸（如 6x4mm）"],
    ["carat", "克拉重量", "number"],
    ["clarity", "净度"],
    ["color", "颜色"],
    ["cut", "切工"],
    ["position", "镶嵌位置"],
    ["batch", "分拣批次"],
  ];

  return (
    <div className="field-grid">
      <label>
        <span>绑定订单</span>
        <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
          {orders.map((o) => (
            <option key={o.id} value={o.id}>{o.id} · {o.customer}</option>
          ))}
        </select>
      </label>
      {fields.map(([key, label, type]) => (
        <label key={key}>
          <span>{label}</span>
          {key === "shape" ? (
            <select value={String(form[key])} onChange={(e) => update(key, e.target.value)}>
              {SHAPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <input
              type={type ?? "text"}
              step={type === "number" ? "0.01" : undefined}
              value={form[key]}
              placeholder={"填写" + label}
              onChange={(e) => update(key, type === "number" ? Number(e.target.value) : e.target.value)}
            />
          )}
        </label>
      ))}
      <label className="span-2">
        <span>缺陷备注</span>
        <input
          value={form.defectNote}
          placeholder="如：内含物明显，需客户确认"
          onChange={(e) => update("defectNote", e.target.value)}
        />
      </label>
      <div className="span-2 form-actions">
        <button className="primary" onClick={submit}>登记裸石</button>
      </div>
    </div>
  );
}

// ---------- 改配弹窗式行内选择 ----------

function ReassignControl({
  stone,
  orders,
  onReassign,
}: {
  stone: Stone;
  orders: Order[];
  onReassign: (code: string, target: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(
    orders.find((o) => o.id !== stone.orderId)?.id ?? ""
  );

  if (!open) {
    return <button onClick={() => setOpen(true)} disabled={stone.status !== "pending"}>改配</button>;
  }

  return (
    <span className="reassign-inline">
      <select value={target} onChange={(e) => setTarget(e.target.value)}>
        {orders.filter((o) => o.id !== stone.orderId).map((o) => (
          <option key={o.id} value={o.id}>{o.id}</option>
        ))}
      </select>
      <button
        className="primary small"
        onClick={() => {
          if (target) onReassign(stone.code, target);
          setOpen(false);
        }}
      >
        确认
      </button>
      <button className="small" onClick={() => setOpen(false)}>取消</button>
    </span>
  );
}

// ---------- 回执编辑器 ----------

function toSnapshot(result: VerifyResult, receipt: Receipt): ReceiptVerifySnapshot {
  return {
    at: Date.now(),
    canSettle: result.canSettle,
    finishedActual: result.finishedActual,
    bareCount: result.bareCount,
    missingWriteOff: result.missingWriteOff,
    reassignedWriteOff: result.reassignedWriteOff,
    countMismatch: result.finishedActual !== receipt.finishedCount,
    conflicts: result.conflicts.map((c) => ({
      kind: c.kind,
      lineIndex: c.lineIndex,
      code: c.code,
      message: c.message,
      resolvable: c.resolvable,
    })),
  };
}

function ReceiptEditor({
  ledger,
  receiptId,
  onClose,
  mutate,
}: {
  ledger: Ledger;
  receiptId: string | null; // null = 新建
  onClose: () => void;
  mutate: (next: Ledger) => void;
}) {
  const blankOrder = ledger.orders[0]?.id ?? "";
  const [draft, setDraft] = useState<Receipt>(() => {
    if (receiptId) {
      const found = ledger.receipts.find((r) => r.id === receiptId);
      if (found) return structuredCloneSafe(found);
    }
    return {
      id: "",
      orderId: blankOrder,
      master: MASTERS[0],
      deliveredAt: todayLocal(),
      finishedCount: 0,
      status: "draft",
      lines: buildLinesFromOrder(ledger, blankOrder),
      createdAt: Date.now(),
    };
  });

  const isNew = !receiptId;
  const saved = receiptId ? ledger.receipts.find((r) => r.id === receiptId) : undefined;
  // 实时核对（未落库的编辑也能看到冲突）
  const liveResult = useMemo(
    () => verifyReceipt(ledger, { ...draft, id: draft.id || "PREVIEW" }),
    [ledger, draft]
  );
  const snapshot = draft.verifySnapshot;

  const patch = (p: Partial<Receipt>) =>
    setDraft((d) => ({ ...d, ...p, rollbackNote: undefined, verifySnapshot: undefined }));

  const changeOrder = (orderId: string) =>
    setDraft((d) => ({
      ...d,
      orderId,
      lines: buildLinesFromOrder(ledger, orderId),
      finishedCount: 0,
      verifySnapshot: undefined,
    }));

  const setLine = (i: number, p: Partial<ReceiptLine>) =>
    setDraft((d) => ({
      ...d,
      status: d.status === "settled" ? d.status : "draft",
      verifySnapshot: undefined,
      lines: d.lines.map((l, idx) => (idx === i ? { ...l, ...p } : l)),
    }));

  const removeLine = (i: number) =>
    setDraft((d) => ({ ...d, lines: d.lines.filter((_, idx) => idx !== i) }));

  const addBlankLine = () =>
    setDraft((d) => ({ ...d, lines: [...d.lines, { expectedCode: "", returnedCode: "", finished: true, note: "" }] }));

  // 以原单待镶裸石重新补齐核对行（已手改的行保留）
  const syncFromOrder = () =>
    setDraft((d) => {
      const expected = new Set(
        stonesOfOrder(ledger, d.orderId).filter((s) => s.status === "pending").map((s) => s.code)
      );
      const kept = d.lines.filter((l) => l.expectedCode && expected.has(l.expectedCode));
      const have = new Set(kept.map((l) => l.expectedCode));
      const added: ReceiptLine[] = [...expected]
        .filter((code) => !have.has(code))
        .map((code) => ({ expectedCode: code, returnedCode: code, finished: true, note: "" }));
      return { ...d, lines: [...kept, ...added] };
    });

  const persist = (patchExtra?: Partial<Receipt>): { ledger: Ledger; receipt: Receipt } | null => {
    if (!draft.master.trim() || !draft.deliveredAt) return null;
    const merged = { ...draft, ...patchExtra };
    if (isNew) {
      const next = addReceipt(ledger, merged);
      const created = next.receipts[next.receipts.length - 1];
      mutate(next);
      return { ledger: next, receipt: created };
    }
    const next = updateReceipt(ledger, draft.id, merged);
    const savedReceipt = next.receipts.find((r) => r.id === draft.id)!;
    mutate(next);
    return { ledger: next, receipt: savedReceipt };
  };

  // 保存草稿
  const save = () => {
    persist({ status: "draft", submittedAt: undefined, verifySnapshot: undefined });
    onClose();
  };

  // 提交核对：记录冲突快照，有冲突挡住核销（回执留在待核销/被挡状态）
  const submitVerify = () => {
    const snap = toSnapshot(liveResult, draft);
    const done = persist({
      status: "verified",
      submittedAt: Date.now(),
      verifySnapshot: snap,
      rollbackNote: undefined,
    });
    if (done) {
      setDraft((d) => ({ ...d, id: done.receipt.id, status: "verified", verifySnapshot: snap }));
    }
  };

  // 核销：实时判断无冲突才放行，落库成品/缺件状态
  const settle = () => {
    if (!liveResult.canSettle) return;
    const snap = toSnapshot(liveResult, draft);
    if (isNew) {
      const withReceipt = addReceipt(ledger, {
        ...draft,
        status: "verified",
        submittedAt: Date.now(),
        verifySnapshot: snap,
      });
      const created = withReceipt.receipts[withReceipt.receipts.length - 1];
      mutate(settleReceipt(withReceipt, created.id, liveResult.effects));
    } else {
      const withSnap = updateReceipt(ledger, draft.id, {
        ...draft,
        status: "verified",
        submittedAt: draft.submittedAt ?? Date.now(),
        verifySnapshot: snap,
      });
      mutate(settleReceipt(withSnap, draft.id, liveResult.effects));
    }
    onClose();
  };

  const remove = () => {
    if (isNew) {
      onClose();
      return;
    }
    if (window.confirm(`删除回执 ${draft.id}？已核销回执不可删除。`)) {
      mutate(deleteReceipt(ledger, draft.id));
      onClose();
    }
  };

  const locked = draft.status === "settled";
  const conflictRows = new Map<number, Conflict[]>();
  for (const c of liveResult.conflicts) {
    const key = c.lineIndex;
    conflictRows.set(key, [...(conflictRows.get(key) ?? []), c]);
  }
  const order = ledger.orders.find((o) => o.id === draft.orderId);

  return (
    <section className="panel editor">
      <div className="heading">
        <div>
          <p>{isNew ? "新回执" : draft.id}</p>
          <h2>逐颗核对{order ? ` · ${order.id} ${order.customer}` : ""}</h2>
        </div>
        <button onClick={onClose}>关闭</button>
      </div>

      {saved?.rollbackNote && (
        <div className="banner rollback">⤺ {saved.rollbackNote}</div>
      )}

      <div className="receipt-meta">
        <label>
          <span>绑定订单</span>
          <select value={draft.orderId} disabled={!isNew || locked} onChange={(e) => changeOrder(e.target.value)}>
            {ledger.orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.id} · {o.customer}（待镶 {pendingCount(ledger, o.id)} 颗）
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>师傅</span>
          <select value={draft.master} disabled={locked} onChange={(e) => patch({ master: e.target.value })}>
            {MASTERS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>
          <span>交付时间</span>
          <input
            type="datetime-local"
            value={draft.deliveredAt}
            disabled={locked}
            onChange={(e) => patch({ deliveredAt: e.target.value })}
          />
        </label>
        <label>
          <span>成品数（师傅自报）</span>
          <input
            type="number"
            min={0}
            value={draft.finishedCount}
            disabled={locked}
            onChange={(e) => patch({ finishedCount: Math.max(0, Number(e.target.value) || 0) })}
          />
        </label>
      </div>

      <div className="table-tools">
        <button onClick={syncFromOrder} disabled={locked}>同步原单待镶裸石</button>
        <button onClick={addBlankLine} disabled={locked}>加一行（多收/串入）</button>
        <span className="muted">
          原单待镶 {stonesOfOrder(ledger, draft.orderId).filter((s) => s.status === "pending").length} 颗
        </span>
      </div>

      <div className="line-table-wrap">
        <table className="line-table">
          <thead>
            <tr>
              <th>原单编号</th>
              <th>交回编号</th>
              <th>成品</th>
              <th>冲突 / 备注</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {draft.lines.map((line, i) => {
              const rowConflicts = [
                ...(conflictRows.get(i) ?? []),
                ...(conflictRows.get(-1) ?? []).filter((c) => c.code === line.returnedCode),
              ];
              return (
                <tr key={i} className={rowConflicts.length ? "row-conflict" : ""}>
                  <td>
                    <input
                      value={line.expectedCode}
                      disabled={locked}
                      placeholder="原单编号"
                      onChange={(e) => setLine(i, { expectedCode: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      value={line.returnedCode}
                      disabled={locked}
                      placeholder="缺件留空"
                      onChange={(e) => setLine(i, { returnedCode: e.target.value })}
                    />
                  </td>
                  <td className="center">
                    <input
                      type="checkbox"
                      checked={line.finished}
                      disabled={locked}
                      onChange={(e) => setLine(i, { finished: e.target.checked })}
                    />
                  </td>
                  <td>
                    {rowConflicts.map((c, ci) => (
                      <div key={ci} className={`conflict conflict-${c.kind}`}>
                        <b>【{conflictLabel(c.kind)}】</b>{c.message}
                        {c.kind === "missing" && (
                          <label className="ack">
                            <input
                              type="checkbox"
                              checked={!!line.ackMissing}
                              disabled={locked}
                              onChange={(e) => setLine(i, { ackMissing: e.target.checked })}
                            />
                            确认缺件，按缺件核销
                          </label>
                        )}
                        {c.kind === "reassigned" && (
                          <label className="ack">
                            <input
                              type="checkbox"
                              checked={!!line.ackReassigned}
                              disabled={locked}
                              onChange={(e) => setLine(i, { ackReassigned: e.target.checked })}
                            />
                            确认已改配，按改配核销
                          </label>
                        )}
                      </div>
                    ))}
                    <input
                      className="note-input"
                      value={line.note}
                      disabled={locked}
                      placeholder="行内备注"
                      onChange={(e) => setLine(i, { note: e.target.value })}
                    />
                  </td>
                  <td>
                    <button className="small" disabled={locked} onClick={() => removeLine(i)}>删行</button>
                  </td>
                </tr>
              );
            })}
            {draft.lines.length === 0 && (
              <tr><td colSpan={5} className="muted center">暂无核对行，点「同步原单待镶裸石」生成</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <VerifySummary result={liveResult} snapshot={snapshot} status={draft.status} reported={draft.finishedCount} />

      {!locked && (
        <div className="editor-actions">
          <button onClick={remove}>{isNew ? "放弃" : "删除回执"}</button>
          <button onClick={save}>存为待处理</button>
          <button onClick={submitVerify}>提交核对</button>
          <button className="primary" disabled={!liveResult.canSettle} onClick={settle}>
            核销{liveResult.canSettle ? `（成品 ${liveResult.finishedActual}${liveResult.missingWriteOff ? ` · 缺件 ${liveResult.missingWriteOff}` : ""}${liveResult.reassignedWriteOff ? ` · 改配 ${liveResult.reassignedWriteOff}` : ""}）` : ""}
          </button>
        </div>
      )}
    </section>
  );
}

// structuredClone 在老浏览器可能缺失，简单兜底
function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function VerifySummary({
  result,
  snapshot,
  status,
  reported,
}: {
  result: VerifyResult;
  snapshot?: ReceiptVerifySnapshot;
  status: Receipt["status"];
  reported: number;
}) {
  const conflicts = result.conflicts;
  const showLiveMismatch = status !== "draft" && result.finishedActual !== reported;
  const snapshotMismatch = status === "verified" && snapshot?.countMismatch;
  return (
    <div className="verify-box">
      <div className="verify-stats">
        <span>实际成品 <b>{result.finishedActual}</b></span>
        <span>裸石照常退回 <b>{result.bareCount}</b></span>
        <span>缺件核销 <b>{result.missingWriteOff}</b></span>
        <span>改配核销 <b>{result.reassignedWriteOff}</b></span>
      </div>
      {conflicts.length > 0 ? (
        <div className="banner blocked">
          共 {conflicts.length} 条冲突（缺件 / 串单 / 编号不符 / 重复 / 已核销），已挡住核销；
          缺件、改配可逐行勾选「确认」后再提交；其余须改正交回编号。
        </div>
      ) : (
        <div className="banner ok">核对通过，无冲突，可以核销。
          {showLiveMismatch ? "" : ""}
        </div>
      )}
      {(showLiveMismatch || snapshotMismatch) && (
        <div className="banner warn">
          数量提示：师傅自报 {reported} 颗成品，逐颗核对实际 {result.finishedActual} 颗，不一致，请复核（不挡核销）。
        </div>
      )}
      {status === "verified" && snapshot && !snapshot.canSettle && (
        <p className="muted small-text">冲突记录已于 {fmtTime(snapshot.at)} 留存，关闭重开仍在。</p>
      )}
    </div>
  );
}

// ---------- 主工作台 ----------

export default function Workbench() {
  const [ledger, setLedger] = useState<Ledger>(() => loadLedger());
  const [tab, setTab] = useState<Tab>("stones");
  const [orderId, setOrderId] = useState<string>(ledger.orders[0]?.id ?? "");
  const [shapeFilter, setShapeFilter] = useState<string[]>([]);
  const [sizeQuery, setSizeQuery] = useState("");
  const [editingReceipt, setEditingReceipt] = useState<string | null | undefined>(undefined);
  // undefined = 未打开；null = 新建；string = 编辑指定回执

  const mutate = (next: Ledger) => setLedger(next);

  const doReset = () => {
    if (window.confirm("重置为初始演示台账？当前所有回执与核销将清空。")) {
      setLedger(resetLedger());
      setEditingReceipt(undefined);
    }
  };

  const orderStones = useMemo(
    () => stonesOfOrder(ledger, orderId),
    [ledger, orderId]
  );

  // 尺寸筛选：随核销同步变化（核销后的 set/missing 不再是待镶）
  const filtered = useMemo(() => {
    return orderStones.filter((s) => {
      if (shapeFilter.length && !shapeFilter.includes(s.shape)) return false;
      if (sizeQuery.trim() && !s.size.toLowerCase().includes(sizeQuery.trim().toLowerCase())) return false;
      return true;
    });
  }, [orderStones, shapeFilter, sizeQuery]);

  const totalCarat = ledger.stones.reduce((sum, s) => sum + s.carat, 0);
  const setStones = ledger.stones.filter((s) => s.status === "set");
  const missingStones = ledger.stones.filter((s) => s.status === "missing");
  const openReceipts = ledger.receipts.filter((r) => r.status !== "settled");
  const settledReceipts = ledger.receipts.filter((r) => r.status === "settled");

  const toggleShape = (shape: string) =>
    setShapeFilter((list) => (list.includes(shape) ? list.filter((s) => s !== shape) : [...list, shape]));

  const openReceipt = (id: string) => {
    setEditingReceipt(id);
    setTab("receipts");
  };

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <p className="brand-line">hxyfront-62006 · 珠宝镶嵌工作室</p>
          <h1>宝石分拣 · 镶嵌回执台</h1>
        </div>
        <div className="topbar-actions">
          <button onClick={doReset}>重置演示台账</button>
        </div>
      </header>

      <section className="metrics">
        <article><small>分拣批次（去重）</small><strong>{new Set(ledger.stones.map((s) => s.batch)).size}</strong></article>
        <article><small>待镶嵌裸石</small><strong>{pendingCount(ledger)}</strong></article>
        <article><small>成品（已核销）</small><strong>{setStones.length}</strong></article>
        <article><small>总克拉 / 缺件核销</small><strong>{totalCarat.toFixed(2)}<em> / {missingStones.length}</em></strong></article>
      </section>

      <nav className="tabs">
        <button className={tab === "stones" ? "active" : ""} onClick={() => setTab("stones")}>裸石台账</button>
        <button className={tab === "receipts" ? "active" : ""} onClick={() => setTab("receipts")}>
          回执台{openReceipts.length ? <span className="tab-dot">{openReceipts.length}</span> : null}
        </button>
        <button className={tab === "finished" ? "active" : ""} onClick={() => setTab("finished")}>成品清单</button>
      </nav>

      {tab === "stones" && (
        <section className="workspace">
          <aside className="panel">
            <h2>订单与筛选</h2>
            <div className="order-list">
              {ledger.orders.map((o) => (
                <button
                  key={o.id}
                  className={o.id === orderId ? "order-item active" : "order-item"}
                  onClick={() => setOrderId(o.id)}
                >
                  <b>{o.id}</b>
                  <span>{o.customer}</span>
                  <small>待镶 {pendingCount(ledger, o.id)} · 交期 {o.deliveryDue}</small>
                </button>
              ))}
            </div>
            <h3>形状</h3>
            <div className="chips">
              {SHAPES.map((s) => (
                <button
                  key={s}
                  className={shapeFilter.includes(s) ? "chip-on" : ""}
                  onClick={() => toggleShape(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            <h3>尺寸筛选</h3>
            <input
              placeholder="如 6x4 或 2.0mm"
              value={sizeQuery}
              onChange={(e) => setSizeQuery(e.target.value)}
            />
            <button className="link-btn" onClick={() => { setShapeFilter([]); setSizeQuery(""); }}>清空筛选</button>
            <PositionMap stones={orderStones} />
          </aside>

          <section className="panel">
            <div className="heading">
              <div>
                <p>按订单查看宝石清单</p>
                <h2>{orderId} · 共 {filtered.length} 颗（待镶 {orderStones.filter((s) => s.status === "pending").length}）</h2>
              </div>
            </div>
            <div className="stone-table-wrap">
              <table className="stone-table">
                <thead>
                  <tr>
                    <th>编号</th><th>种类</th><th>形状</th><th>尺寸</th><th>克拉</th>
                    <th>净度/颜色</th><th>切工</th><th>位置</th><th>批次</th><th>状态/缺陷</th><th>改配</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr key={s.code}>
                      <td><b>{s.code}</b>{s.reassignedFrom && <div className="muted small-text">自 {s.reassignedFrom} 改配入</div>}</td>
                      <td>{s.kind}</td>
                      <td>{s.shape}</td>
                      <td>{s.size}</td>
                      <td>{s.carat.toFixed(2)}</td>
                      <td>{s.clarity} / {s.color || "—"}</td>
                      <td>{s.cut}</td>
                      <td>{s.position}</td>
                      <td>{s.batch}</td>
                      <td>
                        <StatusBadge status={s.status} />
                        {s.defectNote && <div className="defect">⚠ {s.defectNote}</div>}
                        {s.settledReceiptId && <div className="muted small-text">回执 {s.settledReceiptId}</div>}
                      </td>
                      <td><ReassignControl stone={s} orders={ledger.orders} onReassign={(code, t) => mutate(reassignStone(ledger, code, t))} /></td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={11} className="muted center">没有符合筛选的裸石</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="heading sub">
              <div><p>分拣登记</p><h3>新增裸石</h3></div>
            </div>
            <StoneForm
              orders={ledger.orders}
              onCreate={(input) => {
                if (ledger.stones.some((s) => s.code === input.code)) {
                  window.alert(`编号 ${input.code} 已存在`);
                  return;
                }
                mutate(addStone(ledger, input));
              }}
            />
          </section>
        </section>
      )}

      {tab === "receipts" && (
        <section className="receipt-desk">
          {editingReceipt !== undefined ? (
            <ReceiptEditor
              key={editingReceipt ?? "new"}
              ledger={ledger}
              receiptId={editingReceipt}
              onClose={() => setEditingReceipt(undefined)}
              mutate={mutate}
            />
          ) : (
            <>
              <div className="heading panel-heading-inline">
                <div>
                  <p>师傅镶嵌完靠便签交回执</p>
                  <h2>回执台</h2>
                </div>
                <button className="primary" onClick={() => setEditingReceipt(null)}>新建回执</button>
              </div>

              <section className="panel">
                <h3>未核销回执（重开后仍在）</h3>
                <div className="receipt-grid">
                  {openReceipts.length === 0 && <p className="muted">暂无待处理/待核销回执。</p>}
                  {openReceipts.map((r) => {
                    const order = ledger.orders.find((o) => o.id === r.orderId);
                    const blocked = r.verifySnapshot ? !r.verifySnapshot.canSettle : false;
                    const pendingConflicts = r.verifySnapshot?.conflicts.length ?? 0;
                    return (
                      <article key={r.id} className={blocked ? "receipt-card blocked-card" : "receipt-card"}>
                        <div className="receipt-card-head">
                          <b>{r.id}</b>
                          <span className={`receipt-status status-${r.status}`}>
                            {blocked ? "冲突挡核销" : RECEIPT_STATUS_TEXT[r.status]}
                          </span>
                        </div>
                        <p>{r.orderId} · {order?.customer ?? "—"}</p>
                        <p className="muted">师傅 {r.master} · 交付 {fmtDelivered(r.deliveredAt)}</p>
                        <p>自报成品 {r.finishedCount} 颗 · 核对行 {r.lines.length} 行</p>
                        {r.rollbackNote && <div className="banner rollback small-banner">⤺ {r.rollbackNote}</div>}
                        {pendingConflicts > 0 && (
                          <div className="banner blocked small-banner">
                            {pendingConflicts} 条冲突留存：
                            {r.verifySnapshot?.conflicts.slice(0, 3).map((c, i) => (
                              <span key={i}> {c.message}；</span>
                            ))}
                          </div>
                        )}
                        <button onClick={() => openReceipt(r.id)}>打开核对</button>
                      </article>
                    );
                  })}
                </div>
              </section>

              <section className="panel">
                <h3>已核销记录</h3>
                <div className="receipt-grid">
                  {settledReceipts.length === 0 && <p className="muted">暂无已核销回执。</p>}
                  {settledReceipts.map((r) => {
                    const order = ledger.orders.find((o) => o.id === r.orderId);
                    const finished = r.lines.filter((l) => l.finished && l.returnedCode === l.expectedCode).length;
                    return (
                      <article key={r.id} className="receipt-card settled-card">
                        <div className="receipt-card-head">
                          <b>{r.id}</b>
                          <span className="receipt-status status-settled">已核销</span>
                        </div>
                        <p>{r.orderId} · {order?.customer ?? "—"}</p>
                        <p className="muted">师傅 {r.master} · 交付 {fmtDelivered(r.deliveredAt)}</p>
                        <p>成品 {finished} 颗 · 核销时间 {fmtTime(r.settledAt)}</p>
                        <button onClick={() => openReceipt(r.id)}>查看</button>
                      </article>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </section>
      )}

      {tab === "finished" && (
        <section className="panel">
          <div className="heading">
            <div>
              <p>核销后成品清单同步变化</p>
              <h2>成品清单（{setStones.length} 颗）</h2>
            </div>
          </div>
          <div className="stone-table-wrap">
            <table className="stone-table">
              <thead>
                <tr><th>编号</th><th>订单</th><th>种类</th><th>形状</th><th>尺寸</th><th>克拉</th><th>位置</th><th>核销回执</th><th>师傅/交付</th></tr>
              </thead>
              <tbody>
                {setStones.map((s) => {
                  const receipt = ledger.receipts.find((r) => r.id === s.settledReceiptId);
                  return (
                    <tr key={s.code}>
                      <td><b>{s.code}</b></td>
                      <td>{s.orderId}</td>
                      <td>{s.kind}</td>
                      <td>{s.shape}</td>
                      <td>{s.size}</td>
                      <td>{s.carat.toFixed(2)}</td>
                      <td>{s.position}</td>
                      <td>{s.settledReceiptId ?? "—"}</td>
                      <td>{receipt ? `${receipt.master} · ${fmtDelivered(receipt.deliveredAt)}` : "—"}</td>
                    </tr>
                  );
                })}
                {setStones.length === 0 && <tr><td colSpan={9} className="muted center">还没有核销成品</td></tr>}
              </tbody>
            </table>
          </div>
          {missingStones.length > 0 && (
            <>
              <h3>缺件核销（{missingStones.length} 颗）</h3>
              <ul className="missing-list">
                {missingStones.map((s) => (
                  <li key={s.code}><b>{s.code}</b> · {s.orderId} · {s.kind} {s.size} · 回执 {s.settledReceiptId ?? "—"}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </main>
  );
}
