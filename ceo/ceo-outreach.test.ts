import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OUTREACH_LIMITS,
  SENT_RECEIPT_PREFIX,
  assertDraftCompliant,
  assertSendEvidence,
  buildOutbox,
  selectRecipients,
} from '../scripts/ceo-outreach.mjs';
import { ALLOWED, CAPABILITIES, assertActionAllowed } from '../scripts/ceo-guard.mjs';

class ProcessExit extends Error {
  constructor(readonly code: string | number | null | undefined) {
    super('process.exit(' + String(code) + ')');
  }
}

let exitSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

function expectHardAbort(action: () => void) {
  expect(action).toThrow(ProcessExit);
  expect(exitSpy).toHaveBeenCalledWith(1);
  expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Aborting.'));
}

beforeEach(() => {
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null): never => {
    throw new ProcessExit(code);
  });
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (contactsDir) rmSync(contactsDir, { recursive: true, force: true });
});

const contacts = {
  approved: [
    { id: 'the-dead-poet', venue: 'The Dead Poet', email: 'owner@deadpoet.example', approved_by: 'human-operator' },
    { id: 'ottos-shrunken-head', venue: "Otto's Shrunken Head", email: 'hi@ottos.example', approved_by: 'human-operator' },
  ],
};

let contactsPath: string;
let contactsDir: string;

function writeContacts(payload: unknown) {
  contactsDir = mkdtempSync(path.join(tmpdir(), 'ceo-contacts-'));
  contactsPath = path.join(contactsDir, 'approved.json');
  writeFileSync(contactsPath, JSON.stringify(payload), 'utf8');
  return contactsPath;
}

const state = {
  cycle: 3,
  metrics: {
    wau: null,
    max_neighborhood_wau: null,
    claimed_venues: 4,
    self_maintaining_venues: 2,
    venue_active_maintainers: 2,
    user_interviews_this_week: 3,
    revenue: 0,
    operator_hours_available: 8,
  },
};

const POSTAL = '123 Somewhere St, Brooklyn NY 11211';
const OPT_OUT = 'Reply STOP and I will never write again.';
const DISCLOSURE = 'This is a commercial message about a product I built.';

function draft(overrides: Record<string, unknown> = {}) {
  const base = {
    recipient_id: 'the-dead-poet',
    subject: 'Your hours on Next Bar are wrong — want to fix them?',
    sender: { name: 'Connor', email: 'connor@nextbar.example' },
    postal_address: POSTAL,
    opt_out: OPT_OUT,
    commercial_disclosure: DISCLOSURE,
    metrics_cited: [],
    ...overrides,
  };

  return {
    ...base,
    body:
      (overrides.body as string) ??
      `Hi — I run a small bar-finder in NYC and your hours are out of date.\n\n${base.commercial_disclosure}\n${base.postal_address}\n${base.opt_out}`,
  };
}

describe('the capability story', () => {
  it('drafting outreach is a DRAFT action, and CONTACT_EXTERNAL is still granted nothing', () => {
    expect(ALLOWED.DRAFT).toContain('write_outreach_draft');
    expect(ALLOWED.CONTACT_EXTERNAL).toEqual([]);
  });

  it('still refuses anything asking for CONTACT_EXTERNAL', () => {
    expectHardAbort(() =>
      assertActionAllowed({ capability: CAPABILITIES.CONTACT_EXTERNAL, action: 'write_outreach_draft' }),
    );
  });

  it('allows the draft action under DRAFT', () => {
    expect(() =>
      assertActionAllowed({ capability: CAPABILITIES.DRAFT, action: 'write_outreach_draft' }),
    ).not.toThrow();
  });
});

describe('recipient selection', () => {
  it('selects from the human-committed list', () => {
    const selected = selectRecipients(contacts.approved, ['the-dead-poet']);
    expect(selected).toHaveLength(1);
    expect(selected[0].email).toBe('owner@deadpoet.example');
  });

  it('refuses a recipient that is not on the approved list', () => {
    // The failure this stops is not a typo. It is an invented address, which does not bounce
    // loudly enough for anyone to notice the outreach never happened.
    expectHardAbort(() => selectRecipients(contacts.approved, ['mcsorleys']));
  });

  it('refuses more recipients than the per-cycle cap', () => {
    const many = Array.from({ length: OUTREACH_LIMITS.max_recipients_per_cycle + 1 }, () => 'the-dead-poet');
    expectHardAbort(() => selectRecipients(contacts.approved, many));
  });

  it('caps at five', () => {
    expect(OUTREACH_LIMITS.max_recipients_per_cycle).toBe(5);
  });

  it('refuses the same recipient twice in one cycle', () => {
    expectHardAbort(() => selectRecipients(contacts.approved, ['the-dead-poet', 'the-dead-poet']));
  });

  it('refuses an empty request', () => {
    expectHardAbort(() => selectRecipients(contacts.approved, []));
  });
});

