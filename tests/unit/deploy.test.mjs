import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

function isolatedDriver(t) {
  const dir=mkdtempSync(join(tmpdir(),'timetable-deploy-fixture-'))
  t.after(()=>rmSync(dir,{recursive:true,force:true}))
  mkdirSync(join(dir,'scripts'));mkdirSync(join(dir,'bin'))
  for(const file of ['deploy.sh','select-deploy-run.mjs','validate.sh'])copyFileSync(resolve('scripts',file),join(dir,'scripts',file))
  writeFileSync(join(dir,'bin','gh'),`#!/usr/bin/env node
const fs=require('fs'),a=process.argv.slice(2),file=process.env.FIXTURE_DIR+'/dispatch';
if(a[0]==='api')console.log('expected-sha');
else if(a[0]==='workflow'){fs.writeFileSync(file,a.find(s=>s.startsWith('deployment_id=')).split('=')[1])}
else if(a[1]==='list')console.log(JSON.stringify(process.env.SCENARIO==='missing'?[]:[{databaseId:999,displayTitle:'unrelated',headSha:'expected-sha'},{databaseId:123,displayTitle:fs.readFileSync(file,'utf8'),headSha:'expected-sha'}]));
else if(a[1]==='view'){if(a[2]!=='123')process.exit(9);console.log(process.env.SCENARIO==='timeout'?'in_progress ':process.env.SCENARIO==='failed'?'completed failure':'completed success')}
else process.exit(10);
`,{mode:0o755})
  for(const tool of ['npm','npx'])writeFileSync(join(dir,'bin',tool),`#!/usr/bin/env node
require('fs').appendFileSync(process.env.FIXTURE_DIR+'/commands','${tool} '+process.argv.slice(2).join(' ')+'\\n');
if(process.env.FAIL_STEP && process.argv.includes(process.env.FAIL_STEP))process.exit(1);
`,{mode:0o755})
  const run=(script,args=[],extra={})=>spawnSync('bash',[join(dir,'scripts',script),...args],{env:{...process.env,PATH:join(dir,'bin')+':'+process.env.PATH,FIXTURE_DIR:dir,TIMETABLE_POLL_ATTEMPTS:'2',TIMETABLE_POLL_SECONDS:'0',...extra},encoding:'utf8'})
  return {dir,run}
}
test('release driver selects its own dispatch and fails closed on missing, failed or timed out runs',t=>{
  const {run}=isolatedDriver(t)
  for(const scenario of ['missing','failed','timeout']){
    const r=run('deploy.sh',['app'],{SCENARIO:scenario})
    assert.equal(r.status,1,r.stdout+r.stderr);assert.match(r.stdout,/FAIL:/)
  }
  const r=run('deploy.sh',['app'],{SCENARIO:'success'})
  assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/PASS: Pages workflow 123/)
})
test('shared hosting gate stops after each failed stage',t=>{
  for(const step of ['build','test:unit','test:e2e']){
    const {dir,run}=isolatedDriver(t),r=run('validate.sh',[],{FAIL_STEP:step})
    assert.equal(r.status,1)
    const commands=readFileSync(join(dir,'commands'),'utf8').trim().split('\n')
    assert.equal(commands.at(-1),'npm run '+step)
  }
})
