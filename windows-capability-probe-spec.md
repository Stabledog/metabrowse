# Functional Spec: Windows Capability Probe App
**Target runtime:** Go + Fyne  
**Target OS:** Windows only  
**Purpose:** Empirically determine which technical capabilities are available in the **Petra** and **Delta** environments before building the full workspace app.

---

## 1. Overview

This program is a **capability probe harness**, not the final product.

It exists to answer, with evidence, questions like:

- Can a standalone EXE run successfully?
- Can it read/write local files?
- Can it write to **HKCU**?
- Can it write to **HKLM** when elevated?
- Can it launch Edge with flags?
- Can Edge load an unpacked extension in Developer Mode?
- Can an extension communicate with the EXE using **native messaging**?
- Can the EXE receive a dragged URL from Edge?
- Can the EXE open URLs through the Windows shell?
- Can the EXE bind to localhost and receive callbacks?

The app must produce a **machine-readable report** and a **human-readable summary** so that Petra and Delta runs can be compared.

---

## 2. Definitions

### Petra
A restrictive Windows environment.

Characteristics:
- Group Policy blocks many actions
- No admin privileges
- Some capabilities unknown or untested
- Example restriction: Explorer context menus may be disabled
- It is unknown whether some relevant registry operations are allowed

### Delta
A less restrictive Windows environment.

Characteristics:
- Admin rights available
- Some dangerous capabilities may still be forbidden by policy
- For this project, Delta is assumed to allow all relevant operations unless proven otherwise

---

## 3. Goals

### Primary goal
Create a single Windows EXE that tests and records the capabilities needed for the future workspace tool.

### Secondary goals
- Isolate failures by subsystem
- Make the same EXE usable in both Petra and Delta
- Minimize setup friction
- Produce evidence-rich output suitable for implementation planning

### Non-goals
- Not a production workspace manager
- Not a polished end-user application
- Not a cloud sync client
- Not a general-purpose system inventory tool

---

## 4. Technology choices

### Language
Go

### GUI toolkit
Fyne

### Packaging
Single-file EXE, no installer required

### Companion artifacts
The probe package may also include:

- a small **unpacked Edge extension** for Developer Mode tests
- a small **native host helper EXE** for native messaging round-trip tests
- optional JSON config and report files written beside or under the app's output folder

The probe app itself remains the primary executable.

---

## 5. High-level architecture

The system consists of:

1. **Main probe app**
   - Fyne GUI
   - orchestrates tests
   - writes logs and reports
   - launches subprocesses
   - hosts some tests directly

2. **Native host helper**
   - minimal EXE used only for native messaging tests
   - receives JSON on stdin
   - writes JSON to stdout
   - used to prove Edge extension ↔ native host round trip

3. **Edge test extension**
   - loaded unpacked in Developer Mode
   - performs extension-side tests
   - especially native messaging and browser-side event tests

---

## 6. UX requirements

### Main window layout
Three-pane layout:

#### Left pane: test catalog
A vertical list of probe groups:

- Environment
- Filesystem
- Registry
- Shell Launch
- Edge Launch
- Extension
- Native Messaging
- Drag and Drop
- Localhost
- Report

#### Center pane: selected group detail
Displays:
- group description
- prerequisites
- individual tests in the group
- run controls

Buttons:
- **Run Selected Test**
- **Run Group**
- **Run Full Suite**
- **Reset Results**

#### Right or bottom pane: logs and evidence
Tabbed view:
- Log
- Structured Result
- Raw Output
- Notes

### Status presentation
Each test must display one of:
- Not Run
- Running
- Pass
- Partial
- Fail
- Blocked
- Skipped

Use both color and text/icon so the meaning survives theme differences.

### Save/export controls
The app must provide:
- **Save JSON report**
- **Save Markdown summary**
- **Open output folder**
- **Copy selected result**

---

## 7. Runtime model

Each test is a discrete probe unit with:

- id
- display name
- category
- description
- prerequisites
- execution function
- timeout
- success criteria
- result status
- artifacts
- diagnostics

Each result records:

- run timestamp
- machine name
- Windows username
- process elevation status
- declared environment label: Petra / Delta / Custom
- exact operation attempted
- expected outcome
- actual outcome
- stdout/stderr
- error code/message where relevant
- final verdict
- caveats

---

## 8. Output requirements

### JSON report
The app must write a JSON file containing:
- machine metadata
- app version
- selected environment label
- all test results
- raw evidence
- final per-capability verdicts

