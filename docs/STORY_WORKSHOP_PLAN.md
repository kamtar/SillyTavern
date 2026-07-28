# Story Workshop

## Objective

Improve long-form roleplay quality by keeping plots, character intent, continuity, and prose direction active without bloating the visible chat or giving every helper the full roleplay prompt.

The system is a guarded story-development workflow, not an autonomous agent swarm:

```text
chat and private state
  -> deterministic scoped context
  -> one helper call
  -> private review or validated state update
  -> compact one-shot direction
  -> normal SillyTavern reply
```

## Design principles

1. **Separate context by default.** Helpers use `generateRaw()` with only the character/scenario, selected private state, and a bounded recent-message window declared by their preset.
2. **Hidden means outside chat.** Private outputs live in chat metadata. They reach the roleplay model only through an explicit one-shot action or the opt-in state-injection switch.
3. **Concrete change beats vague creativity.** Director presets require a material change in knowledge, goals, relationships, location, resources, danger, or commitment.
4. **Editable without code.** Every preset exposes its system prompt, task prompt, recent-message window, output limit, category, and default destination.
5. **Review before mutation.** Helpers may create private results, state, direction briefs, or composer drafts. Chat replacement will require a diff and undo checkpoint.
6. **Local-model friendly.** Prompts are short and explicit, do not require tool calling, and use the active SillyTavern connection. This works with Gemma-family and other local or hosted backends.

## State model

### Global extension settings

`extension_settings.storyWorkshop`

- Versioned editable agent presets
- UI preferences
- State-injection preference
- Later: automation mode, cooldowns, and per-turn call limits

### Per-chat private state

`chat_metadata.storyWorkshop`

- `artifacts`: scene, motivations, relationships, threads, style contract, and custom results
- `oneShotBrief`: expiring direction for the next normal reply
- `history`: bounded helper-run audit history

Character cards are not modified. A later phase may add an explicit “save as character default” action.

## Preset and context schema

Each preset currently contains:

- stable ID and schema version
- name and category
- system and task prompts
- number of recent messages
- maximum output tokens
- default destination
- private-state key

The first implementation ships 24 presets across Story, Character, Continuity, Writing, and Diagnostics. Built-ins can be edited and restored; users can duplicate any preset into a custom agent.

Each request contains:

1. The preset's system prompt
2. Its resolved task and optional user focus
3. The active character card and scenario
4. This chat's private Story Workshop artifacts
5. Only the requested recent message window

The GUI can preview the exact system and user request before generation.

## Anti-loop approach

The initial presets attack repetition in three layers:

- **Repetition Detector:** identifies repeated wording, gestures, emotional beats, and conversational moves.
- **Nothing Changed Detector:** checks whether any important story dimension changed.
- **Director / Break Stasis:** creates a compact, causally grounded direction with a character initiative and consequence.

The accepted brief is injected once at in-chat depth 0 as a system-role extension prompt, then removed after the next character message is rendered.

Later deterministic diagnostics should track:

- repeated sentence openings and phrases
- similarity among recent assistant replies
- turns spent on the same beat
- character-initiated actions
- dormant open threads
- changes in knowledge, goals, relationships, resources, danger, and commitments

These cheap metrics should trigger suggestions in Assist mode before adding extra model calls.

## UX

The bundled extension adds:

- A native settings drawer with quick access
- A responsive Story Workshop dialog
- Run, Story State, Agents, and Runs tabs
- Exact-context preview
- Private result review
- Explicit actions to use once, save to state, or copy to the composer
- Editable and searchable preset library
- Per-chat JSON state editor for the first vertical slice

The next UX iteration should add a composer toolbar and message-menu actions after the extension workflow is stable.

## Delivery phases

### Phase 1 — manual guarded MVP

- [x] Bundled extension and native settings entry
- [x] 24 editable helper presets
- [x] Bounded helper context using `generateRaw()`
- [x] Exact request preview
- [x] Per-chat private artifacts
- [x] Opt-in state prompt injection
- [x] Expiring one-shot direction brief
- [x] Composer draft action
- [x] Bounded run history
- [ ] Structured state forms and field-level locks
- [ ] Preset JSON import/export
- [ ] Last-assistant-message rewrite diff and undo
- [ ] Slash commands and composer quick actions

### Phase 2 — Assist mode

- Deterministic repetition and stagnation scoring
- Suggestions after every configurable number of assistant turns
- Scene-state delta updates on scene changes
- Cancellable serial job queue
- Cooldowns and maximum calls per turn/session
- Run inspector with state diffs and timing
- One-click global and per-chat pause

Assist mode may analyze and suggest, but does not inject or mutate automatically.

### Phase 3 — guarded automation and editing

- Before-reply director scheduling when stagnation crosses a threshold
- Validated structured outputs with tolerant JSON repair for local models
- Selected-range rewrite with role/message-count validation
- Side-by-side per-message diff
- Revision hash, transactional apply, and undo
- Character-specific state and group-chat handling
- Scene-boundary summaries and relevant-history retrieval

### Phase 4 — advanced routing and workflows

- Request-level connection/model overrides where supported
- Ordered helper pipelines
- Relationship and knowledge-boundary tracking
- World Info candidates
- Workflow packs and preset sharing
- Accessibility, mobile polish, localization, and long-chat stress tests

## Safety and failure rules

- Transcript text is delimited as untrusted story evidence.
- Model output is rendered as text, never executable HTML.
- Helper results do not enter chat automatically.
- User-authored messages will never be rewritten without explicit opt-in.
- Chat rewrites must preserve complete message objects and be reversible.
- Automatic helper generations must be excluded from their own triggers.
- Jobs should be discarded if the chat revision changes while they run.
- “Private” is a UI/storage property, not encryption; injected content is sent to the selected backend.

## Recommended next implementation order

1. Test the current manual workflow against the user's Gemma setup and tune the six core prompts: Story Director, Break Stasis, Motivation, Scene Snapshot, Less Generic, and Rewrite Recent Reply.
2. Add structured scene/story/character state with tolerant parsing and field locks.
3. Implement transactional last-reply rewrite review and undo.
4. Add local stagnation metrics and Assist-mode suggestions.
5. Add guarded pre-reply orchestration only after recursion, cancellation, and stale-result handling are verified.
