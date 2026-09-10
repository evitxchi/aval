import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceLab, createLab } from '../lib/agents/independence-lab.ts';
import { DEFAULT_ONBOARDING, DEFAULT_PREFERENCES, ONBOARDING_STEPS, parseOnboarding, onboardingOptions, togglePreference, upgradeStoredOnboarding } from '../lib/onboarding/preferences.ts';
import { PERSONAS, type PersonaId } from '../lib/ask-aval/personas.ts';

for (const mode of ['supervised','assisted','autonomous'] as const) {
  test(`${mode} rehearsal follows actual agent envelopes and expected approval count`, () => {
    for (const agent of Object.keys(PERSONAS) as PersonaId[]) {
      let state = advanceLab(createLab(mode,agent),'run');
      const allowed = ['general','financial','brokerage','maintenance'].includes(agent);
      if (!allowed) { assert.equal(state.status,'blocked',agent); assert.equal(state.outbox.length,0); continue; }
      if (mode !== 'autonomous') { assert.equal(state.status,'waiting'); assert.equal(state.outbox.length,0); }
      let guard = 0;
      while (state.status === 'waiting' && guard++ < 3) state = advanceLab(state,'approve');
      assert.equal(state.status,'completed',agent);
      assert.equal(state.outbox.length,2);
      assert.equal(state.approvals, mode === 'supervised' ? 2 : mode === 'assisted' ? 1 : 0);
      assert.ok(state.trace.some(e => ['sensitiveApproval','sensitiveDenied'].includes(e.event)));
      assert.deepEqual(advanceLab(state,'run'),state,'terminal runs do not duplicate effects');
    }
  });
  test(`${mode} missing evidence and unconfirmed outcomes never produce success`, () => {
    for (const scenario of ['missing','failure'] as const) {
      let state = advanceLab(createLab(mode,'general',scenario),'run');
      if (state.status === 'waiting') state = advanceLab(state,'approve');
      assert.equal(state.status,scenario === 'missing' ? 'blocked' : 'failed');
      assert.equal(state.outbox.length,0);
      assert.deepEqual(advanceLab(state,'run'),state);
    }
  });
}
test('supervised review authorizes only one exact action; rejection prevents the remainder', () => {
  let state = advanceLab(createLab('supervised','maintenance'),'run');
  state = advanceLab(state,'approve');
  assert.equal(state.outbox.length,1); assert.equal(state.status,'waiting');
  state = advanceLab(state,'cancel');
  assert.equal(advanceLab(state,'approve').outbox.length,1);
});
test('regional choices precede PMS, retain selections, and offer all apps on request', () => {
  assert.deepEqual(ONBOARDING_STEPS.slice(0,3),['language','region','pms']);
  const prefs = {...DEFAULT_PREFERENCES,region:['mx'],pms:['appfolio']};
  assert.deepEqual(onboardingOptions('pms',prefs),['easybroker','tokko','wasi','other','appfolio']);
  assert.ok(onboardingOptions('pms',prefs,true).includes('reapit'));
  assert.deepEqual(togglePreference(prefs,'region','latam').region,['latam']);
  assert.equal(parseOnboarding({...DEFAULT_ONBOARDING,preferences:{...prefs,language:['en','es-mx']}}),null);
});
test('legacy preferences retain mode, completion, revision and resume the same question', () => {
  const {language,region,...old} = DEFAULT_PREFERENCES;
  void language; void region;
  const legacy = {preferences:{...old,autonomy:['supervised']},completed:true,step:6,revision:12};
  const upgraded = parseOnboarding(upgradeStoredOnboarding(legacy as typeof DEFAULT_ONBOARDING));
  assert.ok(upgraded); assert.equal(upgraded.step,8); assert.equal(upgraded.revision,12);
  assert.equal(upgraded.completed,true); assert.deepEqual(upgraded.preferences.autonomy,['supervised']);
  assert.deepEqual(upgraded.preferences.language,[]);
});

for(const mode of ['supervised','assisted','autonomous'] as const) {
 test(`${mode} animation steps preserve approval gates and cannot replay completed effects`,()=>{
  let state=advanceLab(createLab(mode,'maintenance'),'run',1);
  if(mode!=='autonomous'){
   assert.equal(state.status,'waiting');assert.equal(state.outbox.length,0);
   assert.deepEqual(advanceLab(state,'run',1),state,'elapsed animation time cannot approve an action');
   state=advanceLab(state,'approve',1);
  }
  assert.equal(state.outbox.length,1);assert.equal(state.status,'ready');
  state=advanceLab(state,'run',1);
  if(mode==='supervised'){
   assert.equal(state.status,'waiting');assert.equal(state.outbox.length,1);
   state=advanceLab(state,'approve',1);
  }
  assert.equal(state.status,'completed');assert.equal(state.outbox.length,2);
  assert.equal(state.approvals,mode==='supervised'?2:mode==='assisted'?1:0);
  assert.deepEqual(advanceLab(state,'approve',1),state);
 });
}
test('changed assisted action in an example requires a fresh exact-plan decision',()=>{
 let state=advanceLab(createLab('assisted','maintenance'),'run',1);
 state=advanceLab(state,'approve',1);
 state.actions[1].args.body='A changed follow-up';
 state=advanceLab(state,'run',1);
 assert.equal(state.status,'waiting');assert.equal(state.outbox.length,1);
 const rejected=advanceLab(state,'cancel',1);
 assert.equal(advanceLab(rejected,'run',1).outbox.length,1);
});
