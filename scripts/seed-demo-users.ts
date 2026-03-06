/**
 * Cogniflow — Panel Demo Seeder
 *
 * Wipes all user/session data and creates 4 demo personas with realistic
 * session histories, each triggering distinct insight types.
 *
 * Users created:
 *   alice@cogniflow.demo  / Demo1234!  — struggling beginner
 *   ben@cogniflow.demo    / Demo1234!  — improving intermediate
 *   priya@cogniflow.demo  / Demo1234!  — strong performer
 *   dev@cogniflow.demo    / Demo1234!  — paste-and-pray
 *
 * Run with:
 *   npx tsx scripts/seed-demo-users.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { generateInsights } from "../src/lib/insights.js";
import type { InsightEvent } from "../src/lib/insights.js";

const adapter = new PrismaPg({
    connectionString: process.env.SESSION_POOLER_URL ?? process.env.DATABASE_URL!,
});
const db = new PrismaClient({ adapter });

// ── Helpers ────────────────────────────────────────────────────────────────

/** Return a Date that is `days` days ago plus `minutes` minutes into that day */
function daysAgo(days: number, minutesIntoDay = 0): Date {
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(9, 0, 0, 0); // anchor to 9 AM
    return new Date(d.getTime() + minutesIntoDay * 60_000);
}

function ms(base: Date, offsetMs: number): Date {
    return new Date(base.getTime() + offsetMs);
}

function min(base: Date, minutes: number): Date {
    return ms(base, minutes * 60_000);
}

/** Run generateInsights and persist results for a session */
async function upsertInsights(sessionId: string, problemId: string) {
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
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            checkinFeel: session.checkinFeel,
            checkinPreWork: session.checkinPreWork,
            checkinInterrupted: session.checkinInterrupted,
            checkinConfidence: session.checkinConfidence,
        },
        problem: { wordCount },
        events: session.events as unknown as InsightEvent[],
    });

    if (result.critical) {
        await db.sessionInsight.create({
            data: { sessionId, priority: 1, observation: result.critical.observation, message: result.critical.message },
        });
    }
    if (result.positive) {
        await db.sessionInsight.create({
            data: { sessionId, priority: 2, observation: result.positive.observation, message: result.positive.message },
        });
    }

    const tag = result.critical
        ? `⚡ ${result.critical.observation}${result.positive ? ` + ✅ ${result.positive.observation}` : ""}`
        : result.positive
            ? `✅ ${result.positive.observation}`
            : "⚠ no insight";
    console.log(`     insight: ${tag}`);
}

// ── Step 1: Wipe ─────────────────────────────────────────────────────────────

async function wipeUserData() {
    console.log("\n🗑  Wiping all user/session data...");
    await db.sessionInsight.deleteMany({});
    await db.sessionEvent.deleteMany({});
    await db.session.deleteMany({});
    await db.userConceptGap.deleteMany({});
    await db.user.deleteMany({});
    console.log("   ✓ Clean slate");
}

// ── Step 2: Create users ──────────────────────────────────────────────────────

async function createUsers() {
    const hash = await bcrypt.hash("Demo1234!", 12);
    const users = await Promise.all([
        db.user.create({ data: { email: "alice@cogniflow.demo", passwordHash: hash, displayName: "Alice" } }),
        db.user.create({ data: { email: "ben@cogniflow.demo", passwordHash: hash, displayName: "Ben" } }),
        db.user.create({ data: { email: "priya@cogniflow.demo", passwordHash: hash, displayName: "Priya" } }),
        db.user.create({ data: { email: "dev@cogniflow.demo", passwordHash: hash, displayName: "Dev" } }),
    ]);
    console.log("\n👤 Created 4 demo users (password: Demo1234!)");
    return { alice: users[0], ben: users[1], priya: users[2], dev: users[3] };
}

// ── Step 3: Load problems ─────────────────────────────────────────────────────

