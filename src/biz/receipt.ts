// 核销判断：逐颗核对规则与冲突识别，纯函数，不碰存储与 DOM。
// 缺件、串单、编号不符一律列冲突并挡住核销；
// 缺件与改配可由台面逐行确认后核销，其余须改回正确编号。

import type { Ledger, Receipt, ReceiptLine, SettleEffect, Stone } from "./store";

export type ConflictKind =
  | "missing" // 缺件：应到裸石未交回
  | "stray" // 串入：交回了本单之外的裸石
  | "mismatch" // 编号不符：交回编号与原单对不上 / 查无此石
  | "reassigned" // 已改配：原单裸石已改配到别的订单
  | "duplicate" // 同一编号被多行重复交回
  | "settled"; // 该石已在此前回执中核销

export interface Conflict {
  kind: ConflictKind;
  lineIndex: number; // 所属核对行，跨行为 -1
  code?: string;
  message: string;
  resolvable: boolean; // 能否在本行直接确认核销（缺件 / 改配）
}

export interface VerifyResult {
  conflicts: Conflict[];
  canSettle: boolean;
  effects: SettleEffect[];
  finishedActual: number; // 实际成品数
  bareCount: number; // 照常退回、仍待镶的裸石数
  missingWriteOff: number; // 确认缺件核销数
  reassignedWriteOff: number; // 确认改配核销数
}

/** 按订单当前待镶裸石预填逐颗核对行。 */
export function buildLinesFromOrder(ledger: Ledger, orderId: string): ReceiptLine[] {
  return ledger.stones
    .filter((s) => s.orderId === orderId && s.status === "pending")
    .map((s) => ({
      expectedCode: s.code,
      returnedCode: s.code,
      finished: true,
      note: "",
    }));
}

function findStone(ledger: Ledger, code: string): Stone | undefined {
  return ledger.stones.find((s) => s.code === code.trim());
}

/**
 * 逐颗核对：
 * - 应到石仍在本单：编号一致且打了成品标 → 成品核销；空回且确认缺件 → 缺件核销；
 *   空回未确认 → 缺件冲突挡核销；编号不同 → 按查无 / 串单 / 编号不符列冲突。
 * - 应到石已改配出本单 → 改配冲突，确认后该行按改配核销（不动对方订单的石头）。
 * - 无原单编号却交回石头 → 串入（多收）冲突。
 */
