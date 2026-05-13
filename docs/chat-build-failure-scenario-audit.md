# SolClaw Chat/Build Failure Scenario Audit

Date: 2026-05-13

Purpose: log known chat/build risks, then expand them into 100 user scenarios that can become a combined fix backlog. This is not a bug-fix plan yet; it is the issue map we should use before patching.

## Baseline Findings Already Logged

1. **Plain "build it" can miss Build mode.** The current intent detection catches terms like `implement`, `edit`, and `patch`, but plain `build it` can stay in Chat mode unless the user manually toggles Build.
2. **Only Anthropic has the full tool loop.** OpenAI/OpenRouter-compatible paths can chat, but do not currently execute the local IDE tools autonomously.
3. **The Live pill hides the exact missing dependency.** "Not live" can mean missing folder, missing permission, missing local IDE agent, or a failing `/__agent` endpoint.
4. **Tool round limits can pause real builds.** A multi-file change can exhaust the tool-step cap before write, typecheck, UI verification, and fixes are complete.
5. **The model can still waste rounds exploring.** Prompt guidance asks for targeted discovery, but the runtime does not prevent repeated or broad searches.
6. **Workspace fallback is write-only in practice.** Browser workspace fallback supports read/write/list, but not search, typecheck, build, DOM verification, or rollback.
7. **Rollback is too coarse.** Header rollback targets the latest local edit, not necessarily the current chat response.
8. **Editing old messages does not rewind files.** Chat history can be truncated while previous disk writes remain applied.
9. **Algo draft vs runnable engine can blur.** A draft Algo Lab preset can be mistaken for a live strategy with a watchlist or trading loop.
10. **Provider errors are not normalized.** Anthropic messaging is improved, but OpenAI-compatible errors can still frame token/route problems as credits/account issues.

## Scenario Matrix

### A. Mode And Intent Detection

1. **User says "build it".** Failure: stays in Chat mode and returns another blueprint. Diagnosis: intent regex does not include plain `build`. Fix direction: add explicit build phrases and show detected mode before send.
2. **User says "make it real".** Failure: assistant keeps ideating. Diagnosis: phrase is implementation intent but not detected. Fix direction: add natural-language implementation aliases.
3. **User says "add this preset".** Failure: creates an Algo Lab draft but no code implementation. Diagnosis: "add" can mean register draft or edit code. Fix direction: ask one concise disambiguation or infer from current stage.
4. **User asks "can you wire this in?"** Failure: may not trigger Build unless `wire` is caught consistently. Diagnosis: regex has `wire`, but UI mode still says Chat and confuses user. Fix direction: auto-switch UI mode visibly when build intent is detected.
5. **User toggles Build for strategy discussion.** Failure: model may use tools too early and hit provider/tool limits. Diagnosis: manual mode overrides intent. Fix direction: allow Build, but if no edit intent, keep tools disabled and label as "Build armed".
6. **User says "fix the flow" without naming files.** Failure: assistant may ask user where files are. Diagnosis: prompt says do not ask, but model may not have enough file tree context. Fix direction: include high-signal app map and first files to inspect.
7. **User says "continue".** Failure: assistant does not know whether to continue blueprint, build, or previous paused tool loop. Diagnosis: no persisted build state. Fix direction: store last blocked action/state and resolve "continue" against it.
8. **User says "continue build" after a paused run.** Failure: model redoes discovery instead of resuming. Diagnosis: prior tool history is trimmed and no checklist exists. Fix direction: persist compact build plan and completed file list.
9. **User edits old "build it" message to "explain it".** Failure: old code edits remain, but conversation now implies no build happened. Diagnosis: chat history rollback and file rollback are separate. Fix direction: warn and offer rollback for edits from truncated turns.
10. **User asks "which tokens are you watching?" for a draft.** Failure: assistant hallucinates a live watchlist. Diagnosis: draft/runnable state not strongly enforced. Fix direction: make `runnable: no` a hard prompt rule and UI badge.

### B. Workspace And Local Agent Readiness

11. **No local workspace connected.** Failure: Build outputs code blocks instead of writing files. Diagnosis: tools unavailable. Fix direction: show "Blocked: connect workspace" before provider call for build tasks.
12. **Workspace handle exists but permission expired.** Failure: reads silently fail or return no context. Diagnosis: persisted handle needs permission renewal. Fix direction: detect permission state and prompt one-click resume.
13. **Wrong folder selected.** Failure: package.json check passes for another project, edits wrong repo. Diagnosis: only checks `package.json`, not repo identity. Fix direction: validate expected `package.json` name or marker files.
14. **Local IDE agent endpoint is down.** Failure: search/typecheck/build tools return unavailable. Diagnosis: `/__agent/status` false. Fix direction: distinguish "write-only" from "full IDE".
15. **Vite app served from a different repo than selected folder.** Failure: files write somewhere else, UI does not change. Diagnosis: local workspace and `/__agent` scope can diverge. Fix direction: compare package path/hash via agent status.
16. **Browser does not support File System Access API.** Failure: local writes cannot work. Diagnosis: Firefox or unsupported environment. Fix direction: explicit compatibility banner and GitHub-only fallback.
17. **User revokes folder permission mid-build.** Failure: write fails after some files changed. Diagnosis: partial edit transaction. Fix direction: group edits with rollback metadata and stop with partial-change report.
18. **Workspace has huge file tree.** Failure: digest/listing burns time and tokens. Diagnosis: `listLocalFiles` max/caching may still scan many files. Fix direction: cache harder and prioritize known app paths.
19. **`node_modules` exists but dependencies are stale.** Failure: typecheck/build errors unrelated to chat changes. Diagnosis: build environment drift. Fix direction: classify dependency/setup errors separately.
20. **Agent status says OK but tool route fails.** Failure: model keeps trying tools that return null/fallback errors. Diagnosis: status endpoint and tool endpoint not validated together. Fix direction: probe a cheap tool before declaring full Live.

### C. Provider And Model Behavior

21. **Anthropic 429 from token-per-minute.** Failure: user thinks credits are broken. Diagnosis: request too large. Fix direction: show token pressure and retry/backoff guidance.
22. **Anthropic 529 overloaded.** Failure: user thinks app is lying because other Claude apps work. Diagnosis: provider route/model overloaded. Fix direction: route-specific wording and one-click model fallback.
23. **OpenAI model selected for Build.** Failure: chat responds but cannot call tools. Diagnosis: OpenAI path lacks tool execution. Fix direction: add tool calling or mark model as Chat-only.
24. **OpenRouter model ignores system prompt.** Failure: asks user to paste files or manually apply. Diagnosis: weaker instruction following/model mismatch. Fix direction: per-model capability labels and stronger state preamble.
25. **Wrong provider key on OpenRouter.** Failure: auth errors. Diagnosis: Anthropic key pasted into OpenRouter. Fix direction: existing key hints should block earlier and include provider-specific labels.
26. **Model id typo.** Failure: empty or provider-specific error. Diagnosis: no model validation. Fix direction: validate against known presets or show raw provider response cleanly.
27. **Local Ollama selected but model not pulled.** Failure: timeout/connection error. Diagnosis: local model missing or server not running. Fix direction: detect local host and suggest exact `ollama pull`/server state.
28. **Provider stream starts then stalls.** Failure: hanging bubble or timeout. Diagnosis: SSE idle handling. Fix direction: keep idle timeout, but add retry/resume option preserving build state.
29. **Image attached with model that lacks vision.** Failure: provider rejects or ignores image. Diagnosis: no capability check. Fix direction: hide/disable image attachment for non-vision model or warn.
30. **Large code context exceeds model context.** Failure: truncation removes critical old decisions. Diagnosis: char-based trimming is approximate. Fix direction: summarize old strategy requirements into durable state.

### D. Prompt And Context Grounding

31. **System context gets clipped mid-rule.** Failure: model misses key build instruction. Diagnosis: `clipMiddle` can cut important middle content. Fix direction: reserve non-clippable critical rules.
32. **Live context includes stale selected algo.** Failure: assistant answers about wrong preset. Diagnosis: selected Trading preset differs from Algo Lab focus. Fix direction: include both Trading selected and Algo Lab focused states.
33. **Workspace file tree is empty.** Failure: model asks where files are. Diagnosis: digest empty or GitHub not wired. Fix direction: include baked-in common path map and blocked state.
34. **Historical @mentions load too many files.** Failure: token bloat and irrelevant context. Diagnosis: all previous @paths are carried forward. Fix direction: scope mentions to recent turns or active task.
35. **Mention fetch silently skips missing files.** Failure: assistant thinks it has context but does not. Diagnosis: catch block ignores errors. Fix direction: list failed @paths in prompt/UI.
36. **Blueprint details get lost after many turns.** Failure: build implements old/default values. Diagnosis: history trimmed without durable spec. Fix direction: persist an AlgoBlueprint object and build from it.
37. **Follow-up pills push wrong action.** Failure: user clicks "Build this" before spec is ready. Diagnosis: generic followups. Fix direction: generate followups based on missing required fields.
38. **Assistant sees order-book scalper docs and overfits.** Failure: new algos become scalper variants. Diagnosis: project knowledge is scalper-heavy. Fix direction: separate "new strategy from scratch" guidance.
39. **Draft says "paper mode first" but implementation skips paper-only guard.** Failure: unsafe live behavior. Diagnosis: safety rule stays prose-only. Fix direction: require safety checklist before runnable.
40. **Assistant invents exports despite digest.** Failure: broken imports. Diagnosis: digest trimmed or model ignores it. Fix direction: typecheck plus automatic import correction loop.

