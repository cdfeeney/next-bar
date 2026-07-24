// Unattended-loop hard gate (DeepSeek security review 2026-07-24).
//
// The overnight agent loop runs with LOOP_UNATTENDED=1 in its environment.
// Any script that spends money (Google Places API) or writes the live
// database with the service-role key must refuse to run under that flag —
// a TECHNICAL gate, not just a procedural rule in the nightlog, because the
// operator (and the dual-reviewer) are asleep. The loop can still author
// migration SQL and code; applying it is an attended morning step.
export function refuseIfUnattended(what) {
  if (process.env.LOOP_UNATTENDED === '1') {
    console.error(
      `[loop-guard] ${what} is forbidden during the unattended loop ` +
        `(LOOP_UNATTENDED=1). Run it attended. Aborting.`,
    );
    process.exit(1);
  }
}
