# JARVIS — GPT-6 Luna Repair, Voice Fix & Sidebar Redesign Brief

## The actual goal

Improve the **existing JARVIS project**. Do not turn this into a new feature-building project.

GPT-6 Luna is the development model. **JARVIS remains JARVIS**: preserve its current runtime model configuration, local-first behavior, voice choices, saved data, useful tools, approval safeguards and existing OpenClaw/Tailscale bridge. Do not replace the runtime AI with the coding model.

The priorities, in order, are:

1. **Review the entire current codebase and fix verified bugs and broken behavior.**
2. **Find and fix voice problems end to end** (microphone, speech recognition, wake word, speech synthesis, fallback behavior and UI state).
3. **Redesign the sidebar/navigation so it is substantially clearer and more polished**, while keeping the exact existing color scheme and overall JARVIS/LCARS visual identity.
4. Test the complete application, fix regressions, and report any tests that need real hardware/manual verification.

Do not add a large new feature roadmap, unnecessary integrations, a plugin marketplace, new agents, or architecture complexity. This is a cleanup, repair and focused UI redesign.

## Required working behavior

Do the work, not just provide advice. Audit first, then implement and verify fixes in small, coherent stages without stopping after the audit to ask for permission for every ordinary safe code change.

- Start by inspecting \`git status --short --branch\`, the current branch, recent commits, repository structure, dependencies, README/setup instructions, UI/backend entry points, existing tests and all voice paths.
- Preserve existing uncommitted work. Never reset, clean, overwrite, or discard user edits.
- Stay on the intended feature branch. Do not modify \`main\`, merge, deploy, or perform unapproved remote Git operations.
- Never run setup scripts against a real OpenClaw server or change live server configuration. Use mocked tests for integrations.
- Never ask for, reveal, invent, or commit passwords/API keys. No real account access is required for this task.
- Use the smallest maintainable fix; don't rewrite modules that already work.
- Avoid adding dependencies unless the current code cannot reasonably solve a verified problem. Explain and justify any new dependency.
- Do not change JARVIS's intended runtime model, reference voice, bundled voice assets, model provider defaults, data directory or save formats merely to simplify implementation.
- Do not pretend a control or feature works because a UI exists. Follow each important path through UI, JavaScript, backend route, business logic, state/storage and tests.
- Fix real defects you find rather than silently ignoring them. Do not manufacture issues merely to justify changes.

## Priority A — fix and verify voice end to end

Inspect the full voice implementation, including the existing files and any relevant launch scripts/configuration:

- \`static/app.js\` and the HTML/CSS for mic, wake-word, playback, stop and status controls.
- \`voice.py\` for local STT, microphone/wake-word capture, errors, audio format/size constraints and microphone lifecycle.
- \`jarvis_tts.py\` for local Piper synthesis, WAV validation, Qwen service detection and fallback behavior.
- \`qwen_tts_service.py\` and Qwen launcher/config where present.
- The existing \`/api/voice/*\` and \`/api/tts/synthesize\` routes in \`jarvis.py\`.
- Existing voice tests and optional dependency declarations/documentation.

Explicitly trace these user journeys:

1. User presses the microphone button, grants/denies permission, speaks, stops or finishes, receives a transcript and sends it once.
2. Local STT receives supported audio types, rejects empty/oversized/malformed audio cleanly, removes temporary audio after processing and returns useful errors.
3. Wake word can be enabled and disabled; status remains truthful; the mic is released when it should be; a detected wake triggers one command rather than duplicate messages; the system re-arms after success/failure when appropriate.
4. Text-to-speech plays valid audio, stops when requested, handles rapid successive messages and doesn't leave stale playback state behind.
5. Qwen TTS is used when configured and healthy; Piper fallback works when Qwen is unavailable or fails; missing voice dependencies result in a clear, recoverable explanation rather than breaking normal chat.
6. Browser speech synthesis fallback behaves properly where used, including unsupported browsers and voices that are not available yet.
7. Voice and wake-word controls show accurate states for listening, busy, speaking, muted, disabled, missing dependency, network/server failure and unexpected exit.
8. The user can stop or disable voice without leaving the microphone, audio stream, polling loop, playback object or wake-word thread stuck running.
9. Voice issues do not prevent ordinary text chat or stop the main JARVIS server.
10. Private audio is not retained unexpectedly, external transmission is not introduced, and logs do not include audio payloads or secrets.

Find and fix the actual cause of any defect; do not simply increase timeouts, suppress exceptions or add another fallback without understanding the failure. Use mocks/fakes for deterministic tests of hardware-dependent paths and add regression tests for each fix. Check for duplicate event listeners, race conditions, stale promises/state, unsupported audio MIME types, WAV decoding failures, missing model/sidecar handling, thread shutdown/join problems and fallback paths. Only change what the evidence calls for.

Preserve these constraints:
- Voice remains optional and normal JARVIS chat still works if voice packages are absent.
- Keep current local Piper/Qwen options, the current JARVIS voice assets and the existing runtime model setting.
- Do not make wake word silently default to on.
- Do not save recordings by default.
- Do not claim real microphone/GPU/audio playback testing occurred unless it actually did.

## Priority B — redesign the sidebar and navigation

Make the sidebar look and feel deliberately redesigned, not merely nudged by a few pixels. It should feel like a clean, premium JARVIS console: organized, readable, aligned, balanced, purposeful and easy to navigate. Keep the existing dark LCARS/Stark color scheme exactly.

### Colors and identity must be preserved

Keep the current color tokens and their existing values, including the dark/void backgrounds and the current orange, gold, coral, lilac, blue, cyan, green, ivory and muted colors. Do not replace them with another palette, turn the design into generic purple-glow AI UI, or remove the LCARS/Stark visual identity. Improve layout, spacing, hierarchy and how existing colors are applied, not the palette itself. Inspect all CSS files involved before making changes; avoid conflicting duplicate overrides.

### Design requirements

- Establish a clearer brand/header area and an obvious primary **New Chat** action if it already exists in the product.
- Give navigation a clear hierarchy: primary assistant/chat area, productivity areas, and system/settings utilities. Group existing destinations logically without hiding or deleting functionality.
- Preserve every existing destination/action and its working selectors, element IDs, JS event handlers and accessibility hooks unless intentionally refactored together and regression-tested. In particular, do not break Assistant, System Console, Desktop apps, Kitchen, Memory & archive, Coding agent, mobile menu, utility panels or any existing related actions.
- Use consistent icon sizing, text alignment, item heights, margins and section spacing.
- Make the active page easy to recognize without relying on color alone. Hover, focus, pressed, disabled and active states should be distinct and accessible.
- Reduce unnecessary visual noise: avoid overly tiny labels, overly long all-caps navigation text, excessive glowing borders, random decorative dividers, cramped footer content and repeated status ornaments.
- Make the brand, navigation, optional workspace context and footer/status area feel like a single coherent design.
- If a collapsible sidebar is appropriate, implement it fully: expanded/collapsed states, persisted preference only if safe and consistent with the app, tooltips/accessible names, keyboard operation and usable mobile behavior. Do not add collapse purely for decoration.
- On small screens, ensure the menu opens and closes correctly, the scrim behaves properly, navigation does not overlap chat, focus remains sensible and Escape closes it where appropriate.
- Keep keyboard navigation and visible focus rings; don't rely on hover only. Add appropriate aria-labels/expanded/current semantics when needed.
- Preserve the rest of the screen layout and color scheme. Change the sidebar and only the supporting pieces genuinely required to integrate it.
- Do not add new navigation items for features that do not exist.

Inspect \`static/index.html\`, \`static/lcars.css\`, \`static/style.css\`, \`static/utility-tweaks.css\`, \`static/stark-hud.css\`, and JavaScript navigation logic before editing. Use the primary existing design-system tokens rather than hard-coded one-off colors. Remove redundant CSS only when safe, and verify cascade/order at the actual sidebar selectors.

## Priority C — review the rest of the current code

Review the entire repository, not just the voice modules and sidebar. Look for verified bugs in:

- API routes, validation, JSON parsing and error responses.
- Conversation/session handling, tool calls and approval/denial/expiry behavior.
- File/workspace path boundaries, backups/undo and command execution.
- Memory, notes, recipes/kitchen data, chat history, routines, projects and activity persistence.
- Model discovery/configuration and provider errors.
- System metrics, app launching and browser/frontend event listeners.
- OpenClaw URL validation, token handling, delegation approval and failure reporting.
- Optional-dependency behavior, startup/shutdown and configuration validation.
- HTML/JavaScript/CSS integration, dead controls, mobile layout and accessibility.
- Setup documentation, dependency declarations, tests and CI workflow.

Do not invent extra features to fill the time. Fix real problems, add focused regression tests and improve documentation when it is currently inaccurate. Do not do a risky schema migration or change file formats unless required to fix a demonstrated defect; if one is necessary, back up/migrate safely and test rollback.

## Test and verify until the available checks are clean

Run the checks supported by the project, such as:

\`\`\`bash
python3 -m unittest discover -s tests -v
node --check static/app.js
node --check static/jarvis-orb.js
node --check static/advanced-tools.js
bash -n scripts/setup-openclaw-tailnet.sh
\`\`\`

Read the actual workflow for the full CI command set. Run relevant focused tests while iterating and the full suite at the end. Add/adjust tests to cover the fixes. Check Git diff for accidental changes to assets, colors, runtime defaults, secrets, generated files and user data.

If a local browser or runtime is available, test the sidebar at desktop and mobile sizes and exercise actual routes. For voice, do software tests first, then make a concise manual checklist for microphone, wake word, playback, interruption and fallback. Clearly mark anything that cannot be verified due to absent hardware/dependencies; never report it as passed. Do not use live server credentials to test OpenClaw.

## Acceptance criteria

The task is done only when all of the following are true or remaining manual items are explicitly disclosed:

- The entire codebase has been reviewed and a list of concrete fixes/findings is provided.
- Verified bugs are fixed with appropriate regression tests.
- Existing functionality, runtime model configuration, voice assets, saved-data formats, local-first behavior and OpenClaw branch behavior are preserved unless a specific defect requires a documented fix.
- Normal chat remains usable without optional voice packages.
- Every voice path has been traced and software-test coverage addresses success, missing dependencies, bad audio, errors and cleanup.
- The current color scheme is unchanged: no palette swap or new theme.
- The sidebar has a coherent, visibly improved design and responsive/keyboard accessibility without losing existing destinations or behavior.
- All supported automated tests and syntax checks pass; if anything fails, diagnose and fix it or clearly explain why it is blocked.
- No new feature placeholders, nonfunctional buttons, fake progress, silent external data transfer, credentials or unapproved server changes have been introduced.
- The git diff is focused and understandable, and the working tree/branch status is reported accurately.
- The README/setup notes are updated only where needed to match actual behavior.

## Final report required

Return a concise but specific report with:

1. **Findings:** important bugs/weaknesses discovered in voice, sidebar and the rest of the project.
2. **Changes:** exact files changed and what each change fixes.
3. **Sidebar:** summary of the new hierarchy/interaction and confirmation that the existing palette tokens were preserved.
4. **Tests:** exact commands, real pass/fail results and environment used.
5. **Manual verification:** what still requires the user's actual microphone, audio devices, GPU, browser or server.
6. **Remaining issues:** clearly list anything unfinished.
7. **Git status:** branch, changed files and latest commit. Do not claim pushed, merged or deployed unless that actually happened.

**Work order:** audit → repair existing defects → fix voice and test → redesign sidebar → review cross-project regressions → run full checks → inspect final diff → report. Make safe code changes directly; do not stop after suggesting them. Do not merge into \`main\`, deploy, or touch a live server.
