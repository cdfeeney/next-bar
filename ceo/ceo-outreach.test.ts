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
});

const contacts = {
  approved: [
    { id: 'the-dead-poet', venue: 'The Dead Poet', email: 'owner@deadpoet.example', approved_by: 'human-operator' },
    { id: 'ottos-shrunken-head', venue: "Otto's Shrunken Head", email: 'hi@ottos.example', approved_by: 'human-operator' },
  ],
};

const state = {
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
      cycle: 3,
      contacts,
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
        cycle: 3,
        contacts,
        recipientIds: ['the-dead-poet', 'ottos-shrunken-head'],
        drafts: [draft()],
        state,
      }),
    );
  });

  it('refuses a contact list with an unattributed entry', () => {
    expectHardAbort(() =>
      buildOutbox({
        cycle: 3,
        contacts: { approved: [{ id: 'x', venue: 'X', email: 'x@x.example', approved_by: '' }] },
        recipientIds: ['x'],
        drafts: [draft({ recipient_id: 'x' })],
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
