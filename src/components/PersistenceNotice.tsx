import { useEffect, useState } from 'react'
import { PERSISTENCE_EVENT, persistenceFailure, retryPersistence, hasPendingSaves, dismissPersistenceFailure } from '../lib/persistence'
export function PersistenceNotice() {
  const [error, setError] = useState(persistenceFailure)
  useEffect(() => {
    const update = () => setError(persistenceFailure())
    window.addEventListener(PERSISTENCE_EVENT, update)
    return () => window.removeEventListener(PERSISTENCE_EVENT, update)
  }, [])
  if (!error) return null
  return <div className="backup-banner" role="alert"><div><strong>{hasPendingSaves() ? 'Changes are not saved' : 'Storage action failed'}</strong><p>{error} {hasPendingSaves() ? 'Keep this tab open until saving succeeds.' : 'Retry the action after resolving the problem.'}</p></div><button type="button" className="btn-secondary" onClick={hasPendingSaves() ? retryPersistence : dismissPersistenceFailure}>{hasPendingSaves() ? 'Retry saving' : 'Dismiss'}</button></div>
}
