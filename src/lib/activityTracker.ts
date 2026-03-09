/**
 * Activity Tracker — derives active/idle time and focus-loss count from
 * a session's telemetry event stream.
 *
 * Designed as a pure computation: no I/O, no DB queries, O(n) over events.
 */

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Minimal event shape required by the tracker.
 * Structurally compatible with InsightEvent so callers never need to cast.
 */
export interface ActivityEvent {
  type:       string;
  occurredAt: Date;
  metadata?:  Record<string, unknown>;
}

export interface SessionBoundary {
  startedAt: Date;
  endedAt:   Date | null;
}

export interface ActivityResult {
  activeSeconds:  number;
  idleSeconds:    number;
  focusLossCount: number;
}

/**
 * A contiguous time window classified as active (window focused, activity
 * within the last 30 s). Used for O(1) per-range active-time queries after
 * an initial O(n) build phase.
 */
export interface ActiveSegment {
  fromMs: number;
  toMs:   number;
}

// ── Constants ──────────────────────────────────────────────────────────────

/** Inactivity window: focused time beyond this without a heartbeat is idle. */
const IDLE_THRESHOLD_MS = 30_000;

/**
 * Events that reset the inactivity timer while the window is focused.
 * Includes legacy event types so old sessions get a reasonable approximation.
 */
const ACTIVITY_EVENT_TYPES = new Set([
  "editor_activity",
  "problem_scroll",
  "window_focus",   // focus returning is itself an activity signal
  "run",
  "submit",
  "first_keystroke",
  "paste",
]);

/**
 * Events that only exist in sessions recorded after the engagement telemetry
 * rollout. Their presence distinguishes instrumented sessions from legacy ones.
 */
const ENGAGEMENT_TELEMETRY_TYPES = new Set([
  "editor_activity",
  "problem_scroll",
  "window_focus",
  "window_blur",
]);

// ── Core algorithm ─────────────────────────────────────────────────────────

/**
 * Compute active time, idle time, and focus-loss count from a session's
 * telemetry events.
 *
 * Algorithm (single pass, O(n)):
 *
 *   State: { isBlurred, lastActivityAt, cursor }
 *
 *   For each consecutive event pair [cursor → event.occurredAt]:
 *     • If blurred  → entire gap is idle.
 *     • If focused  → the gap is active for at most IDLE_THRESHOLD_MS beyond
 *                     the last activity event; any remainder is idle.
 *   Then update state based on the event type:
 *     • window_blur   → isBlurred = true, focusLossCount++
 *     • window_focus  → isBlurred = false, reset lastActivityAt
 *     • activity type → reset lastActivityAt
 *
 * Backward compatibility:
 *   Sessions recorded before engagement telemetry was introduced contain no
 *   window_focus / window_blur / editor_activity / problem_scroll events.
 *   These sessions are returned as fully active so existing rule logic that
 *   relies on wall-clock session duration is not degraded.
 */
export function computeSessionActivity(
  events:  ActivityEvent[],
  session: SessionBoundary,
): ActivityResult {
  const startMs = session.startedAt.getTime();
  const endMs   = (session.endedAt ?? new Date()).getTime();

  // Sort once — the rest of the algorithm is a single forward sweep.
  const sorted = [...events].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );

  // Backward compatibility: no engagement events → treat full duration as active.
  const hasEngagementEvents = sorted.some((e) => ENGAGEMENT_TELEMETRY_TYPES.has(e.type));
  if (!hasEngagementEvents) {
    return {
      activeSeconds:  Math.max(0, (endMs - startMs) / 1_000),
      idleSeconds:    0,
      focusLossCount: 0,
    };
  }

  let activeMs       = 0;
  let idleMs         = 0;
  let focusLossCount = 0;

  // Assume the session starts focused and immediately active.
  let isBlurred      = false;
  let lastActivityAt = startMs;
  let cursor         = startMs;

  /**
   * Attribute the time span [fromMs, toMs] to active or idle buckets
   * based on the current blur state and the last-activity timestamp.
   *
   * While focused, the user earns "active credit" for IDLE_THRESHOLD_MS
   * after their last activity event. Any gap beyond that is idle.
   */
  function attributeGap(fromMs: number, toMs: number): void {
    const gapMs = toMs - fromMs;
    if (gapMs <= 0) return;

    if (isBlurred) {
      idleMs += gapMs;
    } else {
      // How much active credit remains from the last activity?
      const sinceLast        = fromMs - lastActivityAt; // always >= 0
      const remainingCredit  = Math.max(0, IDLE_THRESHOLD_MS - sinceLast);

      if (gapMs <= remainingCredit) {
        activeMs += gapMs;
      } else {
        activeMs += remainingCredit;
        idleMs   += gapMs - remainingCredit;
      }
    }
  }

  for (const event of sorted) {
    const evMs = event.occurredAt.getTime();

    // Skip events outside the session window.
    if (evMs < startMs || evMs > endMs) continue;

    // Attribute the gap from the last boundary to this event.
    attributeGap(cursor, evMs);

    // Update state.
    if (event.type === "window_blur") {
      if (!isBlurred) {
        isBlurred = true;
        focusLossCount++;
      }
    } else if (event.type === "window_focus") {
      if (isBlurred) {
        isBlurred = false;
      }
      // Focus regaining is itself a signal that the user is back.
      lastActivityAt = evMs;
    }

    if (ACTIVITY_EVENT_TYPES.has(event.type)) {
      lastActivityAt = evMs;
    }

    cursor = evMs;
  }

  // Attribute remaining time from the last event to the session boundary.
  attributeGap(cursor, endMs);

  return {
    activeSeconds:  activeMs / 1_000,
    idleSeconds:    idleMs   / 1_000,
    focusLossCount,
  };
}