describe('draft compliance', () => {
  const recipients = contacts.approved;

  it('accepts a complete draft and addresses it', () => {
    const prepared = assertDraftCompliant(draft(), { recipients, state });
    expect(prepared.to).toBe('owner@deadpoet.example');
    expect(prepared.venue).toBe('The Dead Poet');
  });

  it.each([
    ['no subject', { subject: '' }],
    ['a faked reply subject', { subject: 'Re: our conversation' }],
    ['no sender name', { sender: { name: '', email: 'connor@nextbar.example' } }],
    ['no reply-to address', { sender: { name: 'Connor', email: 'not-an-email' } }],
    ['no postal address', { postal_address: '' }],
    ['no opt-out', { opt_out: '' }],
    // "The law makes no exception for business-to-business email" — FTC CAN-SPAM compliance guide.
    ['no commercial disclosure', { commercial_disclosure: '' }],
  ])('refuses a draft with %s', (_label, overrides) => {
    expectHardAbort(() => assertDraftCompliant(draft(overrides), { recipients, state }));
  });

  // Each of these three omits exactly one required line from the body and keeps the other two, so
  // the test fails for its own reason rather than borrowing a neighbour's.
  const bodyWith = (...parts: string[]) => ['Hi — your hours are wrong.', ...parts].join('\n');

  it('refuses a draft whose opt-out never appears in the body', () => {
    // A structural check that stops at the metadata field is satisfied by a template that drops
    // the line, and the recipient is the one who finds out.
    expectHardAbort(() =>
      assertDraftCompliant(
        draft({ body: bodyWith(DISCLOSURE, POSTAL) }),
        { recipients, state },
      ),
    );
  });

  it('refuses a draft whose postal address never appears in the body', () => {
    expectHardAbort(() =>
      assertDraftCompliant(
        draft({ body: bodyWith(DISCLOSURE, OPT_OUT) }),
        { recipients, state },
      ),
    );
  });

  it('refuses a draft that never tells the recipient it is a commercial message', () => {
    // "The law makes no exception for business-to-business email" — FTC CAN-SPAM compliance guide.
    // A friendly note to a bar owner about a product is an advertisement, whatever it feels like.
    expectHardAbort(() =>
      assertDraftCompliant(
        draft({ body: bodyWith(POSTAL, OPT_OUT) }),
        { recipients, state },
      ),
    );
  });

  it('refuses traction that was never measured', () => {
    // wau is null. Quoting it to a bar owner is the single most expensive sentence available here.
    expectHardAbort(() =>
      assertDraftCompliant(
        draft({ metrics_cited: [{ metric: 'wau', value: 200 }] }),
        { recipients, state },
      ),
    );
  });

  it('refuses a measured metric quoted at the wrong value', () => {
    expectHardAbort(() =>
      assertDraftCompliant(
        draft({ metrics_cited: [{ metric: 'claimed_venues', value: 40 }] }),
        { recipients, state },
      ),
    );
  });

  it('refuses a metric that does not exist', () => {
    expectHardAbort(() =>
      assertDraftCompliant(
        draft({ metrics_cited: [{ metric: 'monthly_delight', value: 9 }] }),
        { recipients, state },
      ),
    );
  });

  it('refuses a claim carrying anything beyond the metric and its value', () => {
    // Review finding (DeepSeek): an open shape lets a checked number arrive wearing an unchecked
    // adjective, and the adjective is the part that misleads.
    expectHardAbort(() =>
      assertDraftCompliant(
        draft({ metrics_cited: [{ metric: 'claimed_venues', value: 4, interpretation: 'growing fast!' }] }),
        { recipients, state },
      ),
    );
  });

  it('accepts a metric quoted at the value that was actually measured', () => {
    expect(() =>
      assertDraftCompliant(
        draft({ metrics_cited: [{ metric: 'claimed_venues', value: 4 }] }),
        { recipients, state },
      ),
    ).not.toThrow();
  });
});

