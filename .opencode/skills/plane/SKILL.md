---
name: plane
description: Standardized workflow and conventions for managing engineering work in Plane — covers hierarchy, states, naming, dependencies, and the project workspace/project IDs.
---

# Plane Project Management

Plane is the project management tool used for all engineering work in this repo.
MCP tool prefix: `plane_*`

---

## Workspace & Projects

| Field | Value |
|-------|-------|
| Workspace ID | `f1854190-6362-4472-9023-2f5e454aef2a` |

| Project Name | Identifier | Project ID |
|--------------|-----------|------------|
| OnlyKas | OKAS | `88220f9b-b31c-4024-8ce7-7121cc63ffa7` |

---

## Initial project

- **If the Project Name row is empty** — a Plane project hasn't been created for this repo yet:
  1. Create a project via `plane_create_project` using this repository's name (or ask the user for a name)
  2. Update the table above in this file with the returned `name`, `identifier`, and `id`

- **If the row has values** — the project already exists, use them directly.

Keep the Workspace ID as-is — it is shared across all repos.

## Language

| Term | Meaning |
|------|---------|
| **Work Item / Issue** | A single task ("To-Do") |
| **Ticket ID** | Unique identifier e.g. `KJ-1` — always reference tasks by ID |
| **Backlog** | Someday pile — scoped but not yet active |
| **To Do** | Active pile — ready to be picked up |
| **Module** | Groups related issues for a feature (tracks progress regardless of time) |
| **Parent Issue** | One complete user flow (end-to-end, testable standalone). After completion, a customer could use it. |
| **Sub-issue** | Granular technical step within a single user flow. Must include non-functional concerns (error handling, loading, empty states, validation, edge cases). |

---

## Hierarchy: Discovery → Implementation

> This is the ideal structure for complex features. It is not required for every task — use as much of it as the scope justifies. A quick bug fix may just be a single work item with no module or parent.

```
Page (PRD) — Why & What
 └── Page (HLD) — How (system-level)
      └── Module — How (feature grouping & progress)
           └── Parent Issue — What (user-facing outcome)
                └── Sub-issues — How (technical steps)
```

### Phase 1 — Discovery (PRD)

| Field | Value |
|-------|-------|
| **Answers** | *Why* (business rationale, goals) and *What* (requirements, scope, user stories) |
| **Knows about** | Only HLD — hands off the "what/why" so HLD can define the system "how" |
| **Does NOT dictate** | Architecture, implementation details, task breakdown |

- Create a **Page** as the PRD (source of truth for requirements).
- A clear PRD prevents the HLD from making incorrect assumptions about scope.

### Phase 2 — Design (HLD)

| Field | Value |
|-------|-------|
| **Answers** | *How* at the system level — architecture, components, data flow, interfaces, technology choices |
| **Knows about** | PRD (receives the "what") → Module (hands off the system "how" for feature scoping) |
| **Does NOT dictate** | Feature grouping, task breakdown, sprint planning |

- Create a **Page** as the HLD (High-Level Design — architecture, component breakdown, data flow, API contracts).
- Link the PRD Page using `@` in the HLD description.
- Surface any gaps in the PRD assumptions back to the PRD before proceeding.

### Phase 3 — Planning (Module)

| Field | Value |
|-------|-------|
| **Answers** | *How* work is grouped and tracked — feature scope, progress tracking |
| **Knows about** | HLD (receives the system design) → Parent Issues (organizes product goals within the feature) |
| **Does NOT dictate** | System architecture, implementation details, user-facing outcomes |

- Create a **Module** to group all related issues (e.g. "User Authentication").
- Link the HLD Page using `@` in the Module description.
- Modules track overall feature progress independent of sprints.

### Phase 4 — Refinement (Parent Issue)

| Field | Value |
|-------|-------|
| **Answers** | *What* user-facing outcome — one complete user flow |
| **Knows about** | Module (receives feature scope) → Sub-issues (defines what to build at a granular level) |
| **Does NOT dictate** | System architecture, granular implementation steps |

**A Parent Issue = one user flow.** It must answer "what can the user do now that they couldn't before?" with a clear, testable outcome. When the Parent Issue is done, that flow is demoable and presentable to customers.

- Create **Parent Issues** describing a single user flow (e.g. "User can log in with Google").
- If a Parent Issue is too large to complete in a reasonable time and present to customers, split it into smaller demoable flows.
- Link the Module using `@` in the description.
- Assign the issue to the correct Module.
- All Parent Issues in a Module trace to the same HLD Page.

