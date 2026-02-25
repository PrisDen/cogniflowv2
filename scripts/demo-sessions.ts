/**
 * Cogniflow Demo Session Seeder
 *
 * Creates 4 realistic sessions for the test1 account, each crafted to
 * trigger a specific insight. Run with:
 *   npx tsx scripts/demo-sessions.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { generateInsights } from "../src/lib/insights.js";
import type { InsightEvent } from "../src/lib/insights.js";

// Scripts need the session pooler (not pgbouncer) for proper query support
const adapter = new PrismaPg({ connectionString: process.env.SESSION_POOLER_URL ?? process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

// ── Helpers ────────────────────────────────────────────────────────────────

function ago(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

function ms(base: Date, offsetMs: number): Date {
  return new Date(base.getTime() + offsetMs);
}

async function upsertInsights(
  sessionId: string,
  userId: string,
  problemId: string,
) {
  const session = await db.session.findUniqueOrThrow({
    where: { id: sessionId },
    include: { events: true },
  });
  const problem = await db.problem.findUniqueOrThrow({
    where: { id: problemId },
    select: { description: true },
  });

  const wordCount = problem.description.split(/\s+/).length;

  const result = generateInsights({
    session: {
      startedAt:          session.startedAt,
      endedAt:            session.endedAt,
      checkinFeel:        session.checkinFeel,
      checkinPreWork:     session.checkinPreWork,
      checkinInterrupted: session.checkinInterrupted,
      checkinConfidence:  session.checkinConfidence,
    },
    problem: { wordCount },
    events: session.events as unknown as InsightEvent[],
  });

  if (result.critical) {
    await db.sessionInsight.create({
      data: { sessionId, priority: 1, observation: result.critical.observation, message: result.critical.message },
    });
    console.log(`  ✓ Critical: ${result.critical.observation}`);
  }
  if (result.positive) {
    await db.sessionInsight.create({
      data: { sessionId, priority: 2, observation: result.positive.observation, message: result.positive.message },
    });
    console.log(`  ✓ Positive: ${result.positive.observation}`);
  }
  if (!result.critical && !result.positive) {
    console.log(`  ⚠ No insight generated — check thresholds`);
  }
}

// ── Look up required IDs ───────────────────────────────────────────────────

async function getIds() {
  const user = await db.user.findUniqueOrThrow({ where: { email: "test1@cogniflow.dev" } });

  const problems = await db.problem.findMany({
    where: {
      title: {
        in: [
          "Palindrome Check",   // scenario 1: syntax_heavy
          "FizzBuzz",           // scenario 2: logic_heavy
          "Anagram Check",      // scenario 3: logic_heavy
          "Word Frequency",     // scenario 4: paste_detected
          "Reverse Words",      // scenario 5: stuck_loop
          "Remove Duplicates",  // scenario 6: edge_case_blindness
        ],
      },
    },
    select: { id: true, title: true },
  });

  const byTitle = Object.fromEntries(problems.map((p) => [p.title, p.id]));
  return { userId: user.id, problems: byTitle };
}

// ────────────────────────────────────────────────────────────────────────────
// SCENARIO 1 — syntax_heavy
// "Palindrome Check" — student keeps getting SyntaxError / IndentationError
// ────────────────────────────────────────────────────────────────────────────

async function scenario1_syntaxHeavy(userId: string, problemId: string) {
  console.log("\n📋 Scenario 1: syntax_heavy (Palindrome Check)");

  const start = ago(45);
  const session = await db.session.create({
    data: {
      userId,
      problemId,
      outcome:            "failed",
      startedAt:          start,
      endedAt:            ms(start, 22 * 60_000),
      checkinFeel:        2, // struggled
      checkinPreWork:     "none",
      checkinInterrupted: false,
      checkinConfidence:  2, // a little
      checkinCompletedAt: ms(start, 23 * 60_000),
    },
  });

  // first_keystroke — 45 seconds in (plausible reading time)
  await db.sessionEvent.create({ data: { sessionId: session.id, type: "first_keystroke", occurredAt: ms(start, 45_000), metadata: {} } });

  // 4 run events — 3 SyntaxErrors, 1 IndentationError
  const runErrors = ["SyntaxError", "SyntaxError", "IndentationError", "SyntaxError"];
  for (let i = 0; i < runErrors.length; i++) {
    await db.sessionEvent.create({
      data: {
        sessionId:  session.id,
        type:       "run",
        occurredAt: ms(start, (4 + i * 4) * 60_000),
        metadata: {
          code_content: `def solution(s):\n  s = s.lower()\n  return s = s[::-1]`,
          code_length:  45,
          error_type:   runErrors[i],
          all_passed:   false,
          passed_count: 0,
          total_count:  3,
        },
      },
    });
  }

  // submit — still failing
  await db.sessionEvent.create({
    data: {
      sessionId:  session.id,
      type:       "submit",
      occurredAt: ms(start, 21 * 60_000),
      metadata: {
        outcome:      "failed",
        all_passed:   false,
        code_content: `def solution(s):\n  s = s.lower()\n  return s = s[::-1]`,
        code_length:  45,
        test_results: [
          { passed: false, is_edge_case: false },
          { passed: false, is_edge_case: false },
          { passed: false, is_edge_case: true },
        ],
      },
    },
  });

  await upsertInsights(session.id, userId, problemId);
  return session.id;
}

// ────────────────────────────────────────────────────────────────────────────
// SCENARIO 2 — stuck_loop + print_debugging (positive)
// "FizzBuzz" — many rapid runs, none passing, but uses print to debug
// ────────────────────────────────────────────────────────────────────────────

async function scenario2_stuckLoop(userId: string, problemId: string) {
  console.log("\n📋 Scenario 2: stuck_loop + print_debugging (FizzBuzz)");

  const start = ago(90);
  const session = await db.session.create({
    data: {
      userId,
      problemId,
      outcome:            "failed",
      startedAt:          start,
      endedAt:            ms(start, 18 * 60_000),
      checkinFeel:        1, // completely lost
      checkinPreWork:     "none",
      checkinInterrupted: false,
      checkinConfidence:  1, // not at all
      checkinCompletedAt: ms(start, 19 * 60_000),
    },
  });

  await db.sessionEvent.create({ data: { sessionId: session.id, type: "first_keystroke", occurredAt: ms(start, 20_000), metadata: {} } });

  // Snapshot with print statements — triggers print_debugging positive insight
  await db.sessionEvent.create({
    data: {
      sessionId:  session.id,
      type:       "snapshot",
      occurredAt: ms(start, 2 * 60_000),
      metadata: {
        code_content: `def solution(n):\n    result = []\n    for i in range(1, n+1):\n        print(f"checking {i}")\n        if i % 15 == 0:\n            result.append("FizzBuzz")\n        elif i % 3 == 0:\n            result.append("Fizz")\n        elif i % 5 == 0:\n            result.append("Buzz")\n        else:\n            result.append(i)\n        print(f"result so far: {result}")\n    return result`,
        char_count: 280,
      },
    },
  });

  // 5 run events in 6 minutes — stuck_loop (≥4 in ≤8 min, none passing)
  for (let i = 0; i < 5; i++) {
    await db.sessionEvent.create({
      data: {
        sessionId:  session.id,
        type:       "run",
        occurredAt: ms(start, (3 + i * 70) * 60_000 / 60),
        metadata: {
          code_content: `def solution(n):\n    result = []\n    for i in range(1, n+1):\n        print(f"checking {i}")\n        if i % 15 == 0: result.append("FizzBuzz")\n        elif i % 3 == 0: result.append("Fizz")\n        elif i % 5 == 0: result.append("Buzz")\n        else: result.append(i)\n    return result`,
          code_length:  200,
          error_type:   null,
          all_passed:   false,
          passed_count: 1,
          total_count:  3,
        },
      },
    });
  }

  await db.sessionEvent.create({
    data: {
      sessionId:  session.id,
      type:       "submit",
      occurredAt: ms(start, 17 * 60_000),
      metadata: {
        outcome: "failed", all_passed: false,
        code_length: 200,
        test_results: [{ passed: true, is_edge_case: false }, { passed: false, is_edge_case: false }, { passed: false, is_edge_case: true }],
      },
    },
  });

  await upsertInsights(session.id, userId, problemId);
  return session.id;
}

// ────────────────────────────────────────────────────────────────────────────
// SCENARIO 3 — edge_case_blindness
// "Anagram Check" — passes normal tests but fails edge cases
// ────────────────────────────────────────────────────────────────────────────

async function scenario3_edgeCaseBlindness(userId: string, problemId: string) {
  console.log("\n📋 Scenario 3: edge_case_blindness (Anagram Check)");

  const start = ago(130);
  const session = await db.session.create({
    data: {
      userId,
      problemId,
      outcome:            "failed",
      startedAt:          start,
      endedAt:            ms(start, 14 * 60_000),
      checkinFeel:        3, // okay
      checkinPreWork:     "mind",
      checkinInterrupted: false,
      checkinConfidence:  3, // mostly
      checkinCompletedAt: ms(start, 15 * 60_000),
    },
  });

  await db.sessionEvent.create({ data: { sessionId: session.id, type: "first_keystroke", occurredAt: ms(start, 60_000), metadata: {} } });

  // 2 runs — all_passed + partial
  await db.sessionEvent.create({
    data: {
      sessionId: session.id, type: "run", occurredAt: ms(start, 5 * 60_000),
      metadata: { code_content: `def solution(s, t):\n    return sorted(s) == sorted(t)`, code_length: 42, error_type: null, all_passed: false, passed_count: 2, total_count: 3 },
    },
  });
  await db.sessionEvent.create({
    data: {
      sessionId: session.id, type: "run", occurredAt: ms(start, 9 * 60_000),
      metadata: { code_content: `def solution(s, t):\n    return sorted(s.lower()) == sorted(t.lower())`, code_length: 52, error_type: null, all_passed: false, passed_count: 2, total_count: 3 },
    },
  });

  // Submit — passes non-edge cases, fails edge cases
  await db.sessionEvent.create({
    data: {
      sessionId: session.id, type: "submit", occurredAt: ms(start, 13 * 60_000),
      metadata: {
        outcome: "failed", all_passed: false,
        code_content: `def solution(s, t):\n    return sorted(s.lower()) == sorted(t.lower())`,
        code_length: 52,
        test_results: [
          { passed: true,  is_edge_case: false },  // normal
          { passed: true,  is_edge_case: false },  // normal
          { passed: false, is_edge_case: true  },  // edge — empty string
          { passed: false, is_edge_case: true  },  // edge — numbers in string
        ],
      },
    },
  });

  await upsertInsights(session.id, userId, problemId);
  return session.id;
}

// ────────────────────────────────────────────────────────────────────────────
// SCENARIO 4 — paste_detected
// "Word Frequency" — large paste makes up > 40% of final code
// ────────────────────────────────────────────────────────────────────────────

async function scenario4_pasteDetected(userId: string, problemId: string) {
  console.log("\n📋 Scenario 4: paste_detected (Word Frequency)");

  const start = ago(170);
  const session = await db.session.create({
    data: {
      userId,
      problemId,
      outcome:            "passed",
      startedAt:          start,
      endedAt:            ms(start, 6 * 60_000),
      checkinFeel:        4, // flowed
      checkinPreWork:     "none",
      checkinInterrupted: false,
      checkinConfidence:  4, // solid
      checkinCompletedAt: ms(start, 7 * 60_000),
    },
  });

  await db.sessionEvent.create({ data: { sessionId: session.id, type: "first_keystroke", occurredAt: ms(start, 30_000), metadata: {} } });

  // Large paste event — 160 chars pasted into a 220-char final solution = 73%
  await db.sessionEvent.create({
    data: {
      sessionId: session.id, type: "paste", occurredAt: ms(start, 90_000),
      metadata: {
        chars_pasted: 160,
        code_length_before: 25,
        code_length_after:  185,
      },
    },
  });

  await db.sessionEvent.create({
    data: {
      sessionId: session.id, type: "run", occurredAt: ms(start, 3 * 60_000),
      metadata: { code_content: `def solution(text):\n    words = text.lower().split()\n    freq = {}\n    for w in words:\n        freq[w] = freq.get(w, 0) + 1\n    return freq`, code_length: 120, error_type: null, all_passed: true, passed_count: 3, total_count: 3 },
    },
  });

  await db.sessionEvent.create({
    data: {
      sessionId: session.id, type: "submit", occurredAt: ms(start, 5 * 60_000),
      metadata: {
        outcome: "passed", all_passed: true,
        code_content: `def solution(text):\n    words = text.lower().split()\n    freq = {}\n    for w in words:\n        freq[w] = freq.get(w, 0) + 1\n    return freq`,
        code_length: 120,
        test_results: [
          { passed: true, is_edge_case: false },
          { passed: true, is_edge_case: false },
          { passed: true, is_edge_case: true  },
        ],
      },
    },
  });

  await upsertInsights(session.id, userId, problemId);
  return session.id;
}

// ────────────────────────────────────────────────────────────────────────────
// SCENARIO 5 — stuck_loop (distinct from logic_heavy)
// "Reverse Words" — student keeps running with tiny/no changes, no test runner output
// (total_count: 0 = raw execution, no test harness) so logic_heavy doesn't fire
// ────────────────────────────────────────────────────────────────────────────

async function scenario5_stuckLoop(userId: string, problemId: string) {
  console.log("\n📋 Scenario 5: stuck_loop (Reverse Words)");

  const start = ago(200);
  const session = await db.session.create({
    data: {
      userId,
      problemId,
      outcome:            "failed",
      startedAt:          start,
      endedAt:            ms(start, 12 * 60_000),
      checkinFeel:        1, // completely lost
      checkinPreWork:     "none",
      checkinInterrupted: false,
      checkinConfidence:  1, // not at all
      checkinCompletedAt: ms(start, 13 * 60_000),
    },
  });

  await db.sessionEvent.create({ data: { sessionId: session.id, type: "first_keystroke", occurredAt: ms(start, 25_000), metadata: {} } });

  // 5 runs — same code length each time (< 15 char diff), no test harness (total_count 0)
  // This prevents logic_heavy (needs total_count > 0) but hits stuck_loop
  const stuckCode = `def solution(sentence):\n    words = sentence.split()\n    words.reverse\n    return " ".join(words)`;
  for (let i = 0; i < 5; i++) {
    await db.sessionEvent.create({
      data: {
        sessionId:  session.id,
        type:       "run",
        occurredAt: ms(start, (2 + i) * 60_000),
        metadata: {
          code_content: stuckCode,
          code_length:  stuckCode.length,
          error_type:   null,
          all_passed:   false,
          passed_count: 0,
          total_count:  0,  // no test harness — raw run output only
        },
      },
    });
  }

  await upsertInsights(session.id, userId, problemId);
  return session.id;
}

// ────────────────────────────────────────────────────────────────────────────
// SCENARIO 6 — edge_case_blindness
// "Remove Duplicates" — passes normal cases, fails edge cases on submit
// Only 1 run (not enough for logic_heavy which needs ≥2)
// ────────────────────────────────────────────────────────────────────────────

async function scenario6_edgeCases(userId: string, problemId: string) {
  console.log("\n📋 Scenario 6: edge_case_blindness (Remove Duplicates)");

  const start = ago(220);
  const session = await db.session.create({
    data: {
      userId,
      problemId,
      outcome:            "failed",
      startedAt:          start,
      endedAt:            ms(start, 10 * 60_000),
      checkinFeel:        3, // okay — thought they had it
      checkinPreWork:     "mind",
      checkinInterrupted: false,
      checkinConfidence:  3, // mostly confident
      checkinCompletedAt: ms(start, 11 * 60_000),
    },
  });

  await db.sessionEvent.create({ data: { sessionId: session.id, type: "first_keystroke", occurredAt: ms(start, 55_000), metadata: {} } });

  // Only 1 run — passes visible tests → feels ready to submit
  await db.sessionEvent.create({
    data: {
      sessionId: session.id, type: "run", occurredAt: ms(start, 5 * 60_000),
      metadata: {
        code_content: `def solution(lst):\n    seen = set()\n    result = []\n    for x in lst:\n        if x not in seen:\n            seen.add(x)\n            result.append(x)\n    return result`,
        code_length:  120,
        error_type:   null,
        all_passed:   true,   // passes the basic tests shown in the editor
        passed_count: 2,
        total_count:  2,
      },
    },
  });

  // Submit — hidden edge cases fail (empty list, single element, all dupes)
  await db.sessionEvent.create({
    data: {
      sessionId: session.id, type: "submit", occurredAt: ms(start, 9 * 60_000),
      metadata: {
        outcome: "failed", all_passed: false,
        code_content: `def solution(lst):\n    seen = set()\n    result = []\n    for x in lst:\n        if x not in seen:\n            seen.add(x)\n            result.append(x)\n    return result`,
        code_length: 120,
        test_results: [
          { passed: true,  is_edge_case: false },  // [1,2,3,2,1]
          { passed: true,  is_edge_case: false },  // [4,4,4,5]
          { passed: false, is_edge_case: true  },  // [] — empty list
          { passed: false, is_edge_case: true  },  // [7] — single element
        ],
      },
    },
  });

  await upsertInsights(session.id, userId, problemId);
  return session.id;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Cogniflow Demo Session Seeder");
  console.log("================================");

  const { userId, problems } = await getIds();
  console.log(`\nUser: test1@cogniflow.dev (${userId})`);

  const ids: Record<string, string> = {};

  ids.scenario1 = await scenario1_syntaxHeavy(userId, problems["Palindrome Check"]);
  ids.scenario2 = await scenario2_stuckLoop(userId, problems["FizzBuzz"]);
  ids.scenario3 = await scenario3_edgeCaseBlindness(userId, problems["Anagram Check"]);
  ids.scenario4 = await scenario4_pasteDetected(userId, problems["Word Frequency"]);
  ids.scenario5 = await scenario5_stuckLoop(userId, problems["Reverse Words"]);
  ids.scenario6 = await scenario6_edgeCases(userId, problems["Remove Duplicates"]);

  console.log("\n\n✅ Done. Reflection URLs:");
  console.log("================================");
  Object.entries(ids).forEach(([name, id]) => {
    console.log(`  ${name}: http://localhost:3000/session/${id}/reflection`);
  });

  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
