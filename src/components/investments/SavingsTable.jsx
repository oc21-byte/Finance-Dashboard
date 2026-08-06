import { useState } from 'react'
import ConfirmDeleteButton from '../shared/ConfirmDeleteButton.jsx'
import { money, exact } from './format.js'

export const SAVINGS_ACCOUNT_TYPES = ['HYSA', 'Regular Savings', 'Money Market', 'CD / GIC', 'Other']

const editClass = 'border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

/**
 * Savings accounts, with the balance and APY editable in place.
 *
 * Interest is recomputed from the edit buffer while a row is open, so the annual figure moves as
 * the APY is typed rather than jumping only once the row is saved.
 */
export default function SavingsTable({
  accounts,
  editingId,
  editForm,
  onEditField,
  onStartEdit,
  onCancelEdit,
  onSave,
  onDelete,
  saving,
  deleting,
  onAdd,
  addingAccount,
  readOnly,
}) {
  const [confirmingId, setConfirmingId] = useState(null)

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
        <div>
          <h2 className="text-[15px] font-semibold text-gray-900">Savings accounts</h2>
          <p className="text-[12.5px] text-gray-400">Cash held outside the chequing ledger</p>
        </div>
        <button
          onClick={onAdd}
          disabled={readOnly}
          title={readOnly ? 'Unavailable in Demo Mode' : undefined}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {addingAccount ? 'Cancel' : '+ Add account'}
        </button>
      </div>

      {accounts.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-gray-400">No savings accounts yet.</p>
          <p className="mt-1 text-xs text-gray-300">Add one to track a HYSA, GIC, or money market balance.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-400">
                <th className="px-4 py-2.5">Name</th>
                <th className="hidden px-4 py-2.5 sm:table-cell">Type</th>
                <th className="px-4 py-2.5 text-right">Balance</th>
                <th className="px-4 py-2.5 text-right">APY</th>
                <th className="hidden px-4 py-2.5 text-right md:table-cell">Monthly interest</th>
                <th className="px-4 py-2.5 text-right">Annual interest</th>
                <th className="w-20 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {accounts.map(account => {
                const isEditing = editingId === account.id
                const balance = isEditing ? (parseFloat(editForm.balance) || 0) : (Number(account.balance) || 0)
                const apy = isEditing ? (parseFloat(editForm.apy) || 0) : (Number(account.apy) || 0)
                const annual = balance * (apy / 100)
                return (
                  <tr
                    key={account.id}
                    className={`transition-colors ${
                      isEditing ? 'bg-blue-50' : confirmingId === account.id ? 'bg-red-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          value={editForm.name ?? ''}
                          onChange={e => onEditField('name', e.target.value)}
                          className={`w-full ${editClass}`}
                        />
                      ) : (
                        <span className="text-sm font-semibold text-gray-900">{account.name}</span>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      {isEditing ? (
                        <select
                          value={editForm.accountType ?? ''}
                          onChange={e => onEditField('accountType', e.target.value)}
                          className={editClass}
                        >
                          {SAVINGS_ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      ) : (
                        <span className="text-sm text-gray-500">{account.accountType}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editForm.balance ?? ''}
                          onChange={e => onEditField('balance', e.target.value)}
                          className={`w-28 text-right ${editClass}`}
                        />
                      ) : (
                        <span className="text-sm text-gray-900">{money(account.balance)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editForm.apy ?? ''}
                          onChange={e => onEditField('apy', e.target.value)}
                          className={`w-20 text-right ${editClass}`}
                        />
                      ) : (
                        <span className="text-sm text-gray-600">{exact(account.apy)}%</span>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-right text-sm font-medium text-amber-600 md:table-cell">
                      ${exact(annual / 12)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium text-amber-600">
                      ${exact(annual)}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => onSave(account.id)}
                            disabled={saving}
                            className="rounded-md bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-60"
                          >
                            Save
                          </button>
                          <button
                            onClick={onCancelEdit}
                            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => onStartEdit(account)}
                            disabled={readOnly}
                            title={readOnly ? 'Unavailable in Demo Mode' : 'Edit'}
                            className="text-sm text-gray-400 transition-colors hover:text-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            ✎
                          </button>
                          <ConfirmDeleteButton
                            confirming={confirmingId === account.id}
                            onRequest={() => setConfirmingId(account.id)}
                            onCancel={() => setConfirmingId(null)}
                            onConfirm={() => { setConfirmingId(null); onDelete(account.id) }}
                            disabled={deleting || readOnly}
                            title={readOnly ? 'Unavailable in Demo Mode' : `Delete ${account.name}`}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
