import { useMemo, useState } from 'react'
import { buildRewardsModel } from '../../../utils/rewardsModel.js'
import { catalogVerifiedAt } from '../../../constants/cardCatalog.js'
import WalletCards from './WalletCards.jsx'
import WalletSetup from './WalletSetup.jsx'
import RewardsMatrix from './RewardsMatrix.jsx'
import RotatingQuarters from './RotatingQuarters.jsx'
import EarnedCard from './EarnedCard.jsx'
import Limitations from './Limitations.jsx'
import CardCatalogBrowser from './CardCatalogBrowser.jsx'
import SpendAudit from './SpendAudit.jsx'
import RateCorrections from './RateCorrections.jsx'
import CustomCardForm from './CustomCardForm.jsx'
import { resolveDisplayCurrency } from '../../../utils/displayCurrency.js'
import { money } from './format.js'

/** A CAD book browses Canadian cards first, a USD book American ones. Overridable, and stored. */
function defaultRegion(displayCurrency) {
  return resolveDisplayCurrency(displayCurrency) === 'CAD' ? 'ca' : 'us'
}

/**
 * The Rewards view.
 *
 * Reads the same scoped rows the Spend charts read, so a period chip or a filter chip moves this
 * view exactly as it moves them. Everything shown is derived; the only thing ever written is the
 * wallet entry for a source name — the link itself, a chooser slot, or a rotating quarter.
 *
 * Layout copies the Spend view's contract exactly: main column plus a 320px sticky rail that drops
 * below the content under xl. Deliberately no AI panel — every figure here is deterministic, and
 * AGENTS.md keeps the insight catalogues disjoint by subject.
 */