### Markdown summary
The app must also write a Markdown file with:
- executive summary
- pass/fail matrix
- notable caveats
- recommendations for the full app design

### Log file
A plain text log file must be written during execution.

### Output location
Default:
- `%TEMP%\\WorkspaceProbe\\<timestamp>\\`

Optional:
- user may choose a custom output folder

---

## 9. Probe groups and test cases

## 9.1 Environment probe

### Purpose
Establish baseline context.

### Tests
1. **Identity probe**
   - machine name
   - user name
   - domain or workgroup if available

2. **Privilege probe**
   - determine whether process is elevated
   - determine whether user is in Administrators
   - record whether app appears constrained despite admin membership

3. **Temp write probe**
   - create temp directory
   - write file
   - read file
   - delete file

### Success criteria
- metadata collected successfully
- temp file lifecycle works

---

## 9.2 Filesystem probe

### Purpose
Determine file read/write capability in relevant locations.

### Tests
1. write/read/delete in `%TEMP%`
2. write/read/delete in user profile subfolder
3. write/read/delete in app-local subfolder
4. create nested directories
5. write and read small JSON file

### Success criteria
Each location is independently scored.

### Notes
Failure in one location must not prevent later filesystem tests.

---

## 9.3 Registry probe

### Purpose
Determine whether the app can perform the registry operations needed later.

### General rules
- All registry tests must use a dedicated probe namespace
- Tests must clean up after themselves where possible
- Cleanup failure must be logged separately from write failure

### HKCU tests
Use a path such as:
`HKCU\\Software\\WorkspaceProbe`

Tests:
1. create key
2. write string value
3. write DWORD value
4. read both values back
5. delete values
6. delete key

### HKLM tests
Run only if user chooses to attempt privileged tests.

Use a path such as:
`HKLM\\Software\\WorkspaceProbe`

Tests:
1. create key
2. write values
3. read values back
4. delete values/key

### Success criteria
- HKCU and HKLM judged independently
- report must distinguish:
  - blocked by privilege
  - blocked by policy
  - unknown/ambiguous
  - fully supported

---

## 9.4 Shell launch probe

### Purpose
Determine whether the EXE can open URLs via normal Windows mechanisms.

### Tests
1. open a test URL through the default shell launcher
2. open a local HTML file through the shell
3. optionally open Edge explicitly if installed path is known

### Success criteria
- app can request shell-based URL launch
- any resulting errors are logged

### Notes
This test only proves launch initiation, not successful page rendering.

---

## 9.5 Edge launch probe

### Purpose
Determine whether the app can start Edge in the ways needed later.

### Tests
1. detect Edge executable path
2. launch Edge normally
3. launch Edge with URL argument
4. launch Edge with command-line flags needed for experiments
5. launch Edge with a temporary user-data-dir
6. launch Edge with remote debugging flag
7. terminate or detach safely according to test mode

### Success criteria
Each launch mode independently recorded.

### Important outputs
For each launch:
- command line used
- process start success/failure
- process id if started
- any immediate stderr/stdout if available

---

## 9.6 Extension probe

### Purpose
Determine whether Edge Developer Mode and unpacked extension loading are viable.

### Preconditions
- user has access to `edge://extensions`
- user can manually enable Developer Mode if automation is not feasible

### Tests
1. verify test extension folder exists and is readable
2. instruct user to load unpacked extension
3. extension shows visible “ready” status page or popup
4. extension can send a basic success signal to the probe app using an agreed fallback mechanism

### Acceptance
Extension support is only considered confirmed if the user can load the unpacked extension and the extension proves it is active.

### Notes
This group may include user-assisted steps. The report must clearly mark them as manual.

---

## 9.7 Native messaging probe

### Purpose
Prove whether native messaging is fully supported, not merely partially understood.

### Critical requirement
A **full round-trip test is mandatory**.

Subtests are diagnostic, but native messaging is only considered supported if the end-to-end round trip passes.

### Diagnostic subtests
1. can write native host manifest file
2. can register host in HKCU
3. can confirm registry entry exists
4. can the helper EXE run standalone
5. can helper EXE parse one test JSON message via stdin/stdout outside Edge

### End-to-end round-trip test
Sequence:

1. probe app writes or verifies native host manifest
2. probe app writes or verifies HKCU native messaging registration
3. user loads unpacked Edge test extension
4. extension initiates connection to native host
5. extension sends message with:
   - message type
   - timestamp
   - random nonce
6. native host receives message and logs it
7. native host replies with:
   - same nonce
   - transformed payload
   - host metadata
