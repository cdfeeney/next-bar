# DESIGN SYSTEM — the drunk-UX rules (E0.4)

Premise: **the user is drunk.** It's 12:40am, they're on a sidewalk in
Hell's Kitchen, phone at 15% brightness, one thumb. Every rule below is
written as a CHECKABLE ASSERTION — a reviewer (human or agent) should be
able to answer pass/fail per screen, and e2e tests should encode the
mechanical ones.

## The rules

**R1 — One decision per screen.** A screen asks at most ONE question.
If a screen presents two independent choices, split it or demote one to
the results surface. *Check: count the distinct questions a first-time
viewer must answer before the primary action makes sense. Must be ≤1.*

**R2 — Exactly one primary CTA.** One visually dominant action per
screen (accent-filled). Everything else is secondary (text/outline).
*Check: count accent-filled buttons visible without scrolling. Must
be exactly 1 (0 only on pure-display screens).*

**R3 — Verb-first labels.** Buttons say what happens: "Let's go",
"I'm in", "Suggest a bar" — never "Confirm", "Submit", "OK", "Proceed".
*Check: every button label starts with a verb or is a named object the
user chose (a bar name). Grep-able: Confirm|Submit|OK|Proceed|Continue
must not appear in button text.*

**R4 — Touch targets ≥56px** on primary-path controls (44px legal
minimum stays for secondary/inline links). *Check: computed min-height
of primary CTAs ≥56px; e2e a11y-mobile already enforces ≥44 globally.*

**R5 — No dead ends.** Every screen has a forward path AND a way out
that doesn't lose state. Error states name the next action ("try again
in a moment", never bare failure). *Check: every terminal branch of a
flow renders at least one actionable element; every notice string
contains an instruction.*

**R6 — No narration of plumbing.** Don't ask the user to confirm what
sensors already said (the confirmGps deletion, E2.1). Resolve silently;
fall back silently; only surface choices a human actually owns.
*Check: no screen whose only purpose is confirming machine state.*

**R7 — Photo-first social register.** Cards lead with full-bleed
imagery; text overlays, chip rows, avatar stacks. The feed reference is
Instagram/Partiful, not Yelp. *Check: any card representing a bar or a
night renders its photo when one exists; text-only cards are the
fallback, not the default.*

**R8 — Chips over dropdowns, taps over typing.** On the night path,
every input is tappable; free-text is allowed only off the critical
path (search seed lives on the vibe surface, E2). *Check: the
locating→results flow is completable with zero keyboard events (e2e
assertable).*

**R9 — Glyphs for price, words for vibe.** Price renders exclusively as
$–$$$$ (tagDisplay ladder). Vibe tags render as human words from
tagDisplay — never raw enum strings. *Check: the enforcement test
(E0.1) greps components for raw tag rendering; "pricey" appears nowhere
in rendered output.*

**R10 — Wrong-phase recovery in one tap.** The home phase chip always
shows the current phase and switches it in ONE tap — misdetection must
never strand the user (fail-safe default: `starting`). *Check: e2e —
from every phase, tapping the chip reaches every other phase in ≤2
taps.*

**R11 — Night-scoped memory, morning-scoped forgetting.** Choices made
mid-night (vibe pick, exclusions) persist for THAT night via nightKey
and silently reset at rollover. Nothing asks twice in one night;
nothing leaks into the next. *Check: unit tests on nightKey consumers;
e2e same-night re-search skips the question.*

**R12 — Latency honesty.** Anything slower than ~400ms shows motion
(the rise animation, a skeleton) — never a frozen screen; and busy
state is held through the refetch (the #14 review rule) so double-taps
can't invert intent. *Check: writes disable their control until the
post-write refetch lands.*

## Applying the rules

- New user-facing PR = a pass/fail table over R1–R12 in the PR body
  for each touched screen (agents can generate it).
- The e2e-encodable rules (R3, R4, R8, R9, R10, R11) get assertions as
  their surfaces are built — the drunk-UX pass in the goal's
  verification step is this table, mechanized.
- Existing screens are NOT retrofitted wholesale; each E2/E3/E4 PR
  brings its touched screens into compliance (deletion-first).
