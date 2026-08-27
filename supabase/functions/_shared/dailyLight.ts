// ============================================================
// dailyLight.ts — Layer 2b: 日照不足の日次判定（純ロジック / I/Oなし）
//
// なぜ emotionEngine.ts と分けるのか:
//   土壌水分や温度は「今この瞬間の値」がそのままダメージに直結するが、
//   日照不足は「1日の積算光量が足りたか」という日単位の量。
//   判定軸が違うものを同じ状態機械に載せると、判定時刻の前後で
//   主訴が出たり消えたりして hasTransitioned が誤発火する。
//   よって経路ごと分離し、こちらは日に最大2回だけ発火する。
//
// このファイルは Deno にも Supabase にも依存しない純関数のみ。
// I/O は dailyLightJob.ts が担当する（tsx でそのままテストできる）。
// ============================================================

// ------------------------------------------------------------
// 設定（全植物共通のスケジュール・堅牢性パラメータ）
// 植物ごとに変わる「目標積算光量」は config.ts の lightDaily.comfortLow
// ------------------------------------------------------------
export interface DailyLightConfig {
  /** 途中経過をチェックする時刻（JST）。まだ移動して間に合う時間帯を選ぶ */
  checkpointHour: number;
  /** その時点で1日の目標の何割に達していれば「順調」とみなすか */
  checkpointRatio: number;
  /** 1日を締めて確定判定する時刻（JST） */
  deadlineHour: number;
  /** 締め切り時、目標の何割に達していれば「達成」とみなすか（不感帯） */
  deadlineRatio: number;
  /** 台形則で許容する最大サンプル間隔（分）。欠測の面積水増しを防ぐ */
  maxGapMinutes: number;
  /** 判定に必要な最低カバレッジ。これを下回る日は判定しない */
  minCoverage: number;
  /** カバレッジの分母に含める日中帯の開始時刻（JST） */
  daylightStartHour: number;
  /** 同・終了時刻（JST） */
  daylightEndHour: number;
}

export const DAILY_LIGHT: DailyLightConfig = {
  checkpointHour: 15,
  checkpointRatio: 0.6, // 実測で検証済み（達成日の15時最低=目標の1.07倍、不足日の最高=0.40倍）
  deadlineHour: 20,
  deadlineRatio: 0.9, // 目標の9割に届けば達成扱い（惜しい日に通知しない不感帯）
  maxGapMinutes: 20, // POST間隔10分の2倍
  minCoverage: 0.8,
  daylightStartHour: 6, // 実測で 6〜17時のサンプル数は 5.3〜6.2/時（ほぼ満点）
  daylightEndHour: 18, // 18時以降は 3.1/時まで落ちるが lux≒0 なので積算に影響しない
};

// ------------------------------------------------------------
// JST ユーティリティ
// Edge Functions は UTC で動くので、「1日」の境界を自前で持つ必要がある。
// ------------------------------------------------------------
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** その瞬間のJSTでの時（0〜23） */
export function jstHour(d: Date): number {
  return new Date(d.getTime() + JST_OFFSET_MS).getUTCHours();
}

/** その瞬間が属するJSTの日の 00:00 を、UTCのDateとして返す */
export function jstDayStart(d: Date): Date {
  const shifted = new Date(d.getTime() + JST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - JST_OFFSET_MS);
}