### E. Tool Loop And File Editing

41. **Model reads one file, writes incomplete replacement.** Failure: lost code. Diagnosis: write_file requires complete content, but model may omit sections. Fix direction: before write, require source length/read-back diff sanity.
42. **Model writes UTF-16/null-byte corrupted file.** Failure: TypeScript invalid characters. Diagnosis: prior repo issue with file encoding. Fix direction: write path should enforce UTF-8 and validate bytes.
43. **Model creates new file but misses export/import integration.** Failure: unused code. Diagnosis: stops after file creation. Fix direction: build plan must include integration points and verification.
44. **Model edits generated/bundled files.** Failure: changes overwritten. Diagnosis: file tree includes generated folders if not skipped everywhere. Fix direction: block writes to `dist`, generated snapshots, and bundle outputs.
45. **Model edits CSS/classes and UI breaks subtly.** Failure: typecheck passes, visual broken. Diagnosis: no browser verification. Fix direction: require DOM/screenshot checks for UI changes.
46. **Tool result clipped hides actual TypeScript error.** Failure: model fixes wrong issue. Diagnosis: `MAX_TOOL_RESULT_CHARS` clips middle. Fix direction: special-case diagnostics to keep first errors and edited files.
47. **Multiple tool calls in one round conflict.** Failure: reads stale file or writes in wrong order. Diagnosis: calls executed sequentially, but model may assume parallel. Fix direction: discourage multi-write same file in one round.
48. **Search tool unavailable in browser fallback.** Failure: model loops on search errors. Diagnosis: fallback returns hard error. Fix direction: hide unsupported tools when only browser workspace exists.
49. **Typecheck unavailable but model claims verified.** Failure: false success. Diagnosis: prompt says run it, but tool can return error requiring agent. Fix direction: require final answer to state verification unavailable.
50. **Build pauses after writing but before typecheck.** Failure: user sees changed app but no validation. Diagnosis: round limit. Fix direction: reserve last rounds for verification or auto-continue internally for verification.

### F. Apply Buttons And Fallback Code Blocks

51. **Fallback code block parser misses path.** Failure: no Apply button. Diagnosis: fenced info string format mismatch. Fix direction: support common formats and show parse errors.
52. **Assistant outputs partial diff, parser expects full file.** Failure: applying overwrites file with fragment. Diagnosis: fallback instructions can be ignored. Fix direction: parser should reject suspicious partial files.
53. **Multiple files output but user applies one.** Failure: broken imports. Diagnosis: apply buttons allow partial application. Fix direction: group dependent edits with one "Apply all required" primary action.
54. **User clicks `+ Add to Algo Lab` twice.** Failure: duplicate presets. Diagnosis: no dedupe by name/source. Fix direction: confirm/update existing draft.
55. **Algo block parser misses multiline description.** Failure: poor draft description. Diagnosis: strict block format. Fix direction: parse YAML/JSON-like variants.
56. **Config block applies to global scalper knobs unexpectedly.** Failure: wrong preset changes. Diagnosis: config patch applies `setScalperUserConfig` only. Fix direction: scope config patches to selected/focused preset.
57. **Mint directive loads chart when user wanted explanation.** Failure: unexpected navigation. Diagnosis: parser turns any mint fence into action. Fix direction: require explicit button click, already okay, but label context.
58. **Apply all writes local but not GitHub.** Failure: user expects deployed app to update. Diagnosis: local and GitHub paths differ. Fix direction: label "local only" vs "push to GitHub".
59. **Diff original empty for new and failed existing files.** Failure: user cannot tell create vs fetch failure. Diagnosis: catch sets empty. Fix direction: show "new file" vs "could not load original".
60. **Apply error persists across unrelated actions.** Failure: stale error scares user. Diagnosis: some actions clear, some may not. Fix direction: clear errors on tab/send/apply mode changes consistently.

### G. Algo Lab And Strategy Lifecycle

61. **Chat-created preset appears in Trading before runnable.** Failure: user can select a non-runnable algo. Diagnosis: userAlgos list shared across tabs. Fix direction: Trading dropdown should hide or badge non-runnable drafts.
62. **New manual preset has no blueprint object.** Failure: blank state lacks structure. Diagnosis: manual `saveUserAlgoPreset` path may not create blueprint. Fix direction: create draft blueprint for every new preset.
63. **Delete preset leaves orphaned sessions.** Failure: Performance references missing preset. Diagnosis: sessions keep preset id/name. Fix direction: preserve session display by name and mark preset deleted.
64. **Delete preset while selected in Trading.** Failure: selected id becomes null and UI may shift. Diagnosis: global selected state reset. Fix direction: fall back to built-in with clear toast.
65. **Editing scalper knobs in Algo Lab changes built-in globally.** Failure: user may not understand defaults are changed. Diagnosis: built-in config is shared user override. Fix direction: label "your override" and reset option.
66. **Custom non-scalper shows scalper UI.** Failure: confusing blueprint. Diagnosis: strategyId/config inference wrong. Fix direction: show knobs only if strategy matches.
67. **Zombie draft shows no watchlist UI.** Failure: user thinks build failed. Diagnosis: draft not runnable. Fix direction: explicit draft card: "engine not built yet".
68. **Blueprint status never advances.** Failure: user cannot tell draft/paper/live readiness. Diagnosis: no lifecycle transitions. Fix direction: set status after implementation/typecheck/paper session.
69. **Performance tab can select draft with no sessions.** Failure: empty confusing page. Diagnosis: no empty-state explanation. Fix direction: "No sessions yet; run paper session first."
70. **Algo Lab focus changes but Trading still selected elsewhere.** Failure: user sees inconsistent preset names. Diagnosis: two selections are intentional but not explained. Fix direction: label "Work on" vs "Trade with" clearly.

### H. Trading And Runtime State

71. **User starts Trading with a draft algo.** Failure: session stops or runs wrong engine. Diagnosis: only scalper can run. Fix direction: disable Start for non-runnable presets.
72. **Session naming box blocks start.** Failure: user forgets to save name. Diagnosis: inline box is better than modal but still a state. Fix direction: Enter key starts; default name option.
73. **Trading session logs scalper config for non-scalper.** Failure: incorrect training data. Diagnosis: `TradingSessionRecord` config snapshot is scalper-shaped. Fix direction: generalize session config snapshot by strategy.
74. **Kill switch UI added to draft only.** Failure: no runtime enforcement. Diagnosis: UI and engine state separate. Fix direction: require engine integration before marking runnable.
75. **Live mode selected, draft strategy starts paper assumptions.** Failure: unsafe mismatch. Diagnosis: draft/runnable mode not enforced. Fix direction: hard block real trading unless engine has live safety checks.
76. **PumpPortal stream open but strategy engine stopped.** Failure: assistant says stream means watching. Diagnosis: stream state and engine state conflated. Fix direction: live context should separate data feed from active strategy.
77. **Loaded mint unrelated to strategy watchlist.** Failure: assistant answers from chart mint. Diagnosis: chart state overused. Fix direction: include active engine watchlist separately only when exists.
78. **Saved session misses order-book snapshots.** Failure: later LLM cannot train properly. Diagnosis: session logging may only include trades/config. Fix direction: define full session artifact schema.
79. **PnL shown for wrong preset after selection changes.** Failure: misleading performance. Diagnosis: filters by selected preset can drift. Fix direction: Performance should key off session preset id/name immutable.
80. **Real trade error hidden in chat context only.** Failure: user misses failed execution. Diagnosis: live error exists but not surfaced in Trading UI strongly. Fix direction: persistent trading alert until acknowledged.

### I. UX, Navigation, And User Trust

