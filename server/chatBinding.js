/**
 * Binds a chat request to one persisted insight record.
 *
 * Two rules, and both exist to stop a reply attaching to the wrong generation:
 *
 *   1. The STORED scope wins over the screen's current scope. A user who re-scopes the page
 *      while a question is in flight still gets an answer about what they asked, not about
 *      whatever is on screen when it lands.
 *   2. `canAppend` re-checks the generation's identity — period, generatedAt, analysisVersion —
 *      against the record as it exists AFTER the model call. Refreshing, clearing, or
 *      re-scoping in the meantime replaces or removes the record, the triple stops matching,
 *      and the stale reply is dropped instead of being appended to a conversation it does not
 *      belong to.
 *
 * Shared by the spend and finance triads. This is 15 lines of subtle correctness, so it must
 * not be copied per-triad — a divergence here surfaces as replies appearing under insights that
 * never prompted them.
 */
export function createChatBinding({ record = null, period, requestScope }) {
  const storedInsights = record?.period === period ? record : null
  const identity = storedInsights
    ? {
        period: storedInsights.period,
        generatedAt: storedInsights.generatedAt ?? null,
        analysisVersion: storedInsights.analysisVersion ?? 1,
      }
    : null

  return {
    storedInsights,
    scope: storedInsights ? (storedInsights.scope ?? storedInsights.period) : requestScope,
    canAppend(currentRecord) {
      if (!identity || currentRecord?.period !== identity.period) return false
      return (currentRecord.generatedAt ?? null) === identity.generatedAt
        && (currentRecord.analysisVersion ?? 1) === identity.analysisVersion
    },
  }
}
