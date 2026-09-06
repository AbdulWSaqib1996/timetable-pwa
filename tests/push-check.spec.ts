import { test, expect } from '@playwright/test'
import { sendTestPush } from '../src/lib/pushCheck'

test('client sends only its own subscription and never falls back to the old broadcast endpoint',async()=>{
  const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),originalFetch=globalThis.fetch
  const calls:{url:string;body:string}[]=[]
  let subscription: {toJSON:()=>object}|null=null
  let status=200
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{serviceWorker:{getRegistration:async()=>({pushManager:{getSubscription:async()=>subscription}})}}})
  globalThis.fetch=async(url,init)=>{
    calls.push({url:String(url),body:String(init?.body)})
    return new Response(JSON.stringify({ok:true,sent:1}),{status})
  }
  try{
    expect(await sendTestPush('https://fixture.invalid/')).toContain('Enable background push')
    expect(calls).toHaveLength(0)
    const own={endpoint:'https://fcm.googleapis.com/fcm/send/fixture',keys:{auth:'fixture-only',p256dh:'fixture-only'}}
    subscription={toJSON:()=>own}
    expect(await sendTestPush('https://fixture.invalid/')).toContain('Test sent to this device')
    expect(calls[0]).toEqual({url:'https://fixture.invalid/test-device',body:JSON.stringify({subscription:own})})
    status=404
    expect(await sendTestPush('https://fixture.invalid/')).toContain('needs an update')
    status=429
    expect(await sendTestPush('https://fixture.invalid/')).toContain('recently for this device')
    expect(calls.every(c=>c.url.endsWith('/test-device'))).toBe(true)
    globalThis.fetch=async()=>{throw new Error('offline')}
    expect(await sendTestPush('https://fixture.invalid')).toContain('Check your connection')
  }finally{
    globalThis.fetch=originalFetch
    if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator)
    else Reflect.deleteProperty(globalThis,'navigator')
  }
})