81. **Chat action navigates unexpectedly.** Failure: like the Zombie flow, user loses place. Diagnosis: side effects hidden behind buttons. Fix direction: buttons must state destination/effect.
82. **Mode toggle is too small/unclear.** Failure: user does not know Chat vs Build difference. Diagnosis: compact UI sacrifices clarity. Fix direction: tooltip plus state-specific placeholder.
83. **"Not live" looks like a minor status, but Build depends on it.** Failure: user asks build and gets blocked late. Diagnosis: passive indicator. Fix direction: on Build send, block early with exact fix.
84. **Assistant says "I will" but does not edit.** Failure: trust loss. Diagnosis: model response not tied to actual tool calls. Fix direction: final status should include files actually written.
85. **Assistant asks for manual file output.** Failure: user feels IDE promise broken. Diagnosis: fallback prompt allows code fences. Fix direction: only fallback when not live, and say why.
86. **Progress line disappears after tool call.** Failure: user sees no audit trail. Diagnosis: progress line removed before continuing. Fix direction: collapsible tool log per response.
87. **Long generated replies dominate chat.** Failure: hard to use. Diagnosis: code fences collapsed, but plans can still be long. Fix direction: concise response plus separate build log.
88. **No clear "current task" display.** Failure: user loses what build is doing. Diagnosis: chat only. Fix direction: build task card with plan, status, files, blockers.
89. **User cannot tell draft saved successfully.** Failure: clicks add again. Diagnosis: small button feedback. Fix direction: toast/status in Algo Lab after add.
90. **Errors use provider/internal terms.** Failure: user does not know next action. Diagnosis: raw error messaging. Fix direction: every error has "what happened" and "what to do next."

### J. Persistence, Recovery, And Multi-Session

91. **Reload during build.** Failure: pending task lost, partial files remain. Diagnosis: no persisted in-progress build transaction. Fix direction: save build transaction state.
92. **Multiple chat tabs use different models.** Failure: user thinks global settings broken. Diagnosis: session overrides hidden. Fix direction: make custom model state more visible.
93. **Close chat with unapplied edits.** Failure: suggested code lost. Diagnosis: no draft preservation warning. Fix direction: warn if response has unapplied edits.
94. **Clear conversation after edits.** Failure: edit provenance lost, rollback harder. Diagnosis: rollback history separate but UI context gone. Fix direction: retain edit history panel independent of chat.
95. **Local storage quota exceeded.** Failure: chat/session save fails. Diagnosis: many messages/session artifacts. Fix direction: storage health check and pruning.
96. **Two browser tabs open same app.** Failure: state overwrites, conflicting edits. Diagnosis: localStorage/IDB shared without locking. Fix direction: tab session id and conflict warning.
97. **User switches repo branch externally.** Failure: agent writes against changed files unexpectedly. Diagnosis: no git/branch awareness. Fix direction: agent status should expose git branch and dirty state.
98. **HMR reload resets component-local mode.** Failure: Chat/Build toggle returns default Chat. Diagnosis: mode not persisted. Fix direction: persist chat mode per session or infer from task.
99. **Model response truncated by max tokens.** Failure: no code block close or incomplete plan. Diagnosis: max token cap. Fix direction: detect incomplete fences/tool stops and ask/auto-continue.
100. **A fix introduces new failure in another tab.** Failure: local patch solves chat but breaks Trading/Performance. Diagnosis: cross-tab contracts are implicit. Fix direction: add regression checklist for Chat, Algo Lab, Trading, Performance after every build-flow fix.

## Combined Fix Themes

1. **State machine:** represent `Blueprint`, `Draft`, `Build full IDE`, `Build write-only`, and `Blocked` explicitly in UI and prompt.
2. **Capability model:** separate provider chat capability from tool/build capability.
3. **Durable build tasks:** persist a compact plan, completed steps, files touched, verification status, and rollback ids.
4. **Draft/runnable boundary:** non-runnable Algo Lab drafts must not behave like Trading engines.
5. **Verification contract:** final answers should say exactly what was written and what verification passed or was unavailable.

## Extended Scenario Matrix

These 200 additional scenarios broaden the audit beyond the initial chat/build loop. They cover onboarding, permissions, model setup, data integrity, Algo Lab lifecycle, trading safety, performance analysis, browser/runtime constraints, security, deploy, collaboration, accessibility, and operational recovery.

### K. Onboarding And First-Run Setup

101. **User opens the app with no API key, no workspace, and no chart mint.** Failure: empty state gives no clear next action. Diagnosis: setup steps are split across panels. Fix direction: first-run checklist with model, workspace, and data feed status.
102. **User connects model before workspace.** Failure: chat answers but cannot build. Diagnosis: model setup feels complete even though IDE capability is missing. Fix direction: separate "chat ready" from "build ready".
103. **User connects workspace before model.** Failure: Build UI appears live but provider is unavailable. Diagnosis: local readiness and LLM readiness are independent. Fix direction: build readiness should require both.
104. **User chooses GitHub setup expecting local instant edits.** Failure: edits do not HMR locally. Diagnosis: GitHub and local workspace workflows are different. Fix direction: label GitHub as repo sync and local as instant edit.
105. **User runs app from `dist` instead of Vite dev server.** Failure: local agent endpoint missing. Diagnosis: production preview cannot expose full IDE tools. Fix direction: show "full Build requires `npm run dev`".
106. **User opens app in a privacy browser profile.** Failure: persisted handles/API settings disappear. Diagnosis: localStorage/IndexedDB disabled or cleared. Fix direction: detect storage availability and warn.
107. **User has multiple SolClaw clones.** Failure: selects the wrong clone and edits old code. Diagnosis: identical folder names or stale branches. Fix direction: show selected folder path/branch from local agent.
108. **User skips Setup and asks chat to fix app.** Failure: assistant consumes model call just to say setup missing. Diagnosis: blocked state checked too late. Fix direction: preflight build requests before provider call.
109. **User enters API key with leading/trailing spaces.** Failure: provider auth fails if not trimmed everywhere. Diagnosis: input handling may trim in some paths only. Fix direction: trim and mask consistently on save.
110. **User pastes a full `.env` line instead of key.** Failure: auth header includes `ANTHROPIC_API_KEY=...`. Diagnosis: no normalization. Fix direction: parse common env assignment format.
111. **User selects an unsupported browser.** Failure: local workspace connect button fails. Diagnosis: File System Access support missing. Fix direction: disable button with browser-specific explanation.
112. **User is on mobile/tablet.** Failure: workspace picker and panels unusable. Diagnosis: app is desktop IDE/trading surface. Fix direction: mobile read-only mode or explicit desktop requirement.
113. **User starts in real-money mode by accident.** Failure: setup allows risky default. Diagnosis: trading mode persistence can surprise. Fix direction: default to paper after first run or require real-mode confirmation.
114. **User does not understand "LLM", "workspace", or "agent".** Failure: setup language is too technical. Diagnosis: UI copy uses implementation terms. Fix direction: user-facing labels: "AI key", "project folder", "local editor bridge".
115. **User connects model with insufficient permissions/account status.** Failure: first request fails. Diagnosis: no test request. Fix direction: "Test model" button with simple health result.
116. **User connects workspace but package is missing dependencies.** Failure: build later fails. Diagnosis: setup does not run dependency readiness. Fix direction: optional setup check for `node_modules` and typecheck.
117. **User opens old bookmarked URL with stale local storage schema.** Failure: state parse errors or weird defaults. Diagnosis: migrations incomplete. Fix direction: versioned storage migrations and reset path.
118. **User chooses a parent directory containing multiple repos.** Failure: file listing slow and writes wrong nested path. Diagnosis: package check may find only root package or none. Fix direction: require exact repo root.
119. **User changes local folder after chat has context from old folder.** Failure: model builds against stale assumptions. Diagnosis: chat history survives workspace switch. Fix direction: insert system event and clear/downgrade repo context.
120. **User has no PumpPortal/API data yet.** Failure: strategy questions about live state get misleading "none" answers. Diagnosis: data readiness not separated from model/workspace readiness. Fix direction: show market-data readiness in Live details.

### L. Model Settings And Multi-Provider Routing