8. extension validates nonce and response structure
9. extension sends second message over the same session
10. native host replies again
11. extension shows success state
12. probe app collects evidence from both sides

### Success criteria
Native messaging is **Pass** only if:
- host registration succeeded
- extension can connect
- first response is received and valid
- second response is received and valid
- nonce integrity is preserved

### Failure categories
- registry blocked
- manifest path blocked
- extension unavailable
- host launch blocked
- connect failed
- protocol/framing failed
- message returned malformed
- unknown

---

## 9.8 Drag and drop probe

### Purpose
Determine whether the app can receive dragged URLs from Edge.

### Tests
1. app displays visible drop target
2. user drags a URL from Edge into app
3. app logs whether a drop event fires
4. app logs the formats/data received
5. app extracts normalized URL if possible
6. app displays captured value

### Scenarios
Test separately if possible:
- drag from address bar
- drag from page link
- drag from tab strip, if meaningful
- drag from bookmark/favorites item, optional

### Success criteria
- drop event received
- at least one usable URL extraction path documented

### Output
Record raw dropped formats and parsed result.

---

## 9.9 Localhost probe

### Purpose
Determine whether local callback and loopback communication are possible.

### Tests
1. bind localhost TCP port
2. serve minimal HTTP endpoint
3. open browser to callback URL
4. receive GET request
5. optionally post structured JSON to localhost endpoint
6. stop server cleanly

### Success criteria
- local bind works
- browser can reach callback
- request captured successfully

### Notes
Useful for future fallback integration even if native messaging fails.

---

## 10. Manual vs automated tests

Some probes can be fully automated.
Some cannot, especially those involving Edge UI and Developer Mode.

Each test must be marked as one of:
- Automated
- Assisted
- Manual verification required

The report must preserve this distinction.

---

## 11. Safety and cleanup requirements

The probe app must:
- use only dedicated temp folders and registry keys
- avoid modifying unrelated system settings
- avoid requiring reboot
- clean up probe-created data where possible
- never silently leave privileged changes behind without logging them

If cleanup fails, the report must include:
- what was not cleaned up
- where it was left
- whether manual cleanup is needed

---

## 12. Error handling requirements

The app must never fail the whole suite because one probe fails.

Each probe failure must include:
- operation attempted
- API/process call used
- exact error string if available
- likely reason classification
- next recommended action

If a probe cannot run because a prerequisite failed, mark it **Blocked**, not **Fail**.

---

## 13. Comparison requirements

The output must make Petra vs Delta easy to compare.

### Required summary matrix
For each capability, produce one row:

- Capability
- Petra verdict
- Delta verdict
- Notes

Capabilities to summarize:
- Local file read/write
- HKCU write
- HKLM write
- Shell URL launch
- Edge launch
- Edge custom flags
- Edge unpacked extension load
- Native messaging round trip
- Drag/drop from Edge
- Localhost callback

The first version may generate one report per run; comparison can be manual.
A future enhancement may add side-by-side diffing.

---

## 14. Recommended implementation order

### Phase 1: core harness
- Fyne shell app
- test registry/file model
- logging
- save JSON + Markdown report

### Phase 2: local capability probes
- environment
- filesystem
- registry
- shell launch
- localhost

### Phase 3: Edge launch probes
- Edge detection
- process launch variants
- temporary profile launch

### Phase 4: extension-assisted probes
- unpacked extension loading
- extension ready-state check

### Phase 5: native messaging
- standalone native host test
- registry/manifest registration
- full round-trip validation

### Phase 6: drag/drop
- drop target
- evidence capture
- URL normalization

---

## 15. Deliverables

The probe project deliverables are:

1. **Main EXE**
   - Windows capability probe app

2. **Extension folder**
   - unpacked Edge test extension

3. **Native host helper EXE**
   - minimal message echo/transform host

4. **Sample output package**
   - JSON report
   - Markdown summary
   - raw log

5. **Operator notes**
   - how to run in Petra
   - how to run in Delta
   - manual steps for Edge extension tests

---

## 16. Acceptance criteria

The probe system is considered complete for v1 when it can:

- run as a single EXE on Windows
- execute and log all non-browser probes automatically
- guide the user through required Edge manual steps
- perform a full native messaging round trip when environment allows
- record drag/drop evidence from Edge when environment allows
- write JSON and Markdown results suitable for later planning

---

## 17. Key design principle

This tool must answer:
**“What is actually possible here?”**

It must not answer:
**“What we think policy probably allows.”**

Empirical results are the source of truth.
