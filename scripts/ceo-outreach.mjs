// Cold outreach to bar owners — the drafting half, which is the only half that exists.
//
// READ THIS BEFORE WIDENING ANYTHING HERE.
//
// The orchestrator does not send email. `CONTACT_EXTERNAL` remains on ceo-guard's never-granted
// list with an empty action set, exactly as it was; nothing in this file asks for it. Drafting an
// email is a DRAFT-capability action (`write_outreach_draft`) because that is honestly what it is —
// producing a file a human then reads and sends. The containment is structural: there is no
// transport in this repository, so "the agent sent it" is not a thing that can happen by mistake.
//
// That matters more than it sounds. The audience is ~265 NYC venues — finite, small, and shared
// with every future attempt. One batch of hallucinated recipients or invented traction claims does
// not cost a bounce rate; it costs the audience, permanently, and bar owners talk to each other.
//
// Four rails, all default-fail:
//   1. Recipients come only from a human-committed contact list. The agent SELECTS; it never adds.
//   2. Five per cycle, as a module constant — deliberately not readable from state, so no
//      agent-writable file can raise it.
//   3. Every draft carries the things bulk commercial email is legally required to carry, and the
//      opt-out has to appear in the body a human will actually read, not just in a metadata field.
//   4. Any number quoted at a stranger must be a metric that was actually measured, at the value
//      that was actually measured. "200 weekly users" while wau is null is the failure mode that
//      burns the audience AND is checkable, so it is checked.

const MAX_RECIPIENTS_PER_CYCLE = 5;

/** Subjects that lie about the history of the conversation. */
const DECEPTIVE_SUBJECT_PREFIX = /^\s*(re|fw|fwd)\s*:/i;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class CeoOutreachAbort extends Error {
  constructor(message) {
    super(message);
    this.name = 'CeoOutreachAbort';
  }
}