121. **User switches provider mid-conversation.** Failure: new model lacks context/tool capability. Diagnosis: session model override changes behavior silently. Fix direction: add provider switch event and capability badge.
122. **Global model differs from chat-tab override.** Failure: user changes Setup but current tab still uses old model. Diagnosis: override indicator is small. Fix direction: show active source: global vs tab override.
123. **Provider base URL has trailing path mistakes.** Failure: requests hit wrong endpoint. Diagnosis: URL resolver may not catch all variants. Fix direction: normalize and validate known provider URL shapes.
124. **OpenRouter model supports tools but app does not pass tools.** Failure: capability left unused. Diagnosis: provider abstraction only implements Anthropic tool loop. Fix direction: provider capability registry.
125. **Anthropic model name deprecated.** Failure: provider returns model not found. Diagnosis: static model list can stale. Fix direction: editable model with validation and known-current presets.
126. **Small/cheap model selected for large build.** Failure: poor code edits and loops. Diagnosis: no task-to-model guidance. Fix direction: recommend stronger model for Build mode.
127. **High-latency provider causes repeated user resends.** Failure: duplicate assistant turns/build tasks. Diagnosis: pending state may not feel responsive. Fix direction: clearer progress and idempotent resend handling.
128. **Provider returns non-SSE streaming despite stream requested.** Failure: parser path may not match payload. Diagnosis: provider compatibility varies. Fix direction: robust non-stream fallback per provider.
129. **Provider rate limits after tool round 6.** Failure: partial edits are applied but final verification missing. Diagnosis: external limit mid-build. Fix direction: partial-build recovery state.
130. **Provider rejects browser-origin direct calls.** Failure: CORS error in deployed app. Diagnosis: no server proxy in production. Fix direction: explicit deployment architecture or user-supplied proxy.
131. **API key stored in browser localStorage.** Failure: user expects stronger secret storage. Diagnosis: client-side app limitation. Fix direction: security warning and local-only recommendation.
132. **User shares screen while key is visible.** Failure: accidental secret exposure. Diagnosis: key field masking can be bypassed in edit mode. Fix direction: default masked, reveal timed and explicit.
133. **Model outputs invalid JSON in config block.** Failure: Apply to knobs missing or fails. Diagnosis: model formatting. Fix direction: tolerant parser plus validation errors.
134. **Model outputs markdown table for algo block.** Failure: no one-click add. Diagnosis: parser expects fenced `algo`. Fix direction: parse structured patterns or ask model to regenerate one-click block.
135. **Model repeats previous provider error after settings fixed.** Failure: stale assistant response confuses user. Diagnosis: old messages remain visible. Fix direction: add "retry with current settings" affordance.
136. **Model sees stale project knowledge after code changes.** Failure: suggests old paths. Diagnosis: bundled knowledge generated at build time. Fix direction: prefer live exports/file tree over bundled docs.
137. **Model does not support images but UI accepts screenshots.** Failure: rejected request. Diagnosis: capability mismatch. Fix direction: disable image attach unless selected model supports it.
138. **Model overuses hidden followups.** Failure: users click generated options that skip necessary safety steps. Diagnosis: followups are model-controlled. Fix direction: app-side filter for unsafe followups.
139. **Provider returns safety refusal for trading content.** Failure: user cannot build benign paper-trading UI. Diagnosis: prompt wording may sound like financial advice. Fix direction: emphasize tooling/simulation and no advice.
140. **Provider token pricing surprises user.** Failure: large build calls cost more than expected. Diagnosis: no estimate. Fix direction: show approximate context size/cost tier before large Build.

### M. Chat History, Memory, And Conversation Control

141. **Long chat trims the exact strategy constraints.** Failure: final build uses wrong thresholds. Diagnosis: history trimming is not semantic. Fix direction: extract and persist strategy spec into blueprint state.
142. **User creates two algos in one chat.** Failure: build mixes requirements. Diagnosis: active draft not explicit. Fix direction: require/select target Algo Lab draft before building.
143. **User says "make it like the last one."** Failure: last one may be trimmed or ambiguous. Diagnosis: no named references. Fix direction: resolve to specific preset and confirm.
144. **User edits an assistant response mentally but not in UI.** Failure: model follows old text. Diagnosis: chat cannot know unrecorded preference. Fix direction: encourage changes as explicit messages/blueprint fields.
145. **User deletes a chat tab with important build context.** Failure: later build lacks rationale. Diagnosis: chat tab deletion removes history. Fix direction: persist blueprint independent of chat.
146. **User renames chat but not algo.** Failure: naming mismatch. Diagnosis: chat session and preset are separate. Fix direction: optionally sync names when creating draft.
147. **User clears chat after creating Algo Lab draft.** Failure: draft remains but reasoning gone. Diagnosis: blueprint may have sparse fields. Fix direction: store full blueprint summary at creation.
148. **User opens new chat and asks "continue zombie".** Failure: assistant may not identify draft. Diagnosis: cross-chat memory only via live context. Fix direction: list matching drafts and ask/select.
149. **Assistant hidden followups are included in history.** Failure: model sees internal suggestions as prior content. Diagnosis: comments may remain in message content. Fix direction: strip hidden followups before history request.
150. **User copies assistant code from collapsed fence manually.** Failure: applies stale/incomplete code outside app tracking. Diagnosis: manual copy bypasses edit history. Fix direction: prefer write/apply buttons and warn.
151. **Stop generation during tool call.** Failure: file write may still finish but UI says stopped. Diagnosis: abort signal may not cancel server-side operation. Fix direction: report whether any tool completed after stop.
152. **Stop during provider retry delay.** Failure: status remains retrying. Diagnosis: abort catch can swallow state update. Fix direction: deterministic stopped status.
153. **User sends a second build request while first pending.** Failure: ignored due to pending, or user thinks it queued. Diagnosis: no task queue. Fix direction: show disabled composer reason or queue explicitly.
154. **User asks unrelated chat during build.** Failure: blocked by pending state. Diagnosis: single chat stream. Fix direction: allow new tab or background build task.
155. **Assistant returns empty response.** Failure: user has no recovery path. Diagnosis: parser/provider issue. Fix direction: retry/regenerate button with diagnostics.
156. **Chat title remains "Chat 1" after important build.** Failure: hard to find later. Diagnosis: no auto-title. Fix direction: auto-title from first meaningful request.
157. **User cannot search chat history.** Failure: loses prior decisions. Diagnosis: no chat search. Fix direction: add search or blueprint decision log.
158. **User changes old threshold from 10 min to 15 min after build.** Failure: code and blueprint diverge. Diagnosis: edit chat does not patch code. Fix direction: detect spec/code divergence and offer update build.
159. **Multiple assistant messages contain Apply buttons.** Failure: user applies older code after newer fix. Diagnosis: stale actions remain active. Fix direction: mark older apply buttons superseded.
160. **User asks "why did you do that?" after edits.** Failure: no tool trace. Diagnosis: progress removed and no persistent audit log. Fix direction: per-response build log.

### N. Filesystem, Encoding, And Codebase Integrity

161. **Write creates CRLF/LF churn.** Failure: huge diffs. Diagnosis: complete-file writes normalize line endings. Fix direction: preserve existing newline style.
162. **Write changes file encoding.** Failure: invalid TypeScript or hidden null bytes. Diagnosis: encoding not validated. Fix direction: UTF-8 validation after write.
163. **Read-back comparison fails due to newline normalization.** Failure: false write error. Diagnosis: browser File API may normalize differently. Fix direction: compare normalized or byte-level intentionally.
164. **File path casing differs on macOS vs deploy Linux.** Failure: local works, deploy fails. Diagnosis: case-insensitive local FS. Fix direction: case-sensitive import validation.
165. **Model writes outside `src`.** Failure: modifies config unintentionally. Diagnosis: tools allow broad path. Fix direction: write allowlist with confirmation for config/scripts.
166. **Model overwrites user uncommitted changes.** Failure: user work lost. Diagnosis: no dirty diff awareness. Fix direction: local agent should detect dirty files and require merge/confirm.
167. **Model edits same file user has open and changes concurrently.** Failure: lost edits. Diagnosis: no file version check. Fix direction: write with base hash/version.
168. **Model deletes code by omission in full-file write.** Failure: typecheck may not catch behavior loss. Diagnosis: full replacement is risky. Fix direction: diff review threshold and semantic checks.
169. **Model creates duplicate helper functions.** Failure: code bloat/conflicts. Diagnosis: did not search enough or context clipped. Fix direction: search helper names before add.
170. **Model imports from barrel that does not export symbol.** Failure: typecheck catches. Diagnosis: digest trimmed or stale. Fix direction: auto-fix import paths using export digest.
171. **Model adds dependency but package manager not run.** Failure: build fails. Diagnosis: tool schema lacks dependency install. Fix direction: either prohibit new deps or add install workflow.
172. **Model edits lockfile manually.** Failure: corrupted dependency state. Diagnosis: write tool permits lockfiles. Fix direction: block lockfile manual edits.
173. **Model updates generated bundle docs instead of source.** Failure: change disappears. Diagnosis: bundled workspace docs confuse. Fix direction: mark generated files read-only.
174. **Model writes test file but test runner absent.** Failure: verification unclear. Diagnosis: no test script. Fix direction: prefer typecheck/build or add test infra deliberately.
175. **Model changes exported type shape without updating consumers.** Failure: wide type errors. Diagnosis: shared types blast radius. Fix direction: dependency graph or typecheck loop.
176. **Model edits CSS token names.** Failure: visual theme breaks. Diagnosis: CSS variables unchecked by TS. Fix direction: visual snapshot or token lint.
177. **Model creates enormous file.** Failure: app slows, provider context bloats. Diagnosis: no size guard. Fix direction: warn/block large generated files.
178. **Model writes secrets into source from user prompt.** Failure: secret leak. Diagnosis: prompt data copied into files. Fix direction: secret scanner before write.
179. **Model changes public API names.** Failure: hidden app references break. Diagnosis: no contract tests. Fix direction: avoid public renames unless asked.
180. **Model cannot recover after syntax error prevents app boot.** Failure: browser verification unavailable. Diagnosis: runtime broken by edit. Fix direction: typecheck/build first and rollback on boot failure.

