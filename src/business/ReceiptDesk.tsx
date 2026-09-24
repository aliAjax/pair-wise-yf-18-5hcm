// 业务文件三：页面交互
// React 组件层：回执台（开回执 / 逐颗核对 / 冲突处理 / 核销）、
// 台账视图（按订单查看、尺寸筛选、镶嵌位置示意图、缺陷备注、核销前改配）。
// 所有状态变更先深拷贝，调用 business/writeoff 的纯逻辑后落盘。

import { useMemo, useState } from "react";
import type {
  Conflict,
  ConflictResolution,
  Ledger,
  Order,
  Receipt,
  ReceiptEntry,
  Stone,
  StoneShape,
  StoneSlot,
} from "./ledger";
import { loadLedger, resetLedger, saveLedger } from "./ledger";
import {
  ARTISANS,
  CONFLICT_OPTIONS,
  EMPTY_FILTER,
  SCOPES,
  SHAPES,
  SIZE_BUCKETS,
  canWriteOff,
  checkReceipt,
  createReceipt,
  deleteReceipt,
  findOrder,
  getStats,
  openConflicts,
  orderStones,
  pendingStones,
  receiptConflicts,
  reallocateStone,
  resolveConflict,
  reopenConflict,
  selectStones,
  sizeBucketCounts,
  undoReallocation,
  writeOff,
} from "./writeoff";
import type { ScopeKey, StoneFilter } from "./writeoff";

// ---------------------------------------------------------------- 工具

interface ToastMsg {
  id: number;
  text: string;
  tone: "ok" | "err";
}

let toastSeq = 0;

function nowLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtTime(value?: string): string {
  if (!value) return "—";
  return value.replace("T", " ").slice(0, 16);
}

function cloneLedger(ledger: Ledger): Ledger {
  return JSON.parse(JSON.stringify(ledger)) as Ledger;
}

function stoneTone(s: Stone): string {
  if (s.status === "成品") return "#0f766e";
  if (s.status === "缺件") return s.reallocated ? "#a855f7" : "#be123c";
  if (s.reallocated) return "#a855f7";
  return "#be123c";
}

// ---------------------------------------------------------------- 主组件