/** Halt, twice over — house convention; the throw is what stops a stubbed process.exit falling through. */
function abort(detail) {
  const message = `[ceo-outreach] ${detail} Aborting.`;
  console.error(message);
  process.exit(1);
  throw new CeoOutreachAbort(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

export const OUTREACH_LIMITS = Object.freeze({
  max_recipients_per_cycle: MAX_RECIPIENTS_PER_CYCLE,
});

/**
 * The evidence an outreach cycle must produce before it may be called shipped.
 *
 * Not a pr_sha. A merged commit proves a draft was written, which is the one thing never in doubt;
 * the open question is whether a human read those five drafts and sent them. Only a receipt the
 * operator produces after the fact answers that.
 */
export const SENT_RECEIPT_PREFIX = 'sent_receipt_';

/**
 * Load and validate the human-committed contact list.
 *
 * `approved` is a file a human edits and commits. This function is the only reader, and there is
 * deliberately no writer anywhere in the orchestrator: the agent's power over this list is exactly
 * the power to read it.
 */
export function assertApprovedContacts(contacts) {
  if (!isPlainObject(contacts) || !Array.isArray(contacts.approved)) {
    abort('contacts file must be an object with an "approved" array.');
  }

  const seen = new Set();
  for (const [index, contact] of contacts.approved.entries()) {
    const where = `approved[${index}]`;
    if (!isPlainObject(contact)) abort(`${where} must be an object.`);
    for (const key of ['id', 'venue', 'email', 'approved_by']) {
      if (!nonEmptyString(contact[key])) {
        abort(`${where}.${key} must be a non-empty string — an unattributed contact is not approved.`);
      }
    }
    if (!EMAIL_PATTERN.test(contact.email)) {
      abort(`${where}.email ${JSON.stringify(contact.email)} is not an email address.`);
    }
    if (seen.has(contact.id)) abort(`${where}.id ${JSON.stringify(contact.id)} is duplicated.`);
    seen.add(contact.id);
  }

  return contacts.approved;
}

/**
 * Choose whom to write to this cycle.
 *
 * Selection only. An id that is not already on the human-committed list is not a new contact the
 * agent discovered — it is, overwhelmingly, one it invented, and an invented address does not
 * bounce loudly enough to notice.
 */
export function selectRecipients(approved, requestedIds) {
  if (!Array.isArray(requestedIds)) {
    abort('requested recipients must be an array of ids.');
  }
  if (requestedIds.length === 0) {
    abort('no recipients requested — an outreach cycle with nobody to write to is not a cycle.');
  }
  if (requestedIds.length > MAX_RECIPIENTS_PER_CYCLE) {
    abort(
      `${requestedIds.length} recipients requested; the per-cycle cap is ` +
        `${MAX_RECIPIENTS_PER_CYCLE}. The cap is a module constant, not a setting — raising it is ` +
        'a code change a human makes on purpose.',
    );
  }

  const byId = new Map(approved.map((contact) => [contact.id, contact]));
  const seen = new Set();

  return requestedIds.map((id) => {
    if (!nonEmptyString(id)) abort(`recipient id ${JSON.stringify(id ?? null)} is not an id.`);
    if (seen.has(id)) abort(`recipient ${JSON.stringify(id)} is listed twice in one cycle.`);
    seen.add(id);

    const contact = byId.get(id);
    if (contact === undefined) {
      abort(
        `recipient ${JSON.stringify(id)} is not on the approved contact list. The orchestrator ` +
          'may select from that list; it may not add to it.',
      );
    }
    return contact;
  });
}

/**
 * Every number a draft quotes at a stranger has to be one that was measured.
 *
 * This is the rail against the most expensive kind of hallucination available here: traction that
 * does not exist, quoted to the exact people whose trust the whole venue wedge depends on. A cited
 * metric must exist, be non-null, and carry the value the measurement actually recorded.
 */
function assertClaimsAreMeasured(draft, state, where) {
  const cited = draft.metrics_cited;
  if (!Array.isArray(cited)) {
    abort(`${where}.metrics_cited must be an array (use [] when the draft quotes no numbers).`);
  }

  for (const [index, claim] of cited.entries()) {
    const at = `${where}.metrics_cited[${index}]`;
    if (!isPlainObject(claim) || !nonEmptyString(claim.metric)) {
      abort(`${at}.metric must name a metric.`);
    }
    if (!Object.hasOwn(state?.metrics ?? {}, claim.metric)) {
      abort(`${at} cites ${JSON.stringify(claim.metric)}, which is not a measured metric.`);
    }

    const measured = state.metrics[claim.metric];
    if (measured === null) {
      abort(
        `${at} cites ${JSON.stringify(claim.metric)}, which is null. Quoting a number nobody has ` +
          'measured to a stranger is how a small finite audience is spent.',
      );
    }
    if (claim.value !== measured) {
      abort(
        `${at} claims ${JSON.stringify(claim.metric)} = ${JSON.stringify(claim.value)}, but the ` +
          `measurement says ${JSON.stringify(measured)}.`,
      );
    }
  }
}

/**
 * One draft, checked against everything a human would be embarrassed by after the fact.
 */
export function assertDraftCompliant(draft, { recipients, state }, index = 0) {
  const where = `draft[${index}]`;

  if (!isPlainObject(draft)) abort(`${where} must be an object.`);

  const recipient = recipients.find((contact) => contact.id === draft.recipient_id);
  if (recipient === undefined) {
    abort(`${where}.recipient_id ${JSON.stringify(draft.recipient_id ?? null)} was not selected this cycle.`);
  }

  if (!nonEmptyString(draft.subject)) abort(`${where}.subject must be a non-empty string.`);
  if (DECEPTIVE_SUBJECT_PREFIX.test(draft.subject)) {
    abort(`${where}.subject fakes a reply ("${draft.subject}") to a conversation that never happened.`);
  }
  if (!nonEmptyString(draft.body)) abort(`${where}.body must be a non-empty string.`);

  if (!isPlainObject(draft.sender) || !nonEmptyString(draft.sender.name)) {
    abort(`${where}.sender.name must say who is actually writing.`);
  }
  if (!nonEmptyString(draft.sender.email) || !EMAIL_PATTERN.test(draft.sender.email)) {
    abort(`${where}.sender.email must be a real reply-to address.`);
  }
  if (!nonEmptyString(draft.postal_address)) {
    abort(`${where}.postal_address is required on unsolicited commercial email.`);
  }
  if (!nonEmptyString(draft.opt_out)) {
    abort(`${where}.opt_out is required — a recipient must be told how to make this stop.`);
  }

  // In the body, not merely in a field. An opt-out the recipient never sees is not an opt-out,
  // and a structural check that stops at the metadata is satisfied by a template that drops it.
  if (!draft.body.includes(draft.opt_out)) {
    abort(`${where}.opt_out does not appear in the body the recipient will read.`);
  }
  if (!draft.body.includes(draft.postal_address)) {
    abort(`${where}.postal_address does not appear in the body the recipient will read.`);
  }

  assertClaimsAreMeasured(draft, state, where);

  return { ...draft, to: recipient.email, venue: recipient.venue };
}

/**
 * Build the outbox for one cycle: validated drafts, addressed, ready for a human to send.
 *
 * Returns an envelope; writing it is the caller's business, and sending it is a person's.
 */
export function buildOutbox({ cycle, contacts, recipientIds, drafts, state }) {
  if (!Number.isInteger(cycle) || cycle < 0) {
    abort(`outbox cycle must be a non-negative integer; got ${JSON.stringify(cycle ?? null)}.`);
  }

  const approved = assertApprovedContacts(contacts);
  const recipients = selectRecipients(approved, recipientIds);

  if (!Array.isArray(drafts) || drafts.length !== recipients.length) {
    abort(
      `expected one draft per recipient: ${recipients.length} selected, ` +
        `${Array.isArray(drafts) ? drafts.length : 'none'} drafted.`,
    );
  }

  const prepared = drafts.map((draft, index) =>
    assertDraftCompliant(draft, { recipients, state }, index),
  );

  return {
    cycle,
    status: 'awaiting_operator_send',
    limit: MAX_RECIPIENTS_PER_CYCLE,
    count: prepared.length,
    // Spelled out in the artifact, not only in this comment: whoever opens this file next should
    // not have to infer that nothing has been sent.
    note:
      'DRAFTS ONLY. Nothing here has been sent, and this repository contains no transport that ' +
      'could send it. A human reads these, sends them, and records a sent_receipt_ user_event.',
    drafts: prepared,
  };
}

/**
 * The only evidence that closes an outreach cycle.
 *
 * A pr_sha is refused by name rather than by omission, because the sha WILL exist (the drafts are
 * committed) and would otherwise look like a perfectly good answer to a question it does not
 * address.
 */
export function assertSendEvidence(evidence) {
  if (!isPlainObject(evidence)) {
    abort('outreach evidence must be an object.');
  }
  if (evidence.kind === 'pr_sha') {
    abort(
      'a pr_sha does not close an outreach cycle: committing five drafts is not sending them. ' +
        `Record a user_event whose ref begins "${SENT_RECEIPT_PREFIX}".`,
    );
  }
  if (evidence.kind !== 'user_event' || !nonEmptyString(evidence.ref)) {
    abort(`outreach evidence must be a user_event with a ref; got ${JSON.stringify(evidence.kind ?? null)}.`);
  }
  if (!evidence.ref.startsWith(SENT_RECEIPT_PREFIX)) {
    abort(`outreach evidence ref ${JSON.stringify(evidence.ref)} must begin "${SENT_RECEIPT_PREFIX}".`);
  }

  return true;
}