### O. Algo Blueprint Semantics

181. **Blueprint lacks required fields for implementation.** Failure: build guesses. Diagnosis: no schema validation. Fix direction: required fields by strategy type.
182. **Knob units are ambiguous.** Failure: 10 means 10% vs 10 minutes. Diagnosis: knob model value has optional unit. Fix direction: require unit and range.
183. **Boolean kill switch stored as knob but UI expects number/string.** Failure: rendering or editing issue. Diagnosis: knob type allows boolean, UI may not. Fix direction: render per knob type.
184. **Entry rule conflicts with exit rule.** Failure: impossible strategy. Diagnosis: no validation. Fix direction: blueprint consistency checks.
185. **Universe says Nursery but implementation reads chart mint only.** Failure: wrong discovery source. Diagnosis: source mapping absent. Fix direction: blueprint source-to-engine contract.
186. **Risk rule says max 3 positions but engine lacks position counter.** Failure: overtrading. Diagnosis: prose risk not enforced. Fix direction: compile risk controls into runtime config.
187. **Training data references sessions that were deleted.** Failure: broken performance review. Diagnosis: no referential integrity. Fix direction: preserve tombstones or clean references.
188. **Blueprint status set to live-ready without live checks.** Failure: unsafe readiness. Diagnosis: manual/status updates unguarded. Fix direction: computed status gates.
189. **User duplicates built-in scalper but expects independent knobs.** Failure: edits built-in override. Diagnosis: clone vs reference unclear. Fix direction: explicit "clone as new preset".
190. **LLM updates description but not structured rules.** Failure: UI displays old rules. Diagnosis: description and blueprint fields diverge. Fix direction: parse/update structured fields together.
191. **Two presets share same display name.** Failure: dropdown confusion. Diagnosis: no uniqueness. Fix direction: require unique names or suffix.
192. **Preset name contains special chars.** Failure: parser/UI issues. Diagnosis: name sanitization incomplete. Fix direction: sanitize display vs ids separately.
193. **Blueprint source files list stale after refactor.** Failure: future LLM opens wrong files. Diagnosis: no update on file changes. Fix direction: validate sourceFiles existence.
194. **Runnable false but sourceFiles non-empty.** Failure: user thinks partial code is ready. Diagnosis: status granularity too coarse. Fix direction: "implemented but not verified" state.
195. **Runnable true but no Trading engine registered.** Failure: Start fails. Diagnosis: runnable flag not tied to registry. Fix direction: compute runnable from actual strategy registry.
196. **Blueprint copied from chat includes financial promises.** Failure: compliance/trust issue. Diagnosis: no content guard. Fix direction: strip performance promises.
197. **LLM creates preset from casual idea too early.** Failure: cluttered Algo Lab. Diagnosis: algo block emitted prematurely. Fix direction: require user confirmation before one-click registration.
198. **LLM asks too many blueprint questions.** Failure: user abandons. Diagnosis: over-clarification. Fix direction: progressive defaults and editable fields.
199. **LLM asks too few questions.** Failure: implementation lacks key rules. Diagnosis: under-specified build. Fix direction: minimum strategy spec checklist.
200. **Blueprint not tied to chat transcript.** Failure: future audit cannot see why decisions were made. Diagnosis: no origin metadata. Fix direction: store source chat/message ids.

### P. Nursery, Discovery, And Market Data

201. **Nursery scanner stale but strategy uses it.** Failure: zombie watchlist outdated. Diagnosis: no freshness timestamp gate. Fix direction: require fresh scanner data before entries.
202. **PumpPortal stream open but missing token events.** Failure: strategy misses revivals. Diagnosis: WebSocket subscription scope incomplete. Fix direction: explicit subscription health metrics.
203. **Token silence calculated from local app start, not market history.** Failure: false zombies. Diagnosis: no historical trade data. Fix direction: define data source for last trade time.
204. **Token age filter uses creation time unavailable.** Failure: filter ignored. Diagnosis: data field absent. Fix direction: source creation timestamp or hide knob.
205. **Bonding curve completion status stale.** Failure: trades completed/risky coins. Diagnosis: no refresh. Fix direction: revalidate before entry.
206. **Market cap floor uses wrong currency/scale.** Failure: filters too strict/loose. Diagnosis: MC formatting vs raw values. Fix direction: normalized numeric data model.
207. **Low-liquidity token passes filters due to missing liquidity field.** Failure: bad entries. Diagnosis: absent data treated as pass. Fix direction: missing critical data should fail closed.
208. **Duplicate token events flood watchlist.** Failure: UI/performance degradation. Diagnosis: no dedupe/throttle. Fix direction: keyed watchlist with debounce.
209. **Clock skew affects silence threshold.** Failure: wrong dormant classification. Diagnosis: client time vs event time. Fix direction: use event timestamps/server time.
210. **WebSocket reconnect loses watchlist subscriptions.** Failure: engine appears running but blind. Diagnosis: reconnect handler incomplete. Fix direction: resubscribe and mark degraded until confirmed.
211. **Scanner ranks tokens but engine ignores rank.** Failure: trades low-quality candidates first. Diagnosis: ranking not part of entry logic. Fix direction: define priority queue.
212. **Revival min SOL uses gross trade amount but feed uses token amount.** Failure: trigger wrong. Diagnosis: unit mismatch. Fix direction: typed event schema.
213. **Sell events mistaken for revival buys.** Failure: enters on bearish action. Diagnosis: side field ignored. Fix direction: require side buy.
214. **Bot/self trades trigger revival.** Failure: manipulated entries. Diagnosis: no wallet/source filtering. Fix direction: optional wallet reputation/noise filters.
215. **Same token enters multiple positions.** Failure: duplicate exposure. Diagnosis: one-position-per-token not enforced. Fix direction: active position map.
216. **Watchlist grows unbounded.** Failure: memory/performance issue. Diagnosis: no eviction. Fix direction: max watchlist size and TTL.
217. **Very old dead coins dominate watchlist.** Failure: misses fresh opportunities. Diagnosis: max token age filter absent/buggy. Fix direction: enforce age window.
218. **Token metadata missing image/name.** Failure: UI broken rows. Diagnosis: assumes metadata. Fix direction: fallback mint display.
219. **Discovery feed and chart mint conflict.** Failure: user thinks chart token is watched. Diagnosis: UI lacks distinction. Fix direction: separate watchlist panel from chart.
220. **Historical scanner backfill triggers immediate buys.** Failure: enters on old events. Diagnosis: no "live after start" cutoff. Fix direction: ignore events before session start.

### Q. Trading Engine Safety

221. **Paper mode code path differs from real mode.** Failure: paper performance does not predict live behavior. Diagnosis: separate execution logic. Fix direction: shared signal engine with pluggable executor.
222. **Real mode sends buy without final safety confirmation.** Failure: accidental real trade. Diagnosis: mode persisted and start clicked. Fix direction: per-session real confirmation.
223. **Kill switch stops UI but not in-flight request.** Failure: trade still lands. Diagnosis: async send not cancellable. Fix direction: mark halted before request and block callbacks.
224. **Max concurrent positions enforced after buy.** Failure: one extra position. Diagnosis: race condition. Fix direction: reserve slot before send.
225. **Stop loss uses stale price.** Failure: exits late. Diagnosis: delayed feed. Fix direction: freshness gate before decisions.
226. **Take profit not accounting slippage/fees.** Failure: net loss despite gross TP. Diagnosis: PnL model simplistic. Fix direction: net PnL thresholds.
227. **Priority fee too low in live mode.** Failure: missed entries. Diagnosis: static config. Fix direction: configurable fee plus failure logging.
228. **Slippage too high by default.** Failure: bad fills. Diagnosis: unsafe defaults. Fix direction: conservative defaults and warnings.
229. **Partial fill not represented.** Failure: PnL/session inaccurate. Diagnosis: assumes full execution. Fix direction: execution fill model.
230. **Sell fails but position marked closed.** Failure: hidden exposure. Diagnosis: state update before confirmation. Fix direction: confirmed transaction state machine.
231. **Buy succeeds but app crashes before logging.** Failure: position lost. Diagnosis: no durable pending transaction log. Fix direction: persist execution intents before send.
232. **Wallet balance insufficient.** Failure: repeated failed sends. Diagnosis: no preflight balance check. Fix direction: check balance before live session.
233. **Trading halted from one strategy blocks all unintentionally.** Failure: unrelated sessions blocked. Diagnosis: global halt state. Fix direction: per-engine halt plus global emergency stop.
234. **Manual sell request races with auto sell.** Failure: duplicate sell. Diagnosis: no transaction lock. Fix direction: per-position action mutex.
235. **Engine keeps running after tab hidden/sleep.** Failure: delayed reactions on wake. Diagnosis: browser throttling. Fix direction: pause/degrade when hidden or stale.
236. **Network reconnect causes duplicate buy.** Failure: reprocessed event. Diagnosis: idempotency missing. Fix direction: event ids and processed set.
237. **Session stop leaves subscriptions active.** Failure: ghost events. Diagnosis: cleanup incomplete. Fix direction: teardown verification.
238. **Real trade error not tied to session record.** Failure: audit incomplete. Diagnosis: errors logged only live state. Fix direction: persist execution errors in session.
239. **Strategy starts without named session.** Failure: training data hard to use. Diagnosis: naming bypass. Fix direction: enforce name or auto-name with edit.
240. **Strategy can start with no data feed.** Failure: sits silently. Diagnosis: start checks missing. Fix direction: require feed health OK.

