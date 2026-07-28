# Operator-reported bugs / UX rework — 2026-07-28

Reported by Connor mid-session. **Not yet triaged, not yet fixed.** Recorded
here so it survives a context loss; owns no goal yet.

## B1 — distance widening doesn't fetch wider (bug)

Walkable → "Worth a cab" → "Anywhere" is meant to progressively widen the
search radius and surface bars **farther away**. Observed: stepping out to
**Anywhere does not load new bars on its own** — you have to hit **Run again**
before anything changes.

Operator's read: widening the distance should pull in genuinely new, farther
venues. A blend of already-shown and newly-reached bars is acceptable; the
silent no-op is not.

**Answered by Connor (2026-07-28): it must RE-RUN the pick against a wider
radius**, not re-filter the set already in hand. So widening is a fresh
selection over a larger candidate pool, and genuinely new venues are expected
to appear. The fix therefore belongs in the pick/query path, not in a display
filter.

## B2 — move the vibe-tweak entry to where "Run anywhere" sits (UX)

Keep the **banner pinned at the top**. The slot currently occupied by
**Run anywhere** is where the **vibe tweak** entry point should live.

## B3 — neighborhood becomes a vibe-tweak option (UX)

**Neighborhood** should be selectable *inside* vibe tweak rather than living
as its own separate control.

## B4 — "Run again" moves inside vibe tweak (UX)

**Run again** becomes an action *within* vibe tweak, offered **after** the user
finishes adjusting their settings — so the re-run is the natural close of the
tweak flow instead of a separate button competing with it.

---

B2–B4 are one coherent re-layout of the where-next controls and should be
designed together, not landed piecemeal. B1 is a functional bug and can be
fixed independently — do that first.

Per `CLAUDE.md`, whatever lands here needs e2e coverage on both viewports,
including the negative assertion that widening distance does **not** silently
leave the result set unchanged.
