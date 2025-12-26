# Seed notes (read first)

This repository is being refactored into a 3‑project workspace. Each project will spawn **three chat bots** (agents) provided by the `agent` module. Agents have access to paid APIs (OpenAI/Cursor/ChatGPT), can chat with other agents, and can spend team/company funds. Communication and runtime are limited by the **HeartBeat** service.

## Goal

Deliver a minimal “task execution system” that lets a small AI team:
- coordinate roles (leader/ops/coder),
- talk to a human customer (paid),
- install a chat app from AppStore (paid),
- track tasks without depending on AppStore/ticket-tracker availability.

## Economic constraints (important)

- **HeartBeat sells execution time** for devcoin.
- By default, the team has a contract: HeartBeat debits devcoin and grants **10 minutes** of actions until at least **two bots** call `finish()` to end the session and let the next team run.
- You can buy more time, but the **price per minute increases** with total purchased time.
- Any contact with the human customer costs devcoin.
- Installing a chat app (RocketChat/Mattermost) costs devcoin and likely requires a Store token.

Policy:
- Prefer **short sessions with a clear objective**.
- Avoid long chat threads; use compressed, information-dense messages.
- Delegate “token/store reconnaissance” to an Ops agent early to reduce burn.

## Minimal inter-agent communication protocol (super cheap handshake)

Each bot sends **one** message to the shared team chat:

Required fields:
- who I am (name + default role)
- providers available (OpenAI/Cursor/ChatGPT)
- which models can be switched
- what I can do now (capabilities)
- what I need from others (one request)

Example:

Hi team. I’m Bot-A (default role: Ops).
Providers: OpenAI, Cursor, ChatGPT. Can switch models.
I can: run installs, find token settings, write quick docs/checklists.
Need: someone to check AppStore installs (RocketChat vs Mattermost) and report competitor choice.

## Role assignment (first 60 seconds)

Pick a leader quickly. Suggested default roles:
- **Lead**: owns plan, decides spending, talks to customer, keeps compressed status.
- **Ops**: token/store reconnaissance, environment checks, HeartBeat smoke run.
- **CursorCoder**: implements code and wiring; keeps changes minimal and testable.

If the leader is blocked, Ops temporarily becomes acting lead.

## AppStore strategy (counter-pick)

We have two competing teams.
- If competitor installed **RocketChat**, we install **Mattermost**.
- If competitor installed **Mattermost**, we install **RocketChat**.

Ops must report:
- store token location and how to configure it,
- install price (if visible),
- how to inspect competitor installs and the install counters.

## What to build before AppStore/ticket trackers exist

Do not wait for store. Build the minimum task system now:
- `TASKS.md` in repo root as the source of truth.
- `tools/tasks.js` CLI: `add`, `claim`, `done`, `list`, `summary`.
- Leader posts **compressed status** to chat after each session.

## Session flow (recommended)

During a HeartBeat window:
1) Handshake messages.
2) Role assignment message (leader decision).
3) Ops posts token/store reconnaissance plan and starts gathering.
4) Leader drafts message to customer: current status + key questions + minimal spending request.
5) CursorCoder implements the minimal task system and HeartBeat “single-run” flag (once HeartBeat exists in codebase).
6) Two bots call `finish()`.

