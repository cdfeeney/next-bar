/**
 * Same-document custom events, in a neutral module both publisher and
 * subscriber can import.
 *
 * Deliberately NOT exported from either gate component: AgeGate is the
 * foundational legal gate and must not depend on a feature gate's module
 * graph just to name a string (santa round-2). Keeping the constant here also
 * means adding a second subscriber later cannot create an import cycle.
 */

/**
 * Dispatched by AgeGate the moment the 21+ acknowledgement is stored.
 *
 * A `storage` event would NOT do: that only fires in OTHER documents, and the
 * subscriber here is a sibling component in the same one. Without this, a
 * first-ever install latched "age not acknowledged" at mount and never
 * re-evaluated (g-31c59158 santa round-1).
 */
export const AGE_ACK_EVENT = 'next-bar:age-acked';
