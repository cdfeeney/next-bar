Board audit records, one file per audit: `<date>-<VERDICT>.md`.

Written by `scripts/ceo-board-audit.mjs` with an exclusive create, so a second audit for the same
date refuses rather than overwrites. Do not edit or delete these — an audit you can revise after the
fact is not an audit, and the gap between two dates is itself a finding the next audit reports.