### R. Session Logging, Training Data, And Performance

241. **Session record schema is scalper-specific.** Failure: new strategy logs wrong fields. Diagnosis: `configSnapshot` fixed shape. Fix direction: generic strategy config schema.
242. **Order-book snapshots not captured at entry/exit.** Failure: LLM cannot review context. Diagnosis: session logs trades only. Fix direction: capture event window snapshots.
243. **Watchlist decisions not logged.** Failure: cannot analyze missed trades. Diagnosis: only executed trades matter. Fix direction: log candidates and rejected reasons.
244. **No negative examples.** Failure: training learns only entries. Diagnosis: skipped opportunities absent. Fix direction: log non-entry decisions.
245. **PnL computed differently in Trading vs Performance.** Failure: inconsistent metrics. Diagnosis: duplicate calculations. Fix direction: shared metrics library.
246. **Session continues after app reload as stopped.** Failure: split records. Diagnosis: active session not restored. Fix direction: persist active session state or mark interrupted.
247. **Performance filters by current preset name, not immutable id.** Failure: renamed presets hide old sessions. Diagnosis: name/id confusion. Fix direction: store id and display historical name.
248. **Deleted preset removes performance discoverability.** Failure: old sessions orphaned. Diagnosis: UI filters only active presets. Fix direction: include deleted/historical presets.
249. **Training notes overwritten by latest LLM review.** Failure: lost analysis. Diagnosis: single notes field. Fix direction: append-only review log.
250. **Large session logs exceed localStorage.** Failure: saving fails. Diagnosis: logs stored in browser storage. Fix direction: IndexedDB/file-backed session artifacts.
251. **Timestamps mix local and UTC.** Failure: confusing analysis. Diagnosis: formatting inconsistent. Fix direction: store UTC, display local.
252. **Trade rows missing mint after chart switch.** Failure: wrong attribution. Diagnosis: global chart mint used late. Fix direction: snapshot mint at event time.
253. **Entry/exit reasons too generic.** Failure: LLM cannot improve strategy. Diagnosis: reason enum lacks signal details. Fix direction: structured reason payload.
254. **Performance tab cannot compare sessions.** Failure: hard to evaluate changes. Diagnosis: single-session view. Fix direction: comparison mode.
255. **No benchmark/baseline.** Failure: user cannot tell if algo improved. Diagnosis: metrics lack reference. Fix direction: compare against hold/no-trade/built-in.
256. **Session export missing.** Failure: user cannot share/debug. Diagnosis: data trapped in app. Fix direction: export JSON.
257. **Session import missing.** Failure: cannot reproduce bug. Diagnosis: no import path. Fix direction: import replay mode.
258. **LLM review sees too much raw data.** Failure: token blowups. Diagnosis: no summarization layer. Fix direction: generate compact session summaries.
259. **LLM review sees too little data.** Failure: shallow advice. Diagnosis: over-trimmed context. Fix direction: retrieve targeted slices by question.
260. **Performance chart hides zero-trade sessions.** Failure: user misses non-running bug. Diagnosis: empty sessions filtered. Fix direction: show zero-trade sessions as important signal.

### S. UI Layout, Accessibility, And Interaction

261. **Small sidebar width truncates critical status.** Failure: user misses Not live/real mode. Diagnosis: compact layout. Fix direction: responsive wrapping and tooltips.
262. **Dropdown delete button is hard to click.** Failure: accidental selection or missed delete. Diagnosis: nested interactive element. Fix direction: larger hit target and confirmation for destructive action.
263. **Keyboard users cannot delete preset from dropdown.** Failure: accessibility block. Diagnosis: span role button custom behavior. Fix direction: real button with keyboard handlers.
264. **Screen reader does not announce mode changes.** Failure: inaccessible Build/Chat transition. Diagnosis: no aria-live. Fix direction: accessible status region.
265. **Color-only Live indicator.** Failure: colorblind users miss status. Diagnosis: dot plus text helps, but tooltip hidden. Fix direction: text includes exact state.
266. **Collapsed code fence hides important warnings.** Failure: user misses partial output. Diagnosis: collapse all fences equally. Fix direction: warnings outside fences.
267. **Chat input grows too tall with pasted prompt.** Failure: send button offscreen. Diagnosis: textarea layout. Fix direction: max height and scroll.
268. **Drag image overlay blocks composer.** Failure: stuck drag state. Diagnosis: dragleave unreliable. Fix direction: timeout/reset on drop/window leave.
269. **Followup pills overflow horizontally.** Failure: inaccessible options. Diagnosis: many/long followups. Fix direction: cap and wrap cleanly.
270. **Diff modal too small for full-file writes.** Failure: review impossible. Diagnosis: large diffs. Fix direction: file outline and changed hunks.
271. **Rollback button hidden when local agent down.** Failure: user cannot recover after agent crash. Diagnosis: rollback depends on agent. Fix direction: show disabled with reason and manual file list.
272. **Clear chat button too close to rollback.** Failure: accidental destructive action. Diagnosis: compact header. Fix direction: confirm clear or separate destructive controls.
273. **Algo Lab "Create new" form loses input when switching tabs.** Failure: user loses typed name. Diagnosis: component local state. Fix direction: persist draft or confirm.
274. **Performance empty state looks like bug.** Failure: user thinks sessions missing. Diagnosis: weak empty copy. Fix direction: explain required steps.
275. **Trading disabled state lacks reason.** Failure: user cannot start. Diagnosis: button disabled without message. Fix direction: inline reason.
276. **Live error toast disappears too fast.** Failure: user misses issue. Diagnosis: timeout notice. Fix direction: persistent error panel for trading/build blockers.
277. **Hover-only help unavailable on touch.** Failure: mobile/tablet users miss info. Diagnosis: tooltips hover-based. Fix direction: click/tap accessible help.
278. **Long preset names break dropdown layout.** Failure: UI shifts. Diagnosis: no truncation/tooltip in all places. Fix direction: consistent truncation.
279. **Table-like assistant responses render poorly.** Failure: hard to read on narrow chat. Diagnosis: markdown tables in chat. Fix direction: discourage tables, use concise bullets or canvas.
280. **Canvas not discoverable.** Failure: user does not open audit artifact. Diagnosis: canvas file separate. Fix direction: mention canvas purpose and path.

### T. Security, Privacy, And Compliance