export default function ReceiptDesk() {
  const [ledger, setLedger] = useState<Ledger>(() => loadLedger());
  const [tab, setTab] = useState<"receipts" | "ledger">("receipts");
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  const pushToast = (text: string, tone: ToastMsg["tone"]) => {
    const id = ++toastSeq;
    setToasts((list) => [...list, { id, text, tone }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3800);
  };

  const run = (fn: (draft: Ledger) => void, success?: string): boolean => {
    try {
      const draft = cloneLedger(ledger);
      fn(draft);
      setLedger(draft);
      saveLedger(draft);
      if (success) pushToast(success, "ok");
      return true;
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "操作失败", "err");
      return false;
    }
  };

  const handleReset = () => {
    if (window.confirm("确定恢复为演示台账？当前本地记录将被清空。")) {
      const seed = resetLedger();
      setLedger(seed);
      pushToast("已恢复演示台账", "ok");
    }
  };

  const stats = getStats(ledger);

  return (
    <div className="desk">
      <nav className="tabs">
        <button className={tab === "receipts" ? "active" : ""} onClick={() => setTab("receipts")}>
          回执台
          {stats.pendingReceiptCount > 0 && <em className="tab-badge">{stats.pendingReceiptCount}</em>}
        </button>
        <button className={tab === "ledger" ? "active" : ""} onClick={() => setTab("ledger")}>
          宝石台账
        </button>
        <button className="reset-btn" onClick={handleReset}>
          恢复演示数据
        </button>
      </nav>

      <section className="metrics">
        <article>
          <small>分拣批次</small>
          <strong>{stats.batchCount}</strong>
          <span>在批待镶裸石</span>
        </article>
        <article>
          <small>待镶嵌</small>
          <strong>{stats.pendingCount}</strong>
          <span>共 {stats.pendingCarat.toFixed(2)} ct</span>
        </article>
        <article>
          <small>成品清单</small>
          <strong>{stats.finishedCount}</strong>
          <span>已镶嵌交付</span>
        </article>
        <article className={stats.openConflictCount > 0 ? "alert" : ""}>
          <small>待处理回执</small>
          <strong>{stats.pendingReceiptCount}</strong>
          <span>
            {stats.openConflictCount > 0 ? `${stats.openConflictCount} 条冲突挡核销` : "无未决冲突"}
          </span>
        </article>
      </section>

      {tab === "receipts" ? (
        <ReceiptsView ledger={ledger} run={run} />
      ) : (
        <LedgerView ledger={ledger} run={run} />
      )}

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 回执台

interface ViewProps {
  ledger: Ledger;
  run: (fn: (draft: Ledger) => void, success?: string) => boolean;
}

function ReceiptsView({ ledger, run }: ViewProps) {
  return (
    <div className="receipts-layout">
      <NewReceiptForm ledger={ledger} run={run} />
      <section className="panel receipt-list-panel">
        <div className="heading">
          <div>
            <p>回执台</p>
            <h2>交回执记录</h2>
          </div>
          <span className="hint">每张回执绑定一个订单，核销后数据自动入台账</span>
        </div>
        <div className="receipt-list">
          {ledger.receipts.length === 0 && <p className="empty">还没有回执，按师傅便签在左侧开第一张吧。</p>}
          {ledger.receipts.map((receipt) => (
            <ReceiptCard key={receipt.id} ledger={ledger} receipt={receipt} run={run} />
          ))}
        </div>
      </section>
    </div>
  );
}

interface ReceiptDraft {
  orderId: string;
  deliveredAt: string;
  artisan: string;
  finishedCount: number;
  note: string;
  entries: ReceiptEntry[];
}

const EMPTY_DRAFT: ReceiptDraft = {
  orderId: "",
  deliveredAt: nowLocal(),
  artisan: ARTISANS[0],
  finishedCount: 0,
  note: "",
  entries: [],
};

function NewReceiptForm({ ledger, run }: ViewProps) {
  const [draft, setDraft] = useState<ReceiptDraft>(EMPTY_DRAFT);
  const available = draft.orderId ? pendingStones(ledger, draft.orderId) : [];

  const chooseOrder = (orderId: string) => {
    const stones = orderId ? pendingStones(ledger, orderId) : [];
    setDraft({
      ...draft,
      orderId,
      entries: stones.map((s) => ({ stoneId: s.id, result: "成品", actualId: s.id })),
      finishedCount: stones.length,
    });
  };

  const patchEntry = (index: number, patch: Partial<ReceiptEntry>) => {
    setDraft({
      ...draft,
      entries: draft.entries.map((e, i) => (i === index ? { ...e, ...patch } : e)),
    });
  };

  const submit = () => {
    const ok = run(
      (d) => {
        createReceipt(d, {
          orderId: draft.orderId,
          deliveredAt: draft.deliveredAt,
          artisan: draft.artisan,
          finishedCount: draft.finishedCount,
          note: draft.note,
          entries: draft.entries,
        });
      },
      `回执已开（待处理），请逐颗核对后再核销`,
    );
    if (ok) setDraft({ ...EMPTY_DRAFT, deliveredAt: nowLocal() });
  };

  return (
    <section className="panel new-receipt-panel">
      <div className="heading">
        <div>
          <p>师傅便签</p>
          <h2>新开回执</h2>
        </div>
      </div>

      <label className="form-row">
        <span>绑定订单</span>
        <select value={draft.orderId} onChange={(e) => chooseOrder(e.target.value)}>
          <option value="">选择订单…</option>
          {ledger.orders.map((o) => {
            const left = pendingStones(ledger, o.id).length;
            return (
              <option key={o.id} value={o.id}>
                {o.id} · {o.title}（待镶 {left}）
              </option>
            );
          })}
        </select>
      </label>

      <div className="form-double">
        <label className="form-row">
          <span>交付时间</span>
          <input
            type="datetime-local"
            value={draft.deliveredAt}
            onChange={(e) => setDraft({ ...draft, deliveredAt: e.target.value })}
          />
        </label>
        <label className="form-row">
          <span>师傅</span>
          <select value={draft.artisan} onChange={(e) => setDraft({ ...draft, artisan: e.target.value })}>
            {ARTISANS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="form-row">
        <span>报成品数</span>
        <input
          type="number"
          min={0}
          value={draft.finishedCount}
          onChange={(e) => setDraft({ ...draft, finishedCount: Number(e.target.value) || 0 })}
        />
      </label>

      <label className="form-row">
        <span>便签备注</span>
        <input
          placeholder="如：客户现场取走，围石缺一颗"
          value={draft.note}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
        />
      </label>

      {draft.orderId && (
        <div className="entry-editor">
          <p className="subhead">裸石按原单逐颗核对（{available.length} 颗待镶）</p>
          {draft.entries.length === 0 && <p className="empty">该订单已无待镶裸石。</p>}
          {draft.entries.map((entry, i) => {
            const stone = ledger.stones.find((s) => s.id === entry.stoneId);
            return (
              <EntryFields
                key={entry.stoneId}
                entry={entry}
                orders={ledger.orders.filter((o) => o.id !== draft.orderId)}
                disabled={false}
                onChange={(next) => patchEntry(i, next)}
                meta={stone ? `${stone.species} · ${stone.shape} ${stone.sizeMm}mm` : ""}
              />
            );
          })}
        </div>
      )}

      <button className="primary wide" onClick={submit} disabled={!draft.orderId}>
        开回执（待处理）
      </button>
    </section>
  );
}

function EntryFields({
  entry,
  orders,
  disabled,
  onChange,
  meta,
}: {
  entry: ReceiptEntry;
  orders: Order[];
  disabled: boolean;
  onChange: (next: ReceiptEntry) => void;
  meta?: string;
}) {
  return (
    <div className="entry-row">
      <div className="entry-head">
        <b>{entry.stoneId}</b>
        {meta && <em>{meta}</em>}
      </div>
      <div className="entry-controls">
        <select
          value={entry.result}
          disabled={disabled}
          onChange={(e) => {
            const result = e.target.value as ReceiptEntry["result"];
            onChange({ ...entry, result, target: result === "改配" ? entry.target ?? "return" : undefined });
          }}
        >
          <option value="成品">成品</option>
          <option value="缺件">缺件</option>
          <option value="改配">改配</option>
        </select>
        {entry.result === "成品" && (
          <input
            placeholder="实际镶嵌编号"
            value={entry.actualId}
            disabled={disabled}
            onChange={(e) => onChange({ ...entry, actualId: e.target.value })}
          />
        )}
        {entry.result === "改配" && (
          <select
            value={entry.target ?? "return"}
            disabled={disabled}
            onChange={(e) => onChange({ ...entry, target: e.target.value })}
          >
            <option value="return">退回配石仓</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                改配到 {o.id}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

function ReceiptCard({ ledger, receipt, run }: ViewProps & { receipt: Receipt }) {
  const order = findOrder(ledger, receipt.orderId);
  const conflicts = receiptConflicts(ledger, receipt.id);
  const open = openConflicts(ledger, receipt.id);
  const guard = canWriteOff(ledger, receipt.id);
  const locked = receipt.status !== "待处理";

  const patch = (updater: (r: Receipt) => void) =>
    run((d) => {
      const r = d.receipts.find((x) => x.id === receipt.id);
      if (r) updater(r);
    });

  return (
    <article className={`receipt-card status-${receipt.status}`}>
      <header className="receipt-head">
        <div>
          <h3>
            {receipt.id}
            <span className={`status-badge ${receipt.status}`}>{receipt.status}</span>
          </h3>
          <p className="receipt-meta">
            {receipt.orderId} · {order?.title ?? "订单已不存在"} · {receipt.artisan} · 交付 {fmtTime(receipt.deliveredAt)}
          </p>
          {receipt.note && <p className="receipt-note">便签：{receipt.note}</p>}
          {receipt.resetReason && <p className="reset-banner">↩ {receipt.resetReason}</p>}
          {receipt.status === "已核销" && <p className="written-at">核销时间：{fmtTime(receipt.writtenOffAt)}</p>}
        </div>
        <div className="receipt-count">
          <small>报成品数</small>
          {receipt.status === "待处理" ? (
            <input
              type="number"
              min={0}
              value={receipt.finishedCount}
              onChange={(e) => patch((r) => (r.finishedCount = Number(e.target.value) || 0))}
            />
          ) : (
            <strong>{receipt.finishedCount}</strong>
          )}
        </div>
      </header>

      {receipt.status === "待处理" && (
        <div className="receipt-fields">
          <label>
            <span>交付时间</span>
            <input
              type="datetime-local"
              value={receipt.deliveredAt}
              onChange={(e) => patch((r) => (r.deliveredAt = e.target.value))}
            />
          </label>
          <label>
            <span>师傅</span>
            <select value={receipt.artisan} onChange={(e) => patch((r) => (r.artisan = e.target.value))}>
              {ARTISANS.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="entry-list">
        {receipt.entries.map((entry, i) => {
          const stone = ledger.stones.find((s) => s.id === entry.stoneId);
          return (
            <EntryFields
              key={`${entry.stoneId}-${i}`}
              entry={entry}
              orders={ledger.orders.filter((o) => o.id !== receipt.orderId)}
              disabled={locked}
              meta={stone ? `${stone.species} · ${stone.shape} ${stone.sizeMm}mm · ${stone.slot}` : ""}
              onChange={(next) =>
                patch((r) => {
                  r.entries[i] = next;
                })
              }
            />
          );
        })}
      </div>

      {conflicts.length > 0 && (
        <div className="conflict-box">
          <p className="subhead danger">
            冲突记录（{open.length} 条未决{receipt.status === "已核销" ? "，回执已核销留档" : ""}）
          </p>
          {conflicts.map((c) => (
            <ConflictRow
              key={c.id}
              ledger={ledger}
              conflict={c}
              locked={receipt.status === "已核销"}
              run={run}
            />
          ))}
        </div>
      )}

      <footer className="receipt-actions">
        {receipt.status === "待处理" && (
          <>
            <button
              className="primary"
              onClick={() => run((d) => checkReceipt(d, receipt.id), "逐颗核对完成，冲突已列出")}
            >
              逐颗核对
            </button>
            <button
              onClick={() => {
                if (window.confirm("删除这张待处理回执？")) run((d) => deleteReceipt(d, receipt.id), "回执已删除");
              }}
            >
              删除
            </button>
          </>
        )}
        {receipt.status === "已核对" && (
          <>
            <button onClick={() => run((d) => checkReceipt(d, receipt.id), "已按最新台账重新核对")}>
              重新核对
            </button>
            <button
              className="primary"
              disabled={!guard.ok}
              title={guard.reason}
              onClick={() =>
                run(
                  (d) => writeOff(d, receipt.id),
                  `${receipt.id} 已核销：待镶数、成品清单、尺寸筛选已同步`,
                )
              }
            >
              确认核销
            </button>
            <button
              onClick={() => {
                if (window.confirm("删除这张回执？")) run((d) => deleteReceipt(d, receipt.id), "回执已删除");
              }}
            >
              删除
            </button>
            {!guard.ok && <span className="block-tip">⛔ {guard.reason}</span>}
          </>
        )}
        {receipt.status === "已核销" && <span className="done-tip">本回执已核销并入台账</span>}
      </footer>
    </article>
  );
}

function ConflictRow({
  ledger,
  conflict,
  locked,
  run,
}: ViewProps & { conflict: Conflict; locked: boolean }) {
  const [choice, setChoice] = useState<ConflictResolution>(CONFLICT_OPTIONS[conflict.kind][0].value);
  const options = CONFLICT_OPTIONS[conflict.kind];

  return (
    <div className={`conflict-row ${conflict.resolved ? "resolved" : ""}`}>
      <div className="conflict-main">
        <span className={`conflict-kind ${conflict.kind}`}>{conflict.kind}</span>
        <span>{conflict.detail}</span>
      </div>
      {locked ? (
        <div className="conflict-handle">
          {conflict.resolved ? <em className="resolved-tag">已按「{conflict.resolution}」核销</em> : null}
        </div>
      ) : conflict.resolved ? (
        <div className="conflict-handle">
          <em className="resolved-tag">已处理：{conflict.resolution}</em>
          <button onClick={() => run((d) => reopenConflict(d, conflict.id), "已撤销处理")}>撤销</button>
        </div>
      ) : (
        <div className="conflict-handle">
          <select value={choice} onChange={(e) => setChoice(e.target.value as ConflictResolution)}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            className="primary small"
            onClick={() => run((d) => resolveConflict(d, conflict.id, choice), "冲突已处理")}
          >
            处理
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 宝石台账

function LedgerView({ ledger, run }: ViewProps) {
  const [scope, setScope] = useState<ScopeKey>("pending");
  const [filter, setFilter] = useState<StoneFilter>(EMPTY_FILTER);
  const [slotFocus, setSlotFocus] = useState<StoneSlot | "all">("all");

  const batches = useMemo(() => Array.from(new Set(ledger.stones.map((s) => s.batch))).sort(), [ledger]);

  const filtered = useMemo(() => selectStones(ledger, scope, filter), [ledger, scope, filter]);
  const counts = useMemo(() => sizeBucketCounts(ledger, scope, filter), [ledger, scope, filter]);
  const stats = getStats(ledger);

  const patchFilter = (patch: Partial<StoneFilter>) => setFilter((f) => ({ ...f, ...patch }));

  return (
    <div className="ledger-layout">
      <aside className="panel filter-panel">
        <p className="subhead">视图</p>
        <div className="scope-tabs">
          {SCOPES.map((s) => (
            <button key={s.key} className={scope === s.key ? "active" : ""} onClick={() => setScope(s.key)}>
              {s.label}
            </button>
          ))}
        </div>

        <p className="subhead">形状筛选</p>
        <div className="chips">
          <button className={filter.shape === "all" ? "on" : ""} onClick={() => patchFilter({ shape: "all" })}>
            全部形状
          </button>
          {SHAPES.map((shape) => (
            <button
              key={shape}
              className={filter.shape === shape ? "on" : ""}
              onClick={() => patchFilter({ shape: shape as StoneShape })}
            >
              {shape}
            </button>
          ))}
        </div>

        <p className="subhead">尺寸筛选（随核销同步）</p>
        <div className="chips size-chips">
          {SIZE_BUCKETS.map((b) => (
            <button
              key={b.key}
              className={filter.sizeBucket === b.key ? "on" : ""}
              onClick={() => patchFilter({ sizeBucket: b.key })}
            >
              {b.label}
              <em>{counts[b.key]}</em>
            </button>
          ))}
        </div>

        <p className="subhead">分拣批次</p>
        <select value={filter.batch} onChange={(e) => patchFilter({ batch: e.target.value })}>
          <option value="all">全部批次</option>
          {batches.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>

        <p className="subhead">搜索</p>
        <input
          placeholder="编号 / 种类 / 订单 / 位置"
          value={filter.keyword}
          onChange={(e) => patchFilter({ keyword: e.target.value })}
        />

        <p className="filter-foot">
          缺陷备注 <b>{stats.defectCount}</b> 条 · 改配待核{" "}
          <b>{ledger.stones.filter((s) => s.status === "待镶" && s.reallocated).length}</b> 颗
        </p>
      </aside>

      <section className="panel order-panel">
        <div className="heading">
          <div>
            <p>按订单查看</p>
            <h2>宝石清单 · {SCOPES.find((s) => s.key === scope)?.label}</h2>
          </div>
          <span className="hint">
            命中 {filtered.length} 颗
            {slotFocus !== "all" ? ` · 位置聚焦：${slotFocus}` : ""}
          </span>
        </div>

        {slotFocus !== "all" && (
          <button className="slot-clear" onClick={() => setSlotFocus("all")}>
            清除位置聚焦
          </button>
        )}

        {ledger.orders.map((order) => {
          const rows = filtered.filter((s) => s.orderId === order.id);
          const all = orderStones(ledger, order.id);
          return (
            <OrderBlock
              key={order.id}
              order={order}
              rows={rows}
              allStones={all}
              otherOrders={ledger.orders.filter((o) => o.id !== order.id)}
              scope={scope}
              slotFocus={slotFocus}
              onSlot={setSlotFocus}
              run={run}
            />
          );
        })}
      </section>
    </div>
  );
}

function OrderBlock({
  order,
  rows,
  allStones,
  otherOrders,
  scope,
  slotFocus,
  onSlot,
  run,
}: {
  order: Order;
  rows: Stone[];
  allStones: Stone[];
  otherOrders: Order[];
  scope: ScopeKey;
  slotFocus: StoneSlot | "all";
  onSlot: (slot: StoneSlot | "all") => void;
  run: ViewProps["run"];
}) {
  const [reallocFor, setReallocFor] = useState<string | null>(null);
  const highlight = new Set(rows.map((s) => s.id));

  return (
    <article className="order-block">
      <header className="order-head">
        <h3>
          {order.id} · {order.title}
        </h3>
        <span>
          客户 {order.customer} · 本单 {allStones.length} 颗 · 当前视图 {rows.length} 颗
        </span>
      </header>

      <SettingDiagram stones={allStones} highlighted={highlight} slotFocus={slotFocus} onSlot={onSlot} />

      {rows.length === 0 ? (
        <p className="empty">当前筛选下没有裸石。</p>
      ) : (
        <div className="table-scroll">
          <table className="stone-table">
            <thead>
              <tr>
                <th>宝石编号</th>
                <th>种类</th>
                <th>形状</th>
                <th>克拉</th>
                <th>尺寸</th>
                <th>净度</th>
                <th>颜色</th>
                <th>切工</th>
                <th>镶嵌位置</th>
                <th>批次</th>
                <th>状态</th>
                <th>缺陷备注</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={s.defectNote ? "has-defect" : ""}>
                  <td className="mono">{s.id}</td>
                  <td>{s.species}</td>
                  <td>{s.shape}</td>
                  <td>{s.carat.toFixed(2)}</td>
                  <td>{s.sizeMm}mm</td>
                  <td>{s.clarity}</td>
                  <td>{s.color}</td>
                  <td>{s.cut}</td>
                  <td>
                    <button className="slot-link" onClick={() => onSlot(s.slot)} title="在示意图中聚焦该位置">
                      {s.slot}
                    </button>
                  </td>
                  <td>{s.batch}</td>
                  <td>
                    <span className={`stone-status ${s.status} ${s.reallocated ? "realloc" : ""}`}>
                      {s.status === "待镶" && s.reallocated ? "改配待核" : s.status}
                    </span>
                    {s.setBy && <em className="set-by">{s.setBy} · {fmtTime(s.setAt)}</em>}
                    {s.remark && <em className="stone-remark">{s.remark}</em>}
                  </td>
                  <td className="defect-cell">{s.defectNote ?? "—"}</td>
                  <td>
                    {scope === "pending" && !s.reallocated && (
                      reallocFor === s.id ? (
                        <span className="inline-realloc">
                          <select
                            defaultValue=""
                            onChange={(e) => {
                              if (!e.target.value) return;
                              run((d) => reallocateStone(d, s.id, e.target.value), `${s.id} 已改配，未核销回执退回待处理`);
                              setReallocFor(null);
                            }}
                          >
                            <option value="" disabled>
                              去向…
                            </option>
                            <option value="return">配石仓</option>
                            {otherOrders.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.id}
                              </option>
                            ))}
                          </select>
                          <button onClick={() => setReallocFor(null)}>取消</button>
                        </span>
                      ) : (
                        <button className="small" onClick={() => setReallocFor(s.id)}>
                          改配
                        </button>
                      )
                    )}
                    {scope === "reallocated" && (
                      <button
                        className="small"
                        onClick={() => run((d) => undoReallocation(d, s.id), `${s.id} 已撤销改配`)}
                      >
                        撤销改配
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function ringPositions(count: number, radius: number) {
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (i / Math.max(count, 1)) * Math.PI * 2;
    return { x: 100 + radius * Math.cos(angle), y: 100 + radius * Math.sin(angle) };
  });
}

const SLOT_LEGEND: { slot: StoneSlot; label: string }[] = [
  { slot: "主石位", label: "主石位" },
  { slot: "围石A组", label: "围石A组（内环）" },
  { slot: "围石B组", label: "围石B组（外环）" },
  { slot: "配石位", label: "配石位（左侧）" },
];

function SettingDiagram({
  stones,
  highlighted,
  slotFocus,
  onSlot,
}: {
  stones: Stone[];
  highlighted: Set<string>;
  slotFocus: StoneSlot | "all";
  onSlot: (slot: StoneSlot) => void;
}) {
  const mains = stones.filter((s) => s.slot === "主石位");
  const groupA = stones.filter((s) => s.slot === "围石A组");
  const groupB = stones.filter((s) => s.slot === "围石B组");
  const accents = stones.filter((s) => s.slot === "配石位");

  const renderDot = (s: Stone, p: { x: number; y: number }, r = 6) => {
    const dim = !highlighted.has(s.id) || (slotFocus !== "all" && s.slot !== slotFocus);
    return (
      <circle
        key={s.id}
        cx={p.x}
        cy={p.y}
        r={r}
        fill={dim ? "#d9e2ef" : stoneTone(s)}
        stroke={s.defectNote ? "#f59e0b" : "#ffffff"}
        strokeWidth={s.defectNote ? 2.2 : 1.2}
      >
        <title>{`${s.id} · ${s.species} · ${s.slot} · ${s.reallocated ? "改配待核" : s.status}${s.defectNote ? ` · 缺陷：${s.defectNote}` : ""}`}</title>
      </circle>
    );
  };

  return (
    <div className="diagram-wrap">
      <svg className="setting-diagram" viewBox="0 0 200 200" role="img" aria-label="镶嵌位置示意图">
        <circle cx="100" cy="100" r="96" fill="none" stroke="#d9e2ef" strokeDasharray="3 4" />
        <circle cx="100" cy="100" r="80" fill="none" stroke="#e7edf5" />
        <circle cx="100" cy="100" r="56" fill="none" stroke="#e7edf5" />

        {/* 主石位 */}
        {mains[0] &&
          renderDot(mains[0], { x: 100, y: 100 }, Math.max(14, Math.min(22, 10 + mains[0].sizeMm * 1.6)))}
        {mains.slice(1).map((s, i) => {
          const p = ringPositions(mains.length - 1, 36)[i];
          return renderDot(s, p, 8);
        })}

        {/* 围石两组 */}
        {groupA.map((s, i) => renderDot(s, ringPositions(Math.max(groupA.length, 8), 56)[i]))}
        {groupB.map((s, i) => renderDot(s, ringPositions(Math.max(groupB.length, 8), 80)[i]))}

        {/* 配石位：左侧竖排 */}
        {accents.map((s, i) => renderDot(s, { x: 12, y: 100 + (i - (accents.length - 1) / 2) * 15 }, 5))}
      </svg>
      <div className="diagram-legend">
        <p className="subhead">镶嵌位置示意图（点击聚焦）</p>
        <div className="legend-chips">
          {SLOT_LEGEND.map((l) => (
            <button
              key={l.slot}
              className={slotFocus === l.slot ? "on" : ""}
              onClick={() => onSlot(l.slot)}
            >
              {l.label}
            </button>
          ))}
        </div>
        <ul className="legend-notes">
          <li><i style={{ background: "#be123c" }} />待镶</li>
          <li><i style={{ background: "#0f766e" }} />成品</li>
          <li><i style={{ background: "#a855f7" }} />改配/缺件核销</li>
          <li><i className="defect" />橙圈＝缺陷备注</li>
        </ul>
      </div>
    </div>
  );
}