export function verifyReceipt(ledger: Ledger, receipt: Receipt): VerifyResult {
  const conflicts: Conflict[] = [];
  const effects: SettleEffect[] = [];
  let finishedActual = 0;
  let bareCount = 0;
  let missingWriteOff = 0;
  let reassignedWriteOff = 0;

  // 交回编号出现次数，用于识别重复交回
  const returnedCounts = new Map<string, number>();
  for (const line of receipt.lines) {
    const code = line.returnedCode.trim();
    if (code) returnedCounts.set(code, (returnedCounts.get(code) ?? 0) + 1);
  }
  const reportedDup = new Set<string>();

  receipt.lines.forEach((line, i) => {
    const expected = line.expectedCode.trim();
    const returned = line.returnedCode.trim();

    // 空白行忽略
    if (!expected && !returned) return;

    if (!expected) {
      // 多收 / 串入
      const stone = returned ? findStone(ledger, returned) : undefined;
      if (!stone) {
        conflicts.push({
          kind: "mismatch",
          lineIndex: i,
          code: returned,
          message: `交回编号 ${returned} 在台账中查无此石`,
          resolvable: false,
        });
      } else if (stone.orderId === receipt.orderId) {
        conflicts.push({
          kind: "stray",
          lineIndex: i,
          code: returned,
          message: `${returned} 属本单但不在原单逐颗清单内，疑似多收/重复行`,
          resolvable: false,
        });
      } else {
        conflicts.push({
          kind: "stray",
          lineIndex: i,
          code: returned,
          message: `串单：${returned} 归属订单 ${stone.orderId}，不在 ${receipt.orderId} 原单内`,
          resolvable: false,
        });
      }
      return;
    }

    const expectedStone = findStone(ledger, expected);
    if (!expectedStone) {
      conflicts.push({
        kind: "mismatch",
        lineIndex: i,
        code: expected,
        message: `原单编号 ${expected} 在台账中不存在`,
        resolvable: false,
      });
      return;
    }

    // 原单裸石已改配到别的订单
    if (expectedStone.orderId !== receipt.orderId) {
      if (line.ackReassigned) {
        reassignedWriteOff += 1;
      } else {
        conflicts.push({
          kind: "reassigned",
          lineIndex: i,
          code: expected,
          message: `裸石 ${expected} 已改配至订单 ${expectedStone.orderId}，需确认按改配核销`,
          resolvable: true,
        });
      }
      return;
    }

    // 应到石仍在本单
    if (expectedStone.status !== "pending") {
      conflicts.push({
        kind: "settled",
        lineIndex: i,
        code: expected,
        message: `裸石 ${expected} 已在此前回执中核销（状态：${statusLabel(expectedStone.status)}）`,
        resolvable: false,
      });
      return;
    }

    if (!returned) {
      if (line.ackMissing) {
        missingWriteOff += 1;
        effects.push({ stoneCode: expected, status: "missing" });
      } else {
        conflicts.push({
          kind: "missing",
          lineIndex: i,
          code: expected,
          message: `缺件：原单裸石 ${expected} 未交回，确认后按缺件核销`,
          resolvable: true,
        });
      }
      return;
    }

    if (returned !== expected) {
      const returnedStone = findStone(ledger, returned);
      if (!returnedStone) {
        conflicts.push({
          kind: "mismatch",
          lineIndex: i,
          code: returned,
          message: `编号不符：应交 ${expected}，交回 ${returned}，该编号查无此石`,
          resolvable: false,
        });
      } else if (returnedStone.orderId !== receipt.orderId) {
        conflicts.push({
          kind: "stray",
          lineIndex: i,
          code: returned,
          message: `串单：应交 ${expected}，交回的 ${returned} 归属订单 ${returnedStone.orderId}`,
          resolvable: false,
        });
      } else {
        conflicts.push({
          kind: "mismatch",
          lineIndex: i,
          code: returned,
          message: `编号不符：应交 ${expected}，交回了同单的 ${returned}`,
          resolvable: false,
        });
      }
      return;
    }

    if ((returnedCounts.get(returned) ?? 0) > 1) {
      if (!reportedDup.has(returned)) {
        reportedDup.add(returned);
        conflicts.push({
          kind: "duplicate",
          lineIndex: -1,
          code: returned,
          message: `编号 ${returned} 在本回执中被重复交回`,
          resolvable: false,
        });
      }
      return;
    }

    if (line.finished) {
      finishedActual += 1;
      effects.push({ stoneCode: expected, status: "set" });
    } else {
      // 裸石原样退回，照常不动，仍计待镶
      bareCount += 1;
    }
  });

  return {
    conflicts,
    canSettle: conflicts.length === 0,
    effects,
    finishedActual,
    bareCount,
    missingWriteOff,
    reassignedWriteOff,
  };
}

export function statusLabel(status: Stone["status"]): string {
  switch (status) {
    case "pending":
      return "待镶";
    case "set":
      return "已镶成品";
    case "missing":
      return "缺件核销";
    case "lost":
      return "串单转出";
  }
}

export function conflictLabel(kind: ConflictKind): string {
  switch (kind) {
    case "missing":
      return "缺件";
    case "stray":
      return "串单/串入";
    case "mismatch":
      return "编号不符";
    case "reassigned":
      return "已改配";
    case "duplicate":
      return "重复交回";
    case "settled":
      return "已核销";
  }
}