export default function RewardsView({
  spendTxs,
  allSources,
  range,
  settings,
  categoryColors,
  demoMode = false,
  onLink,
  onRegionChange,
  onOverrides,
  onCustom,
  saving = false,
  clearsPinned = 0,
  browserOpen = false,
}) {
  const model = useMemo(
    () => buildRewardsModel({ spendTxs, allSources, range, settings }),
    [spendTxs, allSources, range, settings],
  )

  const needsSetup = model.sourceStates.unlinked.length > 0
  const [setupOpen, setSetupOpen] = useState(false)
  const showSetup = setupOpen || needsSetup

  const wallet = settings?.cardRewards?.wallet ?? {}
  const windowLabel = range?.monthCount > 1 ? `${range.monthCount} months on screen` : 'this period'
  const { scored, scorable } = model.coverage
  const categories = useMemo(() => model.rows.map(r => r.category), [model.rows])
  const hasPartial = model.rows.some(row => row.cells.some(cell => cell.partial))

  // `undefined` is "never chosen" and takes the home-currency default; `null` is the user having
  // explicitly asked for every region, and must survive a reload as itself.
  const storedRegion = settings?.cardRewards?.region
  const region = storedRegion === undefined ? defaultRegion(settings?.displayCurrency) : storedRegion
  const custom = settings?.cardRewards?.custom ?? {}
  const overrides = settings?.cardRewards?.overrides ?? {}
  const ownedIds = useMemo(
    () => Object.values(wallet).map(entry => entry?.catalogId).filter(Boolean),
    [wallet],
  )

  // Slot and quarter edits are ordinary wallet writes — same handler as linking a card, because
  // they change the same stored entry. The transform itself lives in `rewardsModel`.
  function handleEntryChange(sourceName, entry) {
    onLink(sourceName, entry)
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
      <div className="min-w-0 flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-[15px] font-semibold text-gray-900">Card Rewards</h2>
            <p className="mt-1 text-[12.5px] text-gray-400">
              {model.cards.length > 0 ? (
                <>
                  {money(model.earned.period)} estimated over {range?.label ?? 'this period'}
                  {scorable > scored && <> · {scored} of {scorable} cards scored</>}
                </>
              ) : (
                <>Link a card to see what your spending earns</>
              )}
            </p>
          </div>
          <span className="text-[12px] text-gray-400">
            Rates from our card catalog · verified {catalogVerifiedAt()}
          </span>
        </div>

        {/* Money on an unlinked card earns nothing here. Said plainly rather than shown as $0, which
            would read as "this card pays nothing" instead of "we were never told what it is". */}
        {needsSetup && (
          <div className="px-4 py-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-900">
            {model.sourceStates.unlinked.length === 1 ? (
              <>
                <strong>{model.sourceStates.unlinked[0].sourceName}</strong> isn&rsquo;t linked to a
                card yet, so its spending isn&rsquo;t earning anything on this page.
              </>
            ) : (
              <>
                <strong>{model.sourceStates.unlinked.length} card names</strong> aren&rsquo;t linked
                to a card yet, so their spending isn&rsquo;t earning anything on this page.
              </>
            )}
          </div>
        )}

        {model.cards.length > 0 || model.sourceStates.unlisted.length > 0 ? (
          <WalletCards
            cards={model.cards}
            earnedByCard={model.earned.byCard}
            unlisted={model.sourceStates.unlisted}
            windowLabel={windowLabel}
            canSetup={!showSetup}
            onSetup={() => setSetupOpen(true)}
          />
        ) : null}

        {showSetup && (
          <WalletSetup
            sourceStates={model.sourceStates}
            wallet={wallet}
            custom={custom}
            demoMode={demoMode}
            onLink={onLink}
            onDone={needsSetup ? undefined : () => setSetupOpen(false)}
          />
        )}

        <RewardsMatrix
          rows={model.rows}
          cards={model.cards}
          wallet={wallet}
          categoryColors={categoryColors}
          currentQuarter={model.currentQuarter}
          custom={custom}
          demoMode={demoMode}
          onEntryChange={handleEntryChange}
        />

        {/* A wallet with cards but no spending in scope: the grid has no rows to draw, and saying
            so beats rendering an empty table. */}
        {model.cards.length > 0 && model.rows.length === 0 && (
          <p className="text-[12.5px] text-gray-400">
            No spending in this period to rank cards against. Widen the period, or clear a filter.
          </p>
        )}

        {model.cards.length > 0 && (
          <SpendAudit
            rows={model.audit}
            unknownQuarters={model.unknownQuarters}
            leftBehind={model.leftBehind}
          />
        )}

        <CardCatalogBrowser
          cards={model.cards}
          monthly={model.monthly}
          ownedIds={ownedIds}
          region={region}
          onRegionChange={onRegionChange}
          unlinkedSources={model.unlinkedSources}
          shortWindow={model.projection.shortWindow}
          demoMode={demoMode}
          onLink={onLink}
          defaultOpen={browserOpen}
        />

        <RateCorrections
          cards={model.cards}
          overrides={overrides}
          custom={custom}
          demoMode={demoMode}
          onChange={onOverrides}
        />

        <CustomCardForm custom={custom} demoMode={demoMode} onChange={onCustom} />

        {saving && <p className="text-[12px] text-gray-400">Saving…</p>}
      </div>

      {/* Same sticky contract as the Spend rail: offset by the pinned scope bar, capped to the
          viewport and scrollable only where it is actually sticky. */}
      <aside
        className="xl:sticky xl:overflow-y-auto xl:max-h-[var(--rail-max-h)] min-w-0 flex flex-col gap-5"
        style={{ top: clearsPinned, '--rail-max-h': `calc(100vh - ${clearsPinned + 16}px)` }}
      >
        {model.cards.length > 0 && (
          <EarnedCard
            earned={model.earned}
            optimal={model.optimal}
            leftBehind={model.leftBehind}
            projection={model.projection}
            range={range}
            coverage={model.coverage}
          />
        )}

        <RotatingQuarters
          cards={model.cards}
          wallet={wallet}
          range={range}
          currentQuarter={model.currentQuarter}
          categories={categories}
          custom={custom}
          demoMode={demoMode}
          onEntryChange={handleEntryChange}
        />

        <Limitations hasPartial={hasPartial} hasRotating={model.cards.some(c => c.rotating)} />
      </aside>
    </div>
  )
}