/** "2026-08-23" 形式のJST日付キー（連続日数のカウントに使う） */
export function jstDateKey(d: Date): string {
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 今日のチェックポイント枠・締め切り枠の境界時刻 */
export function dailyLightWindows(
  now: Date,
  cfg: DailyLightConfig = DAILY_LIGHT,
) {
  const dayStart = jstDayStart(now);
  return {
    dayStart,
    checkpointStart: new Date(
      dayStart.getTime() + cfg.checkpointHour * HOUR_MS,
    ),
    deadlineStart: new Date(dayStart.getTime() + cfg.deadlineHour * HOUR_MS),
  };
}

// ------------------------------------------------------------
// 積算光量の計算（台形則）
//
// 面積 = Σ (lux_i + lux_{i+1}) / 2 × Δt
//
// ★Δtに上限を設けるのが肝。POSTが3時間落ちた直後に明るい値が1件来ると、
//   その1サンプルが3時間分の面積として計上され積算が跳ね上がる。
//   Δtをクランプすると同時に「カバレッジ」も下がるので、
//   面積の過小評価と信頼性フラグが自動的に連動する。
// ------------------------------------------------------------
export interface LuxSample {
  at: string | Date; // ISO文字列 or Date
  lux: number;
}

export interface LightIntegral {
  luxHours: number; // 積算光量（lux·h）
  coveredHours: number; // 日中帯のうちデータで埋まっていた時間
  windowHours: number; // 日中帯の長さ（カバレッジの分母）
  coverage: number; // coveredHours / windowHours（0〜1）
  reliable: boolean; // 判定に足る欠測率か
  sampleCount: number;
}

export function integrateLuxHours(
  samples: LuxSample[],
  windowStart: Date,
  windowEnd: Date,
  cfg: DailyLightConfig = DAILY_LIGHT,
): LightIntegral {
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();
  const maxGapMs = cfg.maxGapMinutes * 60 * 1000;

  // ★カバレッジの分母は「窓と日中帯の重なり」に限定する。
  //   夜間はPOSTが落ちがち（実測: 18〜5時は 1.4〜4.7件/時）だが、
  //   その時間帯の lux はほぼ0なので積算光量には影響しない。
  //   24時間を分母にすると、日中が健全な日まで判定不能になってしまう。
  const dayStart = jstDayStart(windowStart).getTime();
  const dlStart = Math.max(startMs, dayStart + cfg.daylightStartHour * HOUR_MS);
  const dlEnd = Math.min(endMs, dayStart + cfg.daylightEndHour * HOUR_MS);
  const denomMs = Math.max(0, dlEnd - dlStart);

  // 窓内のサンプルだけを時刻昇順に整える
  const pts = samples
    .map((s) => ({
      t: (s.at instanceof Date ? s.at : new Date(s.at)).getTime(),
      lux: Number(s.lux),
    }))
    .filter((p) =>
      Number.isFinite(p.t) && Number.isFinite(p.lux) &&
      p.t >= startMs && p.t <= endMs
    )
    .map((p) => ({ t: p.t, lux: Math.max(0, p.lux) })) // 負値・異常値は0扱い
    .sort((a, b) => a.t - b.t);

  let areaLuxMs = 0;
  let coveredMs = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const rawDt = pts[i + 1].t - pts[i].t;
    if (rawDt <= 0) continue; // 同時刻の重複POSTは無視
    const dt = Math.min(rawDt, maxGapMs);
    // 積算は窓全体で行う（夜間の微光も拾う）
    areaLuxMs += ((pts[i].lux + pts[i + 1].lux) / 2) * dt;
    // カバレッジは日中帯との重なりぶんだけ計上する
    const segStart = pts[i].t;
    const segEnd = segStart + dt;
    coveredMs += Math.max(
      0,
      Math.min(segEnd, dlEnd) - Math.max(segStart, dlStart),
    );
  }

  const coverage = denomMs > 0 ? coveredMs / denomMs : 0;

  return {
    luxHours: Math.round(areaLuxMs / HOUR_MS),
    coveredHours: round2(coveredMs / HOUR_MS),
    windowHours: round2(denomMs / HOUR_MS),
    coverage: Math.round(coverage * 1000) / 1000,
    reliable: pts.length >= 2 && coverage >= cfg.minCoverage,
    sampleCount: pts.length,
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

// ------------------------------------------------------------
// 判定
//
//   kind = "warning"   … 15時: このままだと今日は足りなさそう（まだ間に合う）
//   kind = "shortfall" … 20時: 今日は足りなかった（明日の置き場所をお願い）
//   kind = "recovered" … 20時: 警告後に飼い主が動かしてくれて目標達成
//   kind = "none"      … 通知しない（理由は reason に入る）
//
// ★「警告していない日は達成しても黙る」のが要点。
//   警告 → 介入 → 結果確定 という因果があるときだけ回復通知を出す。
// ------------------------------------------------------------
export type DailyLightVerdictKind =
  | "none"
  | "warning"
  | "shortfall"
  | "recovered";

export interface DailyLightVerdict {
  kind: DailyLightVerdictKind;
  reason: string;
  target: number;
  achievedRatio: number; // luxHours / target
  integral: LightIntegral;
}

export function judgeDailyLight(args: {
  now: Date;
  samples: LuxSample[];
  targetLuxHours: number;
  warnedToday: boolean; // 今日のチェックポイント枠で既に通知済みか
  closedToday: boolean; // 今日の締め切り枠で既に通知済みか
  cfg?: DailyLightConfig;
}): DailyLightVerdict {
  const cfg = args.cfg ?? DAILY_LIGHT;
  const { now, targetLuxHours: target } = args;
  const hour = jstHour(now);
  const { dayStart } = dailyLightWindows(now, cfg);

  const empty: LightIntegral = {
    luxHours: 0,
    coveredHours: 0,
    windowHours: 0,
    coverage: 0,
    reliable: false,
    sampleCount: 0,
  };
  const none = (reason: string, integral = empty): DailyLightVerdict => ({
    kind: "none",
    reason,
    target,
    achievedRatio: 0,
    integral,
  });

  if (hour < cfg.checkpointHour) return none("判定時刻ではない");
  if (target <= 0) return none("目標積算光量が未設定");

  const integral = integrateLuxHours(args.samples, dayStart, now, cfg);
  const ratio = integral.luxHours / target;
  const base = {
    target,
    achievedRatio: Math.round(ratio * 1000) / 1000,
    integral,
  };

  // ---- 締め切り枠（20時以降） ----
  if (hour >= cfg.deadlineHour) {
    if (args.closedToday) return none("締め切り判定は通知済み", integral);
    if (!integral.reliable) {
      return none(
        `欠測が多く判定不能（カバレッジ${integral.coverage}）`,
        integral,
      );
    }
    if (ratio >= cfg.deadlineRatio) {
      // 目標達成。警告を出した日だけ「間に合ったね」を返す
      return args.warnedToday
        ? { kind: "recovered", reason: "警告後に目標を達成した", ...base }
        : none("目標達成（警告していないので黙る）", integral);
    }
    return {
      kind: "shortfall",
      reason: "今日の積算光量が目標に届かなかった",
      ...base,
    };
  }

  // ---- チェックポイント枠（15時〜20時未満） ----
  if (args.warnedToday) return none("チェックポイントは通知済み", integral);
  if (!integral.reliable) {
    return none(
      `欠測が多く判定不能（カバレッジ${integral.coverage}）`,
      integral,
    );
  }
  if (ratio >= cfg.checkpointRatio) {
    return none("この時点では順調", integral);
  }
  return {
    kind: "warning",
    reason: "このままでは今日の目標に届かない見込み",
    ...base,
  };
}

// ------------------------------------------------------------
// 連続不足日数のカウント（昨日から遡る）
// emotionTable.ts の継続時間軸にそのまま乗せるために時間へ換算する
// ------------------------------------------------------------
export function countConsecutiveShortDays(
  shortfallDateKeys: string[], // 過去に shortfall を出したJST日付（重複可）
  now: Date,
  lookbackDays = 14,
): number {
  const set = new Set(shortfallDateKeys);
  const todayStart = jstDayStart(now).getTime();
  let n = 0;
  for (let i = 1; i <= lookbackDays; i++) {
    if (set.has(jstDateKey(new Date(todayStart - i * DAY_MS)))) n++;
    else break;
  }
  return n;
}
