/** A single strongly consistent object per code. Revision checks and writes are one transaction. */
export class SyncStore {
  constructor(state, env) { this.state = state; this.env = env }
  async fetch(request) {
    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    if (!/^[0-9a-f]{64}$/.test(id ?? '')) return Response.json({error:'invalid id'}, {status:400})
    // Storage gate serializes initialization and includes old encrypted data without deleting KV.
    await this.state.blockConcurrencyWhile(async () => {
      if (!await this.state.storage.get('initialized')) {
        const old = await this.env.PUSH.get(`sync:${id}`, 'json')
        await this.state.storage.transaction(async tx => {
          if (old) await tx.put('record', {...old, revision:1})
          await tx.put('initialized', true)
        })
      }
    })
    if (request.method === 'GET') return Response.json(await this.state.storage.get('record') ?? {revision:0})
    const body = await request.json()
    if (!Number.isSafeInteger(body.revision) || body.revision < 0 || (url.pathname !== '/sync-v2/delete' && (typeof body.blob !== 'string' || body.blob.length > 400000))) return Response.json({error:'invalid payload'}, {status:400})
    return this.state.storage.transaction(async tx => {
      const old = await tx.get('record') ?? {revision:0}
      if (body.revision !== old.revision) return Response.json({error:'conflict', revision:old.revision}, {status:409})
      const next = {revision:old.revision+1, at:Date.now(), ...(url.pathname === '/sync-v2/delete' ? {deleted:true} : {blob:body.blob})}
      await tx.put('record', next)
      return Response.json({revision:next.revision, at:next.at})
    })
  }
}