281. **LLM receives wallet public key when not needed.** Failure: unnecessary data sharing. Diagnosis: live context includes wallet hints. Fix direction: minimize sensitive context by task.
282. **Private key accidentally pasted into chat.** Failure: model/provider receives secret. Diagnosis: no secret detection before send. Fix direction: client-side secret scanner.
283. **API key included in tool result/error.** Failure: secret leaks into chat. Diagnosis: raw errors. Fix direction: redact known secret patterns.
284. **Session export includes wallet identifiers.** Failure: privacy leak. Diagnosis: export all fields. Fix direction: redacted export mode.
285. **LLM suggests unsafe financial claims.** Failure: compliance/trust risk. Diagnosis: prompt may not fully constrain. Fix direction: response filter for performance promises.
286. **Real trading enabled in hosted public deployment.** Failure: unsafe environment. Diagnosis: no deployment mode guard. Fix direction: require local trusted mode for real trading.
287. **Prompt injection from token metadata.** Failure: malicious token name influences LLM. Diagnosis: live context includes untrusted strings. Fix direction: quote/sanitize untrusted market data.
288. **Prompt injection from repo files.** Failure: malicious file tells LLM to ignore rules. Diagnosis: file content included in prompt. Fix direction: mark file content untrusted.
289. **Prompt injection from chat history.** Failure: previous assistant/user text overrides system. Diagnosis: model susceptibility. Fix direction: system hierarchy reminders and guardrails.
290. **LLM writes code that logs secrets.** Failure: secret exposure in console. Diagnosis: no code scan. Fix direction: secret/logging lint.
291. **LLM adds network call to unknown endpoint.** Failure: data exfiltration. Diagnosis: code generation unconstrained. Fix direction: network endpoint allowlist review.
292. **LLM adds dependency with malicious package.** Failure: supply-chain risk. Diagnosis: dependency additions unchecked. Fix direction: dependency approval flow.
293. **Trading session data sent to provider without consent.** Failure: privacy concern. Diagnosis: live/session context auto-injected. Fix direction: privacy mode/context toggles.
294. **User asks for guaranteed profit bot.** Failure: assistant complies too strongly. Diagnosis: trading domain risk. Fix direction: refuse guarantees, keep to tooling/simulation.
295. **User asks to bypass platform limits.** Failure: harmful guidance. Diagnosis: missing policy handling. Fix direction: refuse abuse, suggest compliant rate limits.
296. **LLM creates real-trading defaults too aggressive.** Failure: financial risk. Diagnosis: no safety default policy. Fix direction: enforce paper-first and conservative caps.
297. **Audit logs contain sensitive user prompts.** Failure: logs leak data. Diagnosis: local logs may persist. Fix direction: redact/export controls.
298. **Browser extension reads localStorage API keys.** Failure: client storage risk. Diagnosis: web app constraints. Fix direction: recommend local proxy/server-side secrets.
299. **GitHub PAT scopes too broad.** Failure: repo/account risk. Diagnosis: setup may not guide least privilege. Fix direction: precise scope checklist.
300. **LLM changes license/compliance text accidentally.** Failure: legal risk. Diagnosis: broad file writes. Fix direction: protect legal/license files unless explicitly requested.

### U. Build, Deploy, And Environment Drift

301. **Typecheck passes but Vite build fails.** Failure: production broken. Diagnosis: build catches assets/env not typecheck. Fix direction: run build for multi-file UI changes.
302. **Vite HMR shows updated UI but production build tree-shakes differently.** Failure: deploy bug. Diagnosis: dev/prod mismatch. Fix direction: production build before deploy.
303. **Environment variable missing in deployment.** Failure: feature works locally only. Diagnosis: local `.env` not mirrored. Fix direction: environment readiness panel.
304. **Public asset path broken after build.** Failure: images/icons missing. Diagnosis: asset copy rules. Fix direction: asset verification.
305. **Vercel deployment succeeds but app calls provider directly and CORS fails.** Failure: hosted chat broken. Diagnosis: no backend proxy. Fix direction: deployment-specific LLM route.
306. **Node version mismatch.** Failure: install/build differs across machines. Diagnosis: no engines field or enforcement. Fix direction: document/enforce Node version.
307. **Package-lock out of sync.** Failure: CI install fails. Diagnosis: dependencies changed improperly. Fix direction: lockfile validation.
308. **Build script copies missing public files.** Failure: build fails late. Diagnosis: `cp public/aurapoints/*` assumes files. Fix direction: guard or verify assets.
309. **Local agent only exists in dev plugin.** Failure: production users cannot build. Diagnosis: architecture mismatch. Fix direction: make Build a local-dev-only feature or add backend.
310. **Service worker/cache serves stale app.** Failure: user sees old chat behavior. Diagnosis: browser cache. Fix direction: cache-busting/version indicator.
311. **Source maps expose code unexpectedly.** Failure: IP/security concern. Diagnosis: deploy config. Fix direction: decide sourcemap policy.
312. **CI lacks browser verification.** Failure: UI regressions slip. Diagnosis: only TS build. Fix direction: add Playwright/smoke tests.
313. **Lint absent or not run.** Failure: style/unused bugs accumulate. Diagnosis: package scripts only typecheck/build. Fix direction: add lint script if desired.
314. **Tests require live APIs.** Failure: flaky CI. Diagnosis: no mocks. Fix direction: mock PumpPortal/provider calls.
315. **Build fixes generated docs but not source docs.** Failure: docs drift. Diagnosis: bundle step. Fix direction: define source-of-truth docs.
316. **Changing prompt requires rebuilding bundled workspace.** Failure: app serves stale prompt docs. Diagnosis: prebuild scripts. Fix direction: verify bundle generated.
317. **Dev server restart loses local agent state.** Failure: rollback/edit history lost. Diagnosis: in-memory agent history. Fix direction: persist edit transactions.
318. **Hot reload interrupts active trading session.** Failure: session state resets. Diagnosis: React dev behavior. Fix direction: warn not to live trade during dev HMR.
319. **Build output too large.** Failure: slow load. Diagnosis: added heavy code/deps. Fix direction: bundle size check.
320. **Deploy from wrong branch.** Failure: user tests local fix but hosted app old. Diagnosis: branch mismatch. Fix direction: show git branch/deploy branch.

### V. Collaboration, Versioning, And Git Workflows

321. **Two users edit same repo through chat.** Failure: conflicts. Diagnosis: no collaboration locking. Fix direction: branch/session ownership.
322. **User asks chat to commit but local git dirty.** Failure: unrelated changes included. Diagnosis: no git diff awareness in app. Fix direction: commit workflow with file selection.
323. **Build writes files but user forgets to commit.** Failure: changes lost. Diagnosis: local-only edits. Fix direction: "uncommitted changes" indicator.
324. **GitHub push fails after local edits.** Failure: user thinks build complete. Diagnosis: auth/branch mismatch. Fix direction: push status with actionable errors.
325. **Merge conflict in generated file.** Failure: app cannot resolve. Diagnosis: no conflict UI. Fix direction: surface conflict and stop.
326. **Assistant edits AGENTS/instructions unexpectedly.** Failure: future agent behavior changes. Diagnosis: broad code task. Fix direction: protect meta-instruction files.
327. **User switches branch after opening app.** Failure: local agent file writes go to new branch while chat context old. Diagnosis: branch not tracked. Fix direction: branch-change event.
328. **Reverting code through git bypasses chat rollback history.** Failure: rollback ids stale. Diagnosis: external changes. Fix direction: invalidate edit history on file hash mismatch.
329. **Commit hooks modify files after chat write.** Failure: chat's read-back differs from committed result. Diagnosis: formatters/hooks. Fix direction: rerun read/typecheck after hooks.
330. **Generated audit docs committed accidentally.** Failure: repo clutter if not wanted. Diagnosis: docs are useful but maybe temporary. Fix direction: decide audit docs as tracked backlog.
331. **User wants PR split but changes are tangled.** Failure: review burden. Diagnosis: chat build edits too broad. Fix direction: feature branches or worktree strategy.
332. **Chat response references old commit SHA.** Failure: debugging mismatch. Diagnosis: no git state in prompt. Fix direction: include branch/commit in build context.
333. **Local file changed by formatter while model editing.** Failure: write conflict. Diagnosis: watcher/formatter. Fix direction: file version checks.
334. **User closes app before push completes.** Failure: local changes not remote. Diagnosis: async push. Fix direction: persistent push progress.
335. **GitHub token expires mid-push.** Failure: partial remote updates. Diagnosis: auth expiry. Fix direction: retry/auth refresh and no partial multi-file commits if possible.
336. **Remote branch protected.** Failure: push rejected. Diagnosis: branch rules. Fix direction: create feature branch.
337. **Large session artifacts accidentally committed.** Failure: repo bloat/privacy. Diagnosis: generated logs in repo. Fix direction: `.gitignore` and export location policy.
338. **User expects chat rollback to revert git commit.** Failure: only local edit rollback. Diagnosis: rollback scope unclear. Fix direction: label rollback type.
339. **Assistant changes files outside requested area.** Failure: trust issue. Diagnosis: broad task interpretation. Fix direction: final diff summary and scoped approval for large changes.
340. **No changelog of AI edits.** Failure: hard to audit. Diagnosis: edit history technical only. Fix direction: human-readable AI change log.

### W. Observability, Diagnostics, And Supportability

