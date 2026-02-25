# Cogniflow

**Cognitive observability for programming education.**

Cogniflow helps learners understand *how* they code, not just whether their code passes. It observes your problem-solving process — keystrokes, runs, errors, time stuck — and turns that into honest, specific feedback after every session.

Built for students who want to grow deliberately, not just grind problems.

---

## What it does

- **Practice coding problems** — 28 curated Python problems across 10 concept areas (Arrays, Strings, Loops, Recursion, and more)
- **Track your process** — every run, error, paste, and moment of being stuck is recorded silently in the background
- **Post-session check-in** — 4 quick questions after each submission to calibrate the reflection
- **Personalised insight** — a rule-based engine surfaces one honest observation per session (e.g. "your errors were all syntax, not logic — that's a fluency gap, not a thinking gap")
- **Gap Tracker** — aggregates sessions across concepts to show where you're strong, developing, or stuck
- **Dashboard** — recent sessions, top gap, concept overview, all in one place

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript) |
| Styling | Tailwind CSS v4 |
| Editor | Monaco Editor (`@monaco-editor/react`) |
| Database | PostgreSQL on Supabase |
| ORM | Prisma 7 |
| Auth | Auth.js v5 (Credentials provider, bcrypt) |
| Code execution | Judge0 CE public API |
| Deployment | Vercel |

---

## Project structure

```
cogniflow/
├── src/
│   ├── app/
│   │   ├── api/              # Backend — auth, problems, sessions, run, settings
│   │   ├── (auth)/           # Login + signup pages
│   │   └── (app)/            # Dashboard, Problems, Gaps, Settings, Session flow
│   ├── components/           # UI components (editor, problems, gaps, settings)
│   ├── lib/                  # Prisma client, insight engine, gap engine
│   └── types/                # Shared TypeScript types
├── prisma/
│   ├── schema.prisma         # Database schema
│   └── seed.ts               # 10 concept tags + 28 problems with test cases
└── test_screenshots/         # End-to-end test evidence (13 screens)
```

---

## Running locally

**Prerequisites:** Node.js 18+, a Supabase project

**1. Clone and install**
```bash
git clone https://github.com/PrisDen/cogniflowv2.git
cd cogniflowv2/cogniflow
npm install
```

**2. Set up environment variables**

Copy `.env.example` to `.env.local` and fill in your values:
```bash
cp .env.example .env.local
```

Required variables:
```
DATABASE_URL        # Supabase transaction pooler URL (?pgbouncer=true)
SESSION_POOLER_URL  # Supabase session pooler URL (port 5432)
AUTH_SECRET         # Random secret: openssl rand -base64 32
AUTH_URL            # http://localhost:3000
JUDGE0_API_URL      # https://ce.judge0.com
```

**3. Push schema and seed data**
```bash
npx prisma migrate deploy
npx prisma db seed
```

**4. Run the dev server**
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deploying to Vercel

1. Import the repo on [vercel.com](https://vercel.com)
2. Set **Root Directory** to `cogniflow`
3. Add environment variables (same as above, with `AUTH_URL` set to your production domain)
4. Deploy — Vercel handles the rest

---

## The insight engine

The core of Cogniflow is a rule-based engine (`src/lib/insights.ts`) that analyses session events to generate observations:

| Observation | What it detects |
|---|---|
| `logic_heavy` | Errors are wrong-answer, not syntax — logic gap not fluency gap |
| `syntax_heavy` | ≥ 60% of errors are syntax errors — fluency gap |
| `no_planning` | Jumped straight to code with no comments or structure |
| `stuck_loop` | ≥ 4 runs in 8 minutes, none passing |
| `paste_detected` | Significant paste — flags if it looks like copied solution |
| `edge_case_blindness` | Passed normal cases but failed edge cases |
| `repeated_error` | Same error type 3+ times in a row |
| `reading_time` | Long idle time before first keystroke — pre-coding thinking |
| `planning_detected` | Has comments before logic — positive signal |
| `print_debugging` | Used print statements to investigate — positive signal |

Check-in answers suppress irrelevant observations (e.g. "syntax_heavy" is suppressed if the user said they were interrupted).

---

## Screenshots

End-to-end test screenshots are in `test_screenshots/` — 13 screens covering the full user flow from signup through reflection to the gap tracker.

---

## Docs

Product specifications and architecture decisions are in `/docs`:
- `product-overview.md` — vision, problem, principles
- `data-model.md` — full database schema
- `insight-layer-spec.md` — all 15 observations with thresholds and phrasing
- `tech-stack.md` — architecture, API routes, environment variables
- `problem-bank-spec.md` — all 28 problems with test cases
- `user-flows.md` — screen specs and navigation flows

---

*Free. No grades. No rankings.*