// ── Per-range active time ─────────────────────────────────────────────────

/**
 * Build the sorted list of active time segments for a session.
 *
 * Uses the same state machine as computeSessionActivity — one forward sweep,
 * O(n) — but instead of accumulating totals it records (fromMs, toMs) pairs
 * for every contiguous period classified as active.
 *
 * Backward compatibility: sessions without engagement telemetry return a
 * single segment spanning the entire session window, so callers that query
 * a sub-interval get the full wall-clock duration — preserving the behaviour
 * of the original rules.
 */
export function buildActiveSegments(
  events:  ActivityEvent[],
  session: SessionBoundary,
): ActiveSegment[] {
  const startMs = session.startedAt.getTime();
  const endMs   = (session.endedAt ?? new Date()).getTime();

  const sorted = [...events].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );

  // Legacy session: treat the whole window as active.
  if (!sorted.some((e) => ENGAGEMENT_TELEMETRY_TYPES.has(e.type))) {
    return [{ fromMs: startMs, toMs: endMs }];
  }

  const segs: ActiveSegment[] = [];

  let isBlurred      = false;
  let lastActivityAt = startMs;
  let cursor         = startMs;
  /** Start of the current active segment; null while idle. */
  let segStart: number | null = startMs; // session opens focused + active

  const closeActive = (endAt: number) => {
    if (segStart !== null && endAt > segStart) {
      segs.push({ fromMs: segStart, toMs: endAt });
    }
    segStart = null;
  };

  /**
   * Attribute the gap [gapFrom, gapTo].
   * If focused and active credit expires within the gap, close the current
   * active segment at the expiry point. Guards against the case where credit
   * expired before gapFrom (which shouldn't occur in normal flow) with Math.max.
   */
  const processGap = (gapFrom: number, gapTo: number) => {
    if (gapFrom >= gapTo) return;

    if (isBlurred) {
      closeActive(gapFrom);
      return;
    }

    if (segStart !== null) {
      const creditExpiry = lastActivityAt + IDLE_THRESHOLD_MS;
      if (creditExpiry <= gapTo) {
        closeActive(Math.max(creditExpiry, gapFrom));
      }
    }
  };

  for (const event of sorted) {
    const evMs = event.occurredAt.getTime();
    if (evMs < startMs || evMs > endMs) continue;

    processGap(cursor, evMs);

    if (event.type === "window_blur") {
      if (!isBlurred) {
        closeActive(evMs);
        isBlurred = true;
      }
    } else if (event.type === "window_focus") {
      if (isBlurred) {
        isBlurred = false;
        segStart = evMs; // new active segment begins on focus return
      }
      lastActivityAt = evMs;
    }

    if (ACTIVITY_EVENT_TYPES.has(event.type)) {
      if (!isBlurred && segStart === null) {
        segStart = evMs; // activity after inactivity-idle: resume active
      }
      lastActivityAt = evMs;
    }

    cursor = evMs;
  }

  // Flush the tail: apply idle threshold to the remaining gap, then close.
  processGap(cursor, endMs);
  closeActive(endMs);

  return segs;
}

/**
 * Active milliseconds within [fromMs, toMs] given a pre-built segment list.
 *
 * O(n_segments) per call. For typical sessions (< 100 segments) this is
 * negligible. Call buildActiveSegments once and reuse the result.
 */
export function activeMsInRange(
  segments: ActiveSegment[],
  fromMs:   number,
  toMs:     number,
): number {
  let total = 0;
  for (const seg of segments) {
    const lo = Math.max(seg.fromMs, fromMs);
    const hi = Math.min(seg.toMs,   toMs);
    if (lo < hi) total += hi - lo;
  }
  return total;
}
