import { useMemo } from 'react'
import { CARD_CATALOG, REGION_LABELS } from '../../../constants/cardCatalog.js'

// The value↔storage translation lives in `rewardsModel.js` beside `linkKindOf`, which reads the
// same shape. Re-exported here so a caller rendering the picker imports one thing, not two.
export { walletEntryFor, pickerValueFor } from '../../../utils/rewardsModel.js'

/**
 * The one control that links a ledger source name to a rewards card.
 *
 * Used in three places — the wallet setup, the import review modal, and Add Transaction — so that
 * a card is linked the same way wherever you happen to be standing. A `<select>` rather than a
 * search box: with 39 cards, grouped by region and issuer, a native picker is faster to use, fully
 * keyboard-accessible for free, and cannot invent a card that isn't there.
 *
 * The three non-catalog choices are not interchangeable:
 *
 *   ''          Not linked yet — a question nobody has answered. The page nags about these.
 *   'unlisted'  A rewards card the catalog doesn't cover. Counted, never scored, never nagged.
 *   'none'      Not a rewards card at all. Excluded from the page entirely.
 *
 * Collapsing `unlisted` into `none` would understate what you earn; collapsing it into "not linked"
 * would nag forever about a card we have already been told we can't score.
 */
export default function CardPicker({
  value,            // catalogId, 'unlisted', 'none', or '' — see above
  onChange,
  disabled = false,
  id,
  className = '',
  placeholder = 'Link a rewards card…',
}) {
  // Grouped by region then issuer so the list reads like a wallet, not like a database dump.
  const groups = useMemo(() => {
    const byRegion = new Map()
    for (const card of CARD_CATALOG) {
      let issuers = byRegion.get(card.region)
      if (!issuers) byRegion.set(card.region, (issuers = new Map()))
      const list = issuers.get(card.issuer) ?? []
      list.push(card)
      issuers.set(card.issuer, list)
    }
    return [...byRegion.entries()].map(([region, issuers]) => ({
      region,
      label: REGION_LABELS[region] ?? region,
      issuers: [...issuers.entries()]
        .map(([issuer, cards]) => ({
          issuer,
          cards: [...cards].sort((a, b) => a.name.localeCompare(b.name)),
        }))
        .sort((a, b) => a.issuer.localeCompare(b.issuer)),
    }))
  }, [])

  // A stored id whose catalog row has since been removed. Kept as an option so the select shows
  // what is actually stored rather than silently snapping to "not linked".
  const stale = value
    && value !== 'unlisted'
    && value !== 'none'
    && !CARD_CATALOG.some(c => c.id === value)

  return (
    <select
      id={id}
      value={value ?? ''}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      className={`border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:bg-gray-50 disabled:text-gray-400 ${className}`}
    >
      <option value="">{placeholder}</option>
      {stale && <option value={value}>{value} (no longer in the catalog)</option>}
      {groups.map(group => (
        <optgroup key={group.region} label={group.label}>
          {group.issuers.map(({ issuer, cards }) =>
            cards.map(card => (
              <option key={card.id} value={card.id}>
                {issuer} — {card.name}
              </option>
            ))
          )}
        </optgroup>
      ))}
      <optgroup label="Not in the catalog">
        <option value="unlisted">My rewards card isn&rsquo;t listed</option>
        <option value="none">Not a rewards card</option>
      </optgroup>
    </select>
  )
}