describe('the outbox', () => {
  it('says in the artifact itself that nothing has been sent', () => {
    const outbox = buildOutbox({
      contactsPath: writeContacts(contacts),
      recipientIds: ['the-dead-poet'],
      drafts: [draft()],
      state,
    });

    expect(outbox.status).toBe('awaiting_operator_send');
    expect(outbox.note).toMatch(/nothing here has been sent/i);
    expect(outbox.drafts).toHaveLength(1);
  });

  it('refuses a mismatch between recipients selected and drafts written', () => {
    expectHardAbort(() =>
      buildOutbox({
        contactsPath: writeContacts(contacts),
        recipientIds: ['the-dead-poet', 'ottos-shrunken-head'],
        drafts: [draft()],
        state,
      }),
    );
  });

  it('refuses a contact list with an unattributed entry', () => {
    expectHardAbort(() =>
      buildOutbox({
        contactsPath: writeContacts({
          approved: [{ id: 'x', venue: 'X', email: 'x@x.example', approved_by: '' }],
        }),
        recipientIds: ['x'],
        drafts: [draft({ recipient_id: 'x' })],
        state,
      }),
    );
  });
});

describe('holes found by independent review', () => {
  const recipients = contacts.approved;

  it('refuses a number in the prose that metrics_cited never declared', () => {
    // Reproduced by the reviewer: metrics_cited was checked and then never compared against the
    // body, so `metrics_cited: []` plus "200 weekly users" in the text passed every rail while wau
    // was null. The declaration was a form nobody read against the letter.
    expectHardAbort(() =>
      assertDraftCompliant(
        draft({
          body: `We have 200 weekly users.\n${DISCLOSURE}\n${POSTAL}\n${OPT_OUT}`,
          metrics_cited: [],
        }),
        { recipients, state },
      ),
    );
  });

  it('allows a number in the prose once it is declared at its measured value', () => {
    expect(() =>
      assertDraftCompliant(
        draft({
          body: `4 venues already keep their hours current here.\n${DISCLOSURE}\n${POSTAL}\n${OPT_OUT}`,
          metrics_cited: [{ metric: 'claimed_venues', value: 4 }],
        }),
        { recipients, state },
      ),
    ).not.toThrow();
  });

  it('does not mistake the footer address digits for a claim', () => {
    expect(() => assertDraftCompliant(draft(), { recipients, state })).not.toThrow();
  });

  it('will not read contacts from a caller-supplied object', () => {
    // While `contacts` was a parameter, "select only from a human-committed list" was enforced
    // against whatever object the agent passed in — an invented address wearing
    // approved_by: 'human-operator' needed no human at all.
    expectHardAbort(() =>
      buildOutbox({
        contactsPath: path.join(tmpdir(), 'definitely-not-a-contacts-file-9f3a.json'),
        recipientIds: ['the-dead-poet'],
        drafts: [draft()],
        state,
      }),
    );
  });

  it('takes the cycle from state, not from the caller', () => {
    const outbox = buildOutbox({
      contactsPath: writeContacts(contacts),
      recipientIds: ['the-dead-poet'],
      drafts: [draft()],
      state,
    });

    // A caller-supplied cycle made the five-per-cycle cap a five-per-CALL cap: two invocations
    // claiming the same cycle both passed, and ten emails went out under a limit of five.
    expect(outbox.cycle).toBe(state.cycle);
  });

  it('refuses two drafts addressed to the same recipient alongside two selected', () => {
    // Equal counts is a weaker claim than one-to-one: B is silently dropped and A written twice.
    expectHardAbort(() =>
      buildOutbox({
        contactsPath: writeContacts(contacts),
        recipientIds: ['the-dead-poet', 'ottos-shrunken-head'],
        drafts: [draft(), draft()],
        state,
      }),
    );
  });
});

describe('what closes an outreach cycle', () => {
  it('accepts an operator send receipt', () => {
    expect(assertSendEvidence({ kind: 'user_event', ref: `${SENT_RECEIPT_PREFIX}2026_07_26_5` })).toBe(true);
  });

  it('refuses a pr_sha by name — committing drafts is not sending them', () => {
    expectHardAbort(() =>
      assertSendEvidence({ kind: 'pr_sha', repo: 'cdfeeney/next-bar', ref: 'a1b2c3d', class: 'user_facing' }),
    );
  });

  it('refuses a user_event that is not a send receipt', () => {
    expectHardAbort(() => assertSendEvidence({ kind: 'user_event', ref: 'evt_01HZX9' }));
  });
});
