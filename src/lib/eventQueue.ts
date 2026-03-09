import type { EventType } from "@/types/session";

// ── Constants ──────────────────────────────────────────────────────────────
const STORAGE_PREFIX   = "cflow_eq_";
const MAX_BATCH        = 10;
const FLUSH_INTERVAL   = 5_000;
const MAX_ATTEMPTS     = 5;
const BASE_DELAY_MS    = 2_000;
const MAX_DELAY_MS     = 64_000;

// ── Types ──────────────────────────────────────────────────────────────────
export interface QueuedEvent {
  /** Stable client-side ID used to correlate confirmed server responses. */
  id:             string;
  type:           EventType;
  occurredAt:     string;
  metadata:       Record<string, unknown>;
  attempts:       number;
  lastAttemptAt:  number | null;
}

export interface EventQueueController {
  /** Trigger an immediate flush and wait for it to resolve. */
  flushNow: () => Promise<void>;
  /** Stop the periodic flush, remove listeners, attempt a final flush. */
  stop:     () => void;
}

// ── Storage helpers ────────────────────────────────────────────────────────
function storageKey(sessionId: string) {
  return `${STORAGE_PREFIX}${sessionId}`;
}

function loadQueue(sessionId: string): QueuedEvent[] {
  try {
    const raw = localStorage.getItem(storageKey(sessionId));
    return raw ? (JSON.parse(raw) as QueuedEvent[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(sessionId: string, queue: QueuedEvent[]): void {
  try {
    if (queue.length === 0) {
      localStorage.removeItem(storageKey(sessionId));
    } else {
      localStorage.setItem(storageKey(sessionId), JSON.stringify(queue));
    }
  } catch {
    // Storage unavailable or quota exceeded — degrade gracefully.
  }
}

// ── Retry scheduling ───────────────────────────────────────────────────────
function retryDelay(attempts: number): number {
  // Exponential back-off: 2s, 4s, 8s, 16s, 32s (capped at MAX_DELAY_MS)
  return Math.min(BASE_DELAY_MS * Math.pow(2, attempts - 1), MAX_DELAY_MS);
}

function isEligible(event: QueuedEvent): boolean {
  if (event.attempts >= MAX_ATTEMPTS) return false;
  if (!event.lastAttemptAt) return true;
  return Date.now() - event.lastAttemptAt >= retryDelay(event.attempts);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Add an event to the persistent queue.
 * The event is immediately written to localStorage with a stable client UUID.
 * Nothing is sent to the network here; call flush() or start startEventQueue().
 */
export function enqueue(
  sessionId: string,
  type:      EventType,
  metadata:  Record<string, unknown> = {},
): void {
  const queue = loadQueue(sessionId);
  queue.push({
    id:            crypto.randomUUID(),
    type,
    occurredAt:    new Date().toISOString(),
    metadata,
    attempts:      0,
    lastAttemptAt: null,
  });
  saveQueue(sessionId, queue);
}

/**
 * Attempt to send all eligible queued events for a session.
 *
 * - Batches up to MAX_BATCH events per request.
 * - On success: removes confirmed events from storage.
 * - On failure: increments attempt counts and sets next-eligible timestamps.
 * - Events exceeding MAX_ATTEMPTS are silently dropped.
 * - Re-reads storage after each await so concurrent enqueues are never lost.
 */
export async function flush(sessionId: string): Promise<void> {
  const queue = loadQueue(sessionId);
  if (queue.length === 0) return;

  // Drop permanently exhausted events (keeps storage clean).
  const active = queue.filter(e => e.attempts < MAX_ATTEMPTS);
  if (active.length !== queue.length) {
    saveQueue(sessionId, active);
  }

  const eligible = active.filter(isEligible);
  if (eligible.length === 0) return;

  const batch    = eligible.slice(0, MAX_BATCH);
  const batchIds = new Set(batch.map(e => e.id));

  try {
    const res = await fetch(`/api/sessions/${sessionId}/events`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        events: batch.map(e => ({
          clientEventId: e.id,
          type:          e.type,
          occurredAt:    e.occurredAt,
          metadata:      e.metadata,
        })),
      }),
    });

    // Re-read after await — new events may have been enqueued while waiting.
    const current = loadQueue(sessionId);

    if (res.ok) {
      let confirmed: Set<string>;
      try {
        const data = await res.json() as { confirmed?: string[] };
        confirmed = new Set(data.confirmed ?? batch.map(e => e.id));
      } catch {
        confirmed = new Set(batch.map(e => e.id));
      }
      saveQueue(sessionId, current.filter(e => !confirmed.has(e.id)));
    } else {
      const now = Date.now();
      saveQueue(
        sessionId,
        current
          .filter(e => e.attempts < MAX_ATTEMPTS || !batchIds.has(e.id))
          .map(e =>
            batchIds.has(e.id)
              ? { ...e, attempts: e.attempts + 1, lastAttemptAt: now }
              : e,
          ),
      );
    }
  } catch {
    // Network error — same treatment as a server error.
    const current = loadQueue(sessionId);
    const now = Date.now();
    saveQueue(
      sessionId,
      current
        .filter(e => e.attempts < MAX_ATTEMPTS || !batchIds.has(e.id))
        .map(e =>
          batchIds.has(e.id)
            ? { ...e, attempts: e.attempts + 1, lastAttemptAt: now }
            : e,
        ),
    );
  }
}

/**
 * Start the background flush loop for a session.
 *
 * - Flushes eligible events every FLUSH_INTERVAL milliseconds.
 * - Also flushes when the page becomes hidden (tab switch / navigate away).
 * - Returns a controller to trigger an immediate flush or stop the loop.
 */
export function startEventQueue(sessionId: string): EventQueueController {
  let stopped = false;

  async function run() {
    if (stopped) return;
    try {
      await flush(sessionId);
    } catch {
      // flush() handles its own errors; this is a safety net.
    }
  }

  const timer = setInterval(run, FLUSH_INTERVAL);

  function onVisibilityChange() {
    if (document.visibilityState === "hidden") void run();
  }
  document.addEventListener("visibilitychange", onVisibilityChange);

  return {
    flushNow: run,
    stop() {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void run(); // Best-effort final flush before teardown.
    },
  };
}
