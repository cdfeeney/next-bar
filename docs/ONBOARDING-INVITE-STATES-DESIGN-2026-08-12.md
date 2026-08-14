# Onboarding, invited-friend, and operational-state design

## Review package

Three new Claude Design canvases were created and rendered without changing any approved file:

1. [Onboarding V1](https://claude.ai/design/p/e0e31f0b-bdc1-4029-9e4c-666be9ea95cc?file=next-bar-onboarding-v1.dc.html)
2. [Night Out invite recipient V1](https://claude.ai/design/p/e0e31f0b-bdc1-4029-9e4c-666be9ea95cc?file=next-bar-night-out-invite-recipient-v1.dc.html)
3. [Operational states V1](https://claude.ai/design/p/e0e31f0b-bdc1-4029-9e4c-666be9ea95cc?file=next-bar-operational-states-v1.dc.html)

All three are marked `EXPLORATORY — REVIEW NEEDED`. Local screenshots are indexed in `docs/design-reference/README.md`.

## Proposed onboarding

1. Authenticate: Apple, Google, or phone; email/password remains the quiet implemented fallback.
2. Confirm 21+ with one tap. Do not collect an exact birthdate unless a later legal/compliance review requires it.
3. Explain location value, then ask permission. Offer neighborhood selection and Anywhere as honest fallbacks.
4. Offer a roughly 30-second taste quiz or `Skip — show me bars`.
5. Land on real Next Bar? recommendations.

Do not require gender: it does not improve the core job. If research later needs it, make it optional in Account, state the purpose, and include `Prefer not to say`.

Identity remains one founder decision. Recommended default: use the provider display name when available and defer username creation until the first Social action; phone users may need one short `What should friends call you?` step because phone auth supplies no public identity.

## Invited-friend behavior

- A deep-link recipient sees the Night, inviter, time, area, attendees, shortlist, and privacy boundary before signup.
- The recipient can RSVP before signup.
- Signup is offered afterward to vote, suggest bars, receive updates, and join the social graph.
- The invite context survives authentication and returns the person to the same Night.
- Signed-in friends get pending, accepted, plan-updated, expired, revoked, offline-queued, and already-responded states in Social.

## Rankings rule explained

“One global score per bar” means a bar has one personal rating everywhere. If Joyface is `8.8`, it remains `8.8` in Best Bars, Cocktail Bars, Date Night, and every custom list. Lists organize bars; they do not create separate ratings.

Recommendation: approve the global score rule. It keeps rating fast, prevents contradictory scores, and lets moving a bar between lists remain a one-step organization action. Reject it only if the product explicitly needs context-specific ratings such as `9.2 for dancing` and `6.5 for dates`, which would require a materially more complex rating model.

## Implementation dependencies

- Apple, Google, and phone authentication are not implemented in the current repository; email/password is the live method.
- Phone auth requires an SMS provider and OTP configuration.
- OAuth callback, account linking, invite-context restoration, and provider-error recovery need implementation and security testing.
- The current `/join` route is a waitlist form, not the designed Night invitation experience.
- None of this authorizes application-code changes yet.