async function getProblems() {
    const list = await db.problem.findMany({
        where: {
            title: {
                in: [
                    "Palindrome Check",
                    "FizzBuzz",
                    "Reverse a List",
                    "Anagram Check",
                    "Two Sum (Optimal)",
                    "Word Frequency",
                    "Sort by Second Element",
                    "Fibonacci",
                    "Remove Duplicates",
                    "Factorial",
                ],
            },
        },
        select: { id: true, title: true },
    });
    const byTitle = Object.fromEntries(list.map((p) => [p.title, p.id]));

    const missing = [
        "Palindrome Check", "FizzBuzz", "Reverse a List", "Anagram Check",
        "Two Sum (Optimal)", "Word Frequency", "Sort by Second Element",
        "Fibonacci", "Remove Duplicates", "Factorial",
    ].filter((t) => !byTitle[t]);

    if (missing.length) {
        throw new Error(`Problems not found in DB: ${missing.join(", ")}. Run prisma/seed.ts first.`);
    }
    return byTitle as Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// ALICE — Struggling Beginner
// syntax_heavy, stuck_loop, repeated_error
// ─────────────────────────────────────────────────────────────────────────────

async function seedAlice(userId: string, problems: Record<string, string>) {
    console.log("\n── Alice (struggling beginner) ──");

    // Session A1 — syntax_heavy: Palindrome Check (6 days ago)
    {
        const start = daysAgo(6, 30);
        const s = await db.session.create({
            data: {
                userId, problemId: problems["Palindrome Check"],
                outcome: "failed", startedAt: start, endedAt: min(start, 24),
                checkinFeel: 2, checkinPreWork: "none", checkinInterrupted: false,
                checkinConfidence: 2, checkinCompletedAt: min(start, 25),
            },
        });
        await db.sessionEvent.create({ data: { sessionId: s.id, type: "first_keystroke", occurredAt: min(start, 0.75), metadata: {} } });
        // 5 runs — 4 SyntaxErrors, 1 IndentationError
        const errTypes = ["SyntaxError", "SyntaxError", "IndentationError", "SyntaxError", "SyntaxError"];
        for (let i = 0; i < errTypes.length; i++) {
            await db.sessionEvent.create({
                data: {
                    sessionId: s.id, type: "run", occurredAt: min(start, 4 + i * 4),
                    metadata: {
                        code_content: `def solution(s):\n  s = s.lower()\n  return s = s[::-1]`,
                        code_length: 46, error_type: errTypes[i],
                        all_passed: false, passed_count: 0, total_count: 3,
                    },
                },
            });
        }
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "submit", occurredAt: min(start, 23),
                metadata: {
                    outcome: "failed", all_passed: false,
                    code_content: `def solution(s):\n  return s = s.lower()[::-1]`,
                    code_length: 42,
                    test_results: [
                        { passed: false, is_edge_case: false },
                        { passed: false, is_edge_case: false },
                        { passed: false, is_edge_case: true },
                    ],
                },
            },
        });
        await upsertInsights(s.id, problems["Palindrome Check"]);
        console.log(`   A1 Palindrome Check  → session ${s.id.slice(0, 8)}`);
    }

    // Session A2 — stuck_loop: FizzBuzz (4 days ago)
    {
        const start = daysAgo(4, 60);
        const s = await db.session.create({
            data: {
                userId, problemId: problems["FizzBuzz"],
                outcome: "failed", startedAt: start, endedAt: min(start, 16),
                checkinFeel: 1, checkinPreWork: "none", checkinInterrupted: false,
                checkinConfidence: 1, checkinCompletedAt: min(start, 17),
            },
        });
        await db.sessionEvent.create({ data: { sessionId: s.id, type: "first_keystroke", occurredAt: min(start, 0.5), metadata: {} } });
        const stuckCode = `def solution(n):\n    result = []\n    for i in range(n):\n        if i % 3 == 0: result.append("Fizz")\n        elif i % 5 == 0: result.append("Buzz")\n        else: result.append(str(i))\n    return result`;
        for (let i = 0; i < 5; i++) {
            await db.sessionEvent.create({
                data: {
                    sessionId: s.id, type: "run", occurredAt: min(start, 2 + i * 2.5),
                    metadata: {
                        code_content: stuckCode + (i > 0 ? " " : ""), // tiny diff <15 chars
                        code_length: stuckCode.length + (i > 0 ? 1 : 0),
                        error_type: null, all_passed: false, passed_count: 0, total_count: 3,
                    },
                },
            });
        }
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "submit", occurredAt: min(start, 15),
                metadata: {
                    outcome: "failed", all_passed: false, code_length: stuckCode.length,
                    test_results: [
                        { passed: false, is_edge_case: false },
                        { passed: false, is_edge_case: false },
                        { passed: false, is_edge_case: true },
                    ],
                },
            },
        });
        await upsertInsights(s.id, problems["FizzBuzz"]);
        console.log(`   A2 FizzBuzz         → session ${s.id.slice(0, 8)}`);
    }

    // Session A3 — repeated_error (IndexError x3): Reverse a List (2 days ago)
    {
        const start = daysAgo(2, 45);
        const s = await db.session.create({
            data: {
                userId, problemId: problems["Reverse a List"],
                outcome: "failed", startedAt: start, endedAt: min(start, 20),
                checkinFeel: 2, checkinPreWork: "none", checkinInterrupted: false,
                checkinConfidence: 2, checkinCompletedAt: min(start, 21),
            },
        });
        await db.sessionEvent.create({ data: { sessionId: s.id, type: "first_keystroke", occurredAt: min(start, 1), metadata: {} } });
        const badCode = `def solution(nums):\n    result = []\n    for i in range(len(nums)):\n        result.append(nums[len(nums) - i])\n    return result`;
        for (let i = 0; i < 4; i++) {
            await db.sessionEvent.create({
                data: {
                    sessionId: s.id, type: "run", occurredAt: min(start, 3 + i * 4),
                    metadata: {
                        code_content: badCode,
                        code_length: badCode.length,
                        error_type: i < 3 ? "IndexError" : "IndexError",
                        all_passed: false, passed_count: 0, total_count: 4,
                    },
                },
            });
        }
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "submit", occurredAt: min(start, 19),
                metadata: {
                    outcome: "failed", all_passed: false, code_length: badCode.length,
                    test_results: [
                        { passed: false, is_edge_case: false },
                        { passed: false, is_edge_case: false },
                        { passed: false, is_edge_case: true },
                        { passed: false, is_edge_case: true },
                    ],
                },
            },
        });
        await upsertInsights(s.id, problems["Reverse a List"]);
        console.log(`   A3 Reverse a List   → session ${s.id.slice(0, 8)}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// BEN — Improving Intermediate
// edge_case_blindness, logic_heavy, no_planning, planning_detected (positive)
// ─────────────────────────────────────────────────────────────────────────────

async function seedBen(userId: string, problems: Record<string, string>) {
    console.log("\n── Ben (improving intermediate) ──");

    // Session B1 — edge_case_blindness: Anagram Check (7 days ago)
    {
        const start = daysAgo(7, 20);
        const s = await db.session.create({
            data: {
                userId, problemId: problems["Anagram Check"],
                outcome: "failed", startedAt: start, endedAt: min(start, 15),
                checkinFeel: 3, checkinPreWork: "mind", checkinInterrupted: false,
                checkinConfidence: 3, checkinCompletedAt: min(start, 16),
            },
        });
        await db.sessionEvent.create({ data: { sessionId: s.id, type: "first_keystroke", occurredAt: min(start, 1), metadata: {} } });
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "run", occurredAt: min(start, 5),
                metadata: { code_content: `def solution(s1, s2):\n    return sorted(s1) == sorted(s2)`, code_length: 44, error_type: null, all_passed: false, passed_count: 2, total_count: 4 },
            },
        });
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "run", occurredAt: min(start, 9),
                metadata: { code_content: `def solution(s1, s2):\n    return sorted(s1.lower()) == sorted(s2.lower())`, code_length: 54, error_type: null, all_passed: false, passed_count: 2, total_count: 4 },
            },
        });
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "submit", occurredAt: min(start, 14),
                metadata: {
                    outcome: "failed", all_passed: false,
                    code_content: `def solution(s1, s2):\n    return sorted(s1.lower()) == sorted(s2.lower())`,
                    code_length: 54,
                    test_results: [
                        { passed: true, is_edge_case: false },
                        { passed: true, is_edge_case: false },
                        { passed: false, is_edge_case: true },
                        { passed: false, is_edge_case: true },
                    ],
                },
            },
        });
        await upsertInsights(s.id, problems["Anagram Check"]);
        console.log(`   B1 Anagram Check    → session ${s.id.slice(0, 8)}`);
    }

    // Session B2 — logic_heavy: Two Sum (5 days ago)
    {
        const start = daysAgo(5, 90);
        const s = await db.session.create({
            data: {
                userId, problemId: problems["Two Sum (Optimal)"],
                outcome: "failed", startedAt: start, endedAt: min(start, 22),
                checkinFeel: 2, checkinPreWork: "none", checkinInterrupted: false,
                checkinConfidence: 2, checkinCompletedAt: min(start, 23),
            },
        });
        await db.sessionEvent.create({ data: { sessionId: s.id, type: "first_keystroke", occurredAt: min(start, 1.5), metadata: {} } });
        const wrongCode = `def solution(nums, target):\n    for i in range(len(nums)):\n        for j in range(len(nums)):\n            if nums[i] + nums[j] == target:\n                return [i, j]`;
        const betterCode = `def solution(nums, target):\n    for i in range(len(nums)):\n        for j in range(i, len(nums)):\n            if nums[i] + nums[j] == target:\n                return [i, j]`;
        for (let i = 0; i < 3; i++) {
            await db.sessionEvent.create({
                data: {
                    sessionId: s.id, type: "run", occurredAt: min(start, 5 + i * 5),
                    metadata: {
                        code_content: i < 2 ? wrongCode : betterCode,
                        code_length: i < 2 ? wrongCode.length : betterCode.length,
                        error_type: null, all_passed: false, passed_count: 1, total_count: 3,
                    },
                },
            });
        }
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "submit", occurredAt: min(start, 21),
                metadata: {
                    outcome: "failed", all_passed: false, code_length: betterCode.length,
                    test_results: [
                        { passed: true, is_edge_case: false },
                        { passed: false, is_edge_case: false },
                        { passed: false, is_edge_case: true },
                    ],
                },
            },
        });
        await upsertInsights(s.id, problems["Two Sum (Optimal)"]);
        console.log(`   B2 Two Sum          → session ${s.id.slice(0, 8)}`);
    }

    // Session B3 — no_planning: Sort by Second Element (3 days ago)
    {
        const start = daysAgo(3, 30);
        const s = await db.session.create({
            data: {
                userId, problemId: problems["Sort by Second Element"],
                outcome: "failed", startedAt: start, endedAt: min(start, 18),
                checkinFeel: 2, checkinPreWork: "none", checkinInterrupted: false,
                checkinConfidence: 2, checkinCompletedAt: min(start, 19),
            },
        });
        await db.sessionEvent.create({ data: { sessionId: s.id, type: "first_keystroke", occurredAt: min(start, 0.4), metadata: {} } });
        // First snapshot — no planning comments, just code
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "snapshot", occurredAt: min(start, 2),
                metadata: {
                    code_content: `def solution(pairs):\n    return sorted(pairs)\n\n\n\n`,
                    char_count: 45,
                },
            },
        });
        for (let i = 0; i < 4; i++) {
            await db.sessionEvent.create({
                data: {
                    sessionId: s.id, type: "run", occurredAt: min(start, 4 + i * 3),
                    metadata: {
                        code_content: `def solution(pairs):\n    return sorted(pairs, key=lambda x: x[1])`,
                        code_length: 60, error_type: null, all_passed: false, passed_count: 1, total_count: 3,
                    },
                },
            });
        }
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "submit", occurredAt: min(start, 17),
                metadata: {
                    outcome: "failed", all_passed: false, code_length: 60,
                    test_results: [
                        { passed: true, is_edge_case: false },
                        { passed: false, is_edge_case: true },
                        { passed: false, is_edge_case: true },
                    ],
                },
            },
        });
        await upsertInsights(s.id, problems["Sort by Second Element"]);
        console.log(`   B3 Sort by 2nd Elem → session ${s.id.slice(0, 8)}`);
    }

    // Session B4 — planning_detected (positive): Factorial (1 day ago)
    {
        const start = daysAgo(1, 60);
        const s = await db.session.create({
            data: {
                userId, problemId: problems["Factorial"],
                outcome: "passed", startedAt: start, endedAt: min(start, 10),
                checkinFeel: 4, checkinPreWork: "mind", checkinInterrupted: false,
                checkinConfidence: 4, checkinCompletedAt: min(start, 11),
            },
        });
        await db.sessionEvent.create({ data: { sessionId: s.id, type: "first_keystroke", occurredAt: min(start, 1.5), metadata: {} } });
        // First snapshot — 3+ comment lines (planning!)
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "snapshot", occurredAt: min(start, 2),
                metadata: {
                    code_content: `def solution(n):\n    # start with result = 1\n    # loop from 1 to n inclusive\n    # multiply result by each i\n    # return result\n    pass`,
                    char_count: 140,
                },
            },
        });
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "run", occurredAt: min(start, 5),
                metadata: {
                    code_content: `def solution(n):\n    result = 1\n    for i in range(1, n + 1):\n        result *= i\n    return result`,
                    code_length: 78, error_type: null, all_passed: true, passed_count: 4, total_count: 4,
                },
            },
        });
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "submit", occurredAt: min(start, 8),
                metadata: {
                    outcome: "passed", all_passed: true, code_length: 78,
                    test_results: [
                        { passed: true, is_edge_case: false },
                        { passed: true, is_edge_case: false },
                        { passed: true, is_edge_case: true },
                        { passed: true, is_edge_case: true },
                    ],
                },
            },
        });
        await upsertInsights(s.id, problems["Factorial"]);
        console.log(`   B4 Factorial        → session ${s.id.slice(0, 8)}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIYA — Strong Performer
// planning_detected, print_debugging (positive), edge_case_blindness
// ─────────────────────────────────────────────────────────────────────────────

async function seedPriya(userId: string, problems: Record<string, string>) {
    console.log("\n── Priya (strong performer) ──");

    // Session P1 — planning_detected + passes: FizzBuzz (6 days ago)
    {
        const start = daysAgo(6, 90);
        const s = await db.session.create({
            data: {
                userId, problemId: problems["FizzBuzz"],
                outcome: "passed", startedAt: start, endedAt: min(start, 9),
                checkinFeel: 4, checkinPreWork: "mind", checkinInterrupted: false,
                checkinConfidence: 4, checkinCompletedAt: min(start, 10),
            },
        });
        await db.sessionEvent.create({ data: { sessionId: s.id, type: "first_keystroke", occurredAt: min(start, 1.5), metadata: {} } });
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "snapshot", occurredAt: min(start, 2),
                metadata: {
                    code_content: `def solution(n):\n    # build result list\n    # for each number 1 to n\n    # check divisibility by 15, 3, 5\n    # append string or number\n    pass`,
                    char_count: 160,
                },
            },
        });
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "run", occurredAt: min(start, 5),
                metadata: {
                    code_content: `def solution(n):\n    result = []\n    for i in range(1, n + 1):\n        if i % 15 == 0: result.append("FizzBuzz")\n        elif i % 3 == 0: result.append("Fizz")\n        elif i % 5 == 0: result.append("Buzz")\n        else: result.append(str(i))\n    return result`,
                    code_length: 210, error_type: null, all_passed: true, passed_count: 3, total_count: 3,
                },
            },
        });
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "submit", occurredAt: min(start, 8),
                metadata: {
                    outcome: "passed", all_passed: true, code_length: 210,
                    test_results: [
                        { passed: true, is_edge_case: false },
                        { passed: true, is_edge_case: false },
                        { passed: true, is_edge_case: true },
                    ],
                },
            },
        });
        await upsertInsights(s.id, problems["FizzBuzz"]);
        console.log(`   P1 FizzBuzz         → session ${s.id.slice(0, 8)}`);
    }

    // Session P2 — print_debugging (positive): Fibonacci (4 days ago)
    {
        const start = daysAgo(4, 30);
        const s = await db.session.create({
            data: {
                userId, problemId: problems["Fibonacci"],
                outcome: "passed", startedAt: start, endedAt: min(start, 12),
                checkinFeel: 3, checkinPreWork: "none", checkinInterrupted: false,
                checkinConfidence: 3, checkinCompletedAt: min(start, 13),
            },
        });
        await db.sessionEvent.create({ data: { sessionId: s.id, type: "first_keystroke", occurredAt: min(start, 1), metadata: {} } });
        // First run fails logic
        const firstAttempt = `def solution(n):\n    if n == 0: return 0\n    if n == 1: return 1\n    return solution(n-1) + solution(n-2)`;
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "run", occurredAt: min(start, 4),
                metadata: { code_content: firstAttempt, code_length: firstAttempt.length, error_type: "RecursionError", all_passed: false, passed_count: 0, total_count: 4 },
            },
        });
        // Second run — adds a print statement to debug (triggers print_debugging positive)
        const debugAttempt = `def solution(n):\n    print(f"called with n={n}")\n    if n == 0: return 0\n    if n == 1: return 1\n    return solution(n-1) + solution(n-2)`;
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "run", occurredAt: min(start, 7),
                metadata: { code_content: debugAttempt, code_length: debugAttempt.length, error_type: null, all_passed: true, passed_count: 4, total_count: 4 },
            },
        });
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "submit", occurredAt: min(start, 11),
                metadata: {
                    outcome: "passed", all_passed: true, code_length: debugAttempt.length,
                    test_results: [
                        { passed: true, is_edge_case: false },
                        { passed: true, is_edge_case: false },
                        { passed: true, is_edge_case: true },
                        { passed: true, is_edge_case: true },
                    ],
                },
            },
        });
        await upsertInsights(s.id, problems["Fibonacci"]);
        console.log(`   P2 Fibonacci        → session ${s.id.slice(0, 8)}`);
    }

    // Session P3 — edge_case_blindness: Remove Duplicates (2 days ago — nobody's perfect)
    {
        const start = daysAgo(2, 60);
        const s = await db.session.create({
            data: {
                userId, problemId: problems["Remove Duplicates"],
                outcome: "failed", startedAt: start, endedAt: min(start, 11),
                checkinFeel: 3, checkinPreWork: "mind", checkinInterrupted: false,
                checkinConfidence: 3, checkinCompletedAt: min(start, 12),
            },
        });
        await db.sessionEvent.create({ data: { sessionId: s.id, type: "first_keystroke", occurredAt: min(start, 1), metadata: {} } });
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "run", occurredAt: min(start, 5),
                metadata: {
                    code_content: `def solution(lst):\n    seen = set()\n    result = []\n    for x in lst:\n        if x not in seen:\n            seen.add(x)\n            result.append(x)\n    return result`,
                    code_length: 125, error_type: null, all_passed: true, passed_count: 3, total_count: 3,
                },
            },
        });
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "submit", occurredAt: min(start, 10),
                metadata: {
                    outcome: "failed", all_passed: false, code_length: 125,
                    test_results: [
                        { passed: true, is_edge_case: false },
                        { passed: true, is_edge_case: false },
                        { passed: true, is_edge_case: false },
                        { passed: false, is_edge_case: true },
                        { passed: false, is_edge_case: true },
                    ],
                },
            },
        });
        await upsertInsights(s.id, problems["Remove Duplicates"]);
        console.log(`   P3 Remove Dupes     → session ${s.id.slice(0, 8)}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// DEV — Paste-and-Pray
// paste_detected, reading_time, infrequent_running
// ─────────────────────────────────────────────────────────────────────────────

async function seedDev(userId: string, problems: Record<string, string>) {
    console.log("\n── Dev (paste-and-pray) ──");

    // Session D1 — paste_detected: Word Frequency (5 days ago)
    {
        const start = daysAgo(5, 15);
        const s = await db.session.create({
            data: {
                userId, problemId: problems["Word Frequency"],
                outcome: "passed", startedAt: start, endedAt: min(start, 5),
                checkinFeel: 4, checkinPreWork: "none", checkinInterrupted: false,
                checkinConfidence: 4, checkinCompletedAt: min(start, 6),
            },
        });
        await db.sessionEvent.create({ data: { sessionId: s.id, type: "first_keystroke", occurredAt: min(start, 0.4), metadata: {} } });
        // Large paste: 180 chars pasted into a ~220 char final solution (>40%)
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "paste", occurredAt: min(start, 1),
                metadata: { chars_pasted: 180, code_length_before: 20, code_length_after: 200 },
            },
        });
        const solution = `def solution(text):\n    if not text.strip(): return {}\n    words = text.lower().split()\n    freq = {}\n    for w in words:\n        freq[w] = freq.get(w, 0) + 1\n    return freq`;
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "run", occurredAt: min(start, 2.5),
                metadata: { code_content: solution, code_length: solution.length, error_type: null, all_passed: true, passed_count: 4, total_count: 4 },
            },
        });
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "submit", occurredAt: min(start, 4),
                metadata: {
                    outcome: "passed", all_passed: true, code_content: solution, code_length: solution.length,
                    test_results: [
                        { passed: true, is_edge_case: false },
                        { passed: true, is_edge_case: false },
                        { passed: true, is_edge_case: false },
                        { passed: true, is_edge_case: true },
                    ],
                },
            },
        });
        await upsertInsights(s.id, problems["Word Frequency"]);
        console.log(`   D1 Word Frequency   → session ${s.id.slice(0, 8)}`);
    }

    // Session D2 — reading_time: Palindrome Check (3 days ago)
    {
        const start = daysAgo(3, 20);
        const s = await db.session.create({
            data: {
                userId, problemId: problems["Palindrome Check"],
                outcome: "failed", startedAt: start, endedAt: min(start, 8),
                checkinFeel: 3, checkinPreWork: "none", checkinInterrupted: false,
                checkinConfidence: 3, checkinCompletedAt: min(start, 9),
            },
        });
        // Jumped in after only 10 seconds (well under 30s threshold for short problem)
        await db.sessionEvent.create({ data: { sessionId: s.id, type: "first_keystroke", occurredAt: ms(start, 10_000), metadata: {} } });
        const code = `def solution(s):\n    return s == s[::-1]`;
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "run", occurredAt: min(start, 3),
                metadata: { code_content: code, code_length: code.length, error_type: null, all_passed: false, passed_count: 2, total_count: 5 },
            },
        });
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "submit", occurredAt: min(start, 7),
                metadata: {
                    outcome: "failed", all_passed: false, code_content: code, code_length: code.length,
                    test_results: [
                        { passed: true, is_edge_case: false },
                        { passed: false, is_edge_case: false },
                        { passed: true, is_edge_case: true },
                        { passed: false, is_edge_case: true },
                        { passed: false, is_edge_case: true },
                    ],
                },
            },
        });
        await upsertInsights(s.id, problems["Palindrome Check"]);
        console.log(`   D2 Palindrome Check → session ${s.id.slice(0, 8)}`);
    }

    // Session D3 — infrequent_running: Anagram Check (1 day ago)
    {
        const start = daysAgo(1, 30);
        const s = await db.session.create({
            data: {
                userId, problemId: problems["Anagram Check"],
                outcome: "failed", startedAt: start, endedAt: min(start, 28),
                checkinFeel: 2, checkinPreWork: "none", checkinInterrupted: false,
                checkinConfidence: 2, checkinCompletedAt: min(start, 29),
            },
        });
        await db.sessionEvent.create({ data: { sessionId: s.id, type: "first_keystroke", occurredAt: min(start, 1), metadata: {} } });
        // Only 1 run after 25 mins of writing — triggers infrequent_running
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "run", occurredAt: min(start, 25),
                metadata: {
                    code_content: `def solution(s1, s2):\n    s1 = s1.lower().replace(" ", "")\n    s2 = s2.lower().replace(" ", "")\n    count = {}\n    for c in s1: count[c] = count.get(c, 0) + 1\n    for c in s2: count[c] = count.get(c, 0) - 1\n    return all(v == 0 for v in count.values())`,
                    code_length: 210, error_type: null, all_passed: false, passed_count: 2, total_count: 5,
                },
            },
        });
        await db.sessionEvent.create({
            data: {
                sessionId: s.id, type: "submit", occurredAt: min(start, 27),
                metadata: {
                    outcome: "failed", all_passed: false, code_length: 210,
                    test_results: [
                        { passed: true, is_edge_case: false },
                        { passed: true, is_edge_case: false },
                        { passed: false, is_edge_case: false },
                        { passed: false, is_edge_case: true },
                        { passed: false, is_edge_case: true },
                    ],
                },
            },
        });
        await upsertInsights(s.id, problems["Anagram Check"]);
        console.log(`   D3 Anagram Check    → session ${s.id.slice(0, 8)}`);
    }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
    console.log("🚀 Cogniflow Panel Demo Seeder");
    console.log("================================");

    await wipeUserData();

    const problems = await getProblems();
    console.log(`\n📚 Loaded ${Object.keys(problems).length} problems from DB`);

    const users = await createUsers();

    await seedAlice(users.alice.id, problems);
    await seedBen(users.ben.id, problems);
    await seedPriya(users.priya.id, problems);
    await seedDev(users.dev.id, problems);

    console.log("\n\n✅ Demo data ready!");
    console.log("================================");
    console.log("Login credentials (all use password: Demo1234!)\n");
    console.log("  alice@cogniflow.demo  — struggling beginner  (syntax_heavy, stuck_loop, repeated_error)");
    console.log("  ben@cogniflow.demo    — improving            (edge_case_blindness, logic_heavy, planning_detected ✅)");
    console.log("  priya@cogniflow.demo  — strong performer      (planning_detected ✅, print_debugging ✅, edge_case_blindness)");
    console.log("  dev@cogniflow.demo    — paste-and-pray        (paste_detected, reading_time, infrequent_running)");
    console.log("\nPassword: Demo1234!");

    await db.$disconnect();
}

main().catch((e) => {
    console.error("❌ Seeder failed:", e);
    process.exit(1);
});