341. **No way to export debug bundle.** Failure: hard to support user issues. Diagnosis: state scattered. Fix direction: export redacted diagnostics.
342. **Console errors not shown unless agent asks.** Failure: user sees broken app but chat unaware. Diagnosis: passive error collection. Fix direction: surface current console error count.
343. **Network failures hidden.** Failure: data feed/model errors look like strategy bugs. Diagnosis: no network panel. Fix direction: feed/provider health cards.
344. **Tool call logs only in browser console.** Failure: user cannot report. Diagnosis: logs not in UI. Fix direction: copyable build log.
345. **Provider request size only console.info.** Failure: users cannot understand 429. Diagnosis: hidden diagnostics. Fix direction: show context size on errors.
346. **No trace id per build.** Failure: hard to connect logs. Diagnosis: no request/build id. Fix direction: generate task id.
347. **No timing breakdown.** Failure: cannot optimize slow builds. Diagnosis: no metrics. Fix direction: record provider/tool timings.
348. **No count of retries.** Failure: user thinks app hung. Diagnosis: retry status may be overwritten. Fix direction: persistent retry history.
349. **DOM verification failure lacks screenshot.** Failure: hard to debug UI mismatch. Diagnosis: text snapshot only. Fix direction: optional screenshot capture.
350. **Typecheck output too large for model.** Failure: key errors clipped. Diagnosis: raw output. Fix direction: parse diagnostics into structured top errors.
351. **No "known issue" surfacing.** Failure: repeated bug reports. Diagnosis: audit doc not connected to app. Fix direction: internal known-issues panel or developer docs.
352. **User cannot tell if bug is model, app, provider, or data feed.** Failure: frustration. Diagnosis: errors blur layers. Fix direction: layer-tagged errors.
353. **No health endpoint details.** Failure: Live pill cannot explain. Diagnosis: `/__agent/status` returns only OK. Fix direction: status payload with tool capabilities.
354. **No version visible.** Failure: user reports old bug after fix. Diagnosis: app version hidden. Fix direction: build/version display.
355. **No storage usage metrics.** Failure: localStorage quota surprises. Diagnosis: storage invisible. Fix direction: storage health diagnostic.
356. **No WebSocket reconnect count.** Failure: feed instability invisible. Diagnosis: simple open/closed only. Fix direction: reconnect/error counters.
357. **No last successful model call timestamp.** Failure: provider status ambiguous. Diagnosis: no model health. Fix direction: model health metadata.
358. **No edit transaction viewer.** Failure: rollback anxiety. Diagnosis: only latest rollback. Fix direction: edit history UI.
359. **No scenario regression checklist in app.** Failure: fixes regress. Diagnosis: audit doc manual. Fix direction: convert top scenarios into tests.
360. **No "report this issue" payload.** Failure: user describes vaguely. Diagnosis: diagnostics not packaged. Fix direction: copy redacted issue report.

### X. Automated Testing And Regression Gaps

361. **No test for Chat vs Build auto-detection.** Failure: "build it" regresses. Diagnosis: regex untested. Fix direction: unit tests for intent classifier.
362. **No test for non-Anthropic Build capability.** Failure: UI implies unsupported build. Diagnosis: provider capabilities untested. Fix direction: capability matrix tests.
363. **No test for Algo Lab draft creation.** Failure: chat-created algo reselects Trading again. Diagnosis: prior bug unguarded. Fix direction: integration test.
364. **No test for editing old message after writes.** Failure: stale code/history mismatch. Diagnosis: complex flow untested. Fix direction: e2e test.
365. **No test for rollback targeted to response.** Failure: future targeted rollback bug. Diagnosis: not implemented. Fix direction: transaction tests.
366. **No test for workspace permission expired.** Failure: silent read failures. Diagnosis: browser API hard to mock. Fix direction: mock workspace adapter.
367. **No test for model error normalization.** Failure: confusing 429/529 returns. Diagnosis: response handling untested. Fix direction: provider error fixture tests.
368. **No test for config patch parser.** Failure: malformed knob updates. Diagnosis: parser edge cases. Fix direction: parser unit tests.
369. **No test for algo block parser.** Failure: Add to Algo Lab button disappears. Diagnosis: parser edge cases. Fix direction: parser unit tests.
370. **No test for hidden followup stripping.** Failure: comments pollute history. Diagnosis: not asserted. Fix direction: history builder tests.
371. **No e2e for session naming flow.** Failure: modal/inline regressions. Diagnosis: UI state untested. Fix direction: Playwright scenario.
372. **No e2e for Performance filtering.** Failure: sessions appear under wrong preset. Diagnosis: data UI untested. Fix direction: seeded session tests.
373. **No e2e for non-runnable preset Start disabled.** Failure: draft starts trading. Diagnosis: lifecycle untested. Fix direction: UI guard test.
374. **No test for file encoding after write.** Failure: null-byte regression. Diagnosis: byte validation absent. Fix direction: write adapter tests.
375. **No test for large tool output clipping.** Failure: diagnostics lost. Diagnosis: clipper generic. Fix direction: diagnostic parser tests.
376. **No test for local agent unavailable fallback.** Failure: loops on unsupported tools. Diagnosis: capability filtering absent. Fix direction: fallback tests.
377. **No test for provider timeout UI.** Failure: stuck pending state. Diagnosis: async edge. Fix direction: fake timer tests.
378. **No test for stop generation.** Failure: pending/composer busy stuck. Diagnosis: abort path. Fix direction: abort tests.
379. **No test for duplicate Add Algo clicks.** Failure: duplicate presets. Diagnosis: no dedupe. Fix direction: action idempotency tests.
380. **No test for storage migration.** Failure: old users break. Diagnosis: migrations implicit. Fix direction: localStorage fixture tests.

### Y. Performance And Scalability

381. **Large chat sessions slow render.** Failure: chat panel janks. Diagnosis: all turns rendered. Fix direction: virtualize chat feed.
382. **Many saved sessions slow Performance tab.** Failure: filters lag. Diagnosis: in-memory arrays/localStorage. Fix direction: IndexedDB and pagination.
383. **Large order-book snapshots bloat storage.** Failure: quota/performance issues. Diagnosis: raw snapshots stored. Fix direction: compression/sampling.
384. **Exports digest rebuild too often.** Failure: send delay. Diagnosis: short TTL and large repo. Fix direction: invalidate by file changes.
385. **Tool loop sends full agent history every round.** Failure: escalating token cost. Diagnosis: Anthropic requires context, but can summarize. Fix direction: compress tool history.
386. **Full-file writes for tiny edits are expensive.** Failure: token/time overhead. Diagnosis: tool only supports complete file. Fix direction: patch tool with safety.
387. **React context updates rerender entire app.** Failure: UI lag during trading/chat. Diagnosis: huge AppContext. Fix direction: split contexts/selectors.
388. **Live context includes too many sessions.** Failure: prompt grows. Diagnosis: raw recent trades. Fix direction: adaptive retrieval.
389. **Canvas/audit docs grow repo.** Failure: not runtime, but docs clutter. Diagnosis: many generated artifacts. Fix direction: archive policy.
390. **DOM snapshot huge.** Failure: model context bloat. Diagnosis: full app text. Fix direction: scoped DOM snapshots.
391. **Frequent agent status polling.** Failure: small but constant network noise. Diagnosis: 10s interval. Fix direction: backoff when stable.
392. **WebSocket tape high frequency overwhelms state.** Failure: dropped frames. Diagnosis: too many React updates. Fix direction: batch/throttle.
393. **Chart rendering competes with chat streaming.** Failure: input lag. Diagnosis: main-thread load. Fix direction: batching/worker where needed.
394. **Build output logs too large for UI.** Failure: chat becomes sluggish. Diagnosis: giant assistant message. Fix direction: external build log panel.
395. **Many Algo Lab presets slow dropdown.** Failure: interaction lag. Diagnosis: unvirtualized list. Fix direction: search/virtual dropdown.
396. **Many blueprints in live context.** Failure: prompt bloat. Diagnosis: includes first 8 full summaries. Fix direction: active/relevant blueprint only.
397. **Base64 images in chat history bloat requests.** Failure: provider errors. Diagnosis: image data retained in messages? Fix direction: do not persist base64 in normal history.
398. **Repeated failed retries cost time/tokens.** Failure: bad UX. Diagnosis: fixed retry strategy. Fix direction: classify retryable vs non-retryable.
399. **Typecheck on every small edit slows builds.** Failure: user waits. Diagnosis: verification cost. Fix direction: incremental checks for low-risk edits, full checks for final.
400. **App grows beyond single-page maintainability.** Failure: every change has hidden side effects. Diagnosis: large shared state and UI coupling. Fix direction: modularize chat/build/algo runtime boundaries.

## Expanded Fix Themes

6. **First-run readiness:** guide users through model, workspace, IDE agent, and market-data readiness separately.
7. **Provider capability registry:** every model/provider should expose whether it supports chat, images, tools, streaming, and build verification.
8. **Strategy lifecycle gates:** draft, implemented, verified, paper-ready, and live-ready should be computed from real checks, not only set by the LLM.
9. **Session artifact schema:** trading/training records need strategy-agnostic configs, decision logs, snapshots, errors, and replay/export support.
10. **Security guardrails:** redact secrets before send/write/log, treat market/file content as untrusted, and gate real-money operations.
11. **Observability layer:** add task IDs, build logs, provider/tool timings, diagnostics export, and clearer health endpoints.
12. **Regression suite:** convert the highest-risk scenarios into unit/e2e tests for mode detection, parser actions, draft lifecycle, rollback, and provider errors.