### Phase 5 — Execution (Sub-issue)

| Field | Value |
|-------|-------|
| **Answers** | *How* technically — granular implementation steps for one user flow |
| **Knows about** | Parent Issue (receives the goal) |
| **Does NOT dictate** | Product requirements, system architecture, what other sub-issues do |

- Break each Parent Issue into **Sub-issues** for technical steps within that *single* flow.
- **Every Sub-issue list must include non-functional concerns:** error handling, validation, loading/empty/error states, edge cases, and tests. These are not deferred to a "Polish" task later.
- **Every sub-issue that writes code must include unit tests** for that code. A sub-issue is not Done without them.
- **Every parent issue must include a final whole-issue testing sub-issue**, covering:
  - an **integration test** — the whole service as a black box: send input, read output, verify behavior; external dependencies (anything outside our code) are mocked; and
  - a **regression test** — the full existing test suite must stay green after the parent issue's changes.
- This keeps the product view clean while giving developers a granular checklist.

---

## Execution Principle: One Flow at a Time

This is the core operating principle for all feature work.

### Rule

**Implement one Parent Issue completely — end-to-end — before starting the next.** Each Parent Issue delivers a single, complete user flow that is testable and presentable on its own.

### Why

- After every Parent Issue, we have something usable to show customers
- No unfinished flows accumulate; no work-in-progress spans multiple unrelated areas
- Each Sub-issue contributes directly to a shippable outcome
- Defines a clear "Done": the flow works, handles errors, shows feedback, and is presentable

### Scope Discipline

If a Parent Issue cannot be completed and demoed in a reasonable time, it is too large. Split it into smaller flows that each deliver independent value. A flow is too large when:
- It requires changes across more than 2–3 unrelated subsystems
- The Definition of Done includes "and then we'll also add X later"
- A customer could not understand or use the result after completion

### What "Demoable" Means

Each completed Parent Issue must meet this bar before marking Done:
- The user can complete the flow without errors
- Loading, empty, error, and success states are handled
- Validation and feedback are in place
- Edge cases don't crash or produce confusing behavior
- All unit, integration, and regression tests pass
- A customer could be shown it without embarrassment

---

## Testing Conventions

Three levels of tests are expected on every feature:

| Level | Scope | What it checks |
|-------|-------|----------------|
| **Unit test** | One function/module in isolation, no I/O | Pure logic, edge cases, error handling |
| **Integration test** | The whole service as a black box | Input → output behavior of our code; external dependencies (outside our code) are mocked |
| **Regression test** | The entire existing suite | Nothing previously working broke after new changes |

- **Unit tests** are written by the sub-issue that writes the code (see Phase 5).
- **Integration tests** live in a dedicated whole-issue testing sub-issue on each parent.
- External dependencies that are not our code (chain nodes, wallets, third-party services) are always mocked; we only verify the behavior of the code we wrote.

---

## Dependencies

When a task must be completed before another can begin:
1. Open the blocked ticket.
2. Add a **"blocked_by"** relation to the prerequisite ticket via `plane_create_work_item_relation`.
3. The ticket stays visually "Blocked" until the prerequisite is Done.

---

## The 4-Click Rule

Every task must be traceable upward in 4 clicks:
1. Sub-issue → Parent Issue (breadcrumb)
2. Parent Issue → Module (sidebar)
3. Module → HLD (link in description)
4. HLD → PRD (link in description)

**Rules:**
- Always link to the phase directly above using `@` in descriptions.
- Never leave a technical task floating without a parent if it belongs to a larger feature.

---

## Level Responsibility Principle

**Each level's responsibility is to provide all the answers for the level below.**
Every level must be clear enough on its own, and each lower level is progressively more focused. If a level can't be understood without leaving it, it is under-specified — enrich that level rather than pointing upward. The path upward exists for context, not as the source of instructions.

---

## Work Item Lifecycle

1. **On creation** → state = Backlog (not yet ready) or Todo (ready to pick up)
2. **Before starting** → update state = In Progress
3. **After completing** → update state = Done
4. **If no longer needed** → update state = Cancelled (never mark irrelevant tasks as Done — it distorts history)

Mark tasks one at a time, immediately after completion. Never batch state updates.

If a task is discovered mid-session, create it in Plane before starting it.

---

## Priorities

| Priority | When to use |
|----------|-------------|
| `urgent` | Blockers, branch setup, core new files |
| `high` | Deletions, config updates, wiring |
| `medium` | Exception handling, minor renames |
| `low` | Cosmetic changes, log string renames |
