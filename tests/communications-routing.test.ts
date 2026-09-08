import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COMMUNICATIONS, parseCommunicationsConfig, selectTeam, voiceResponse } from '../lib/communications/config.ts';
import { verifyTwilio } from '../lib/communications/signature.ts';
import { autonomyApproval } from '../lib/agents/autonomy.ts';
import { getTool } from '../lib/agents/registry.ts';
const config={...DEFAULT_COMMUNICATIONS,enabled:true,fromNumber:'+14155550100',fallbackNumber:'+14155550101',routes:[{id:'maintenance',label:'Maintenance & repairs',phone:'+14155550102',keywords:['leak','repair']}]};
test('speech and keypad routing use configured destinations and escape markup',()=>{
 assert.equal(selectTeam(config,'There is a leak','')?.id,'maintenance');assert.equal(selectTeam(config,'','1')?.id,'maintenance');
 assert.match(voiceResponse(config,'https://aval.test/voice?connection=x','leak'),/Maintenance &amp; repairs/);
 assert.match(voiceResponse(config,'https://aval.test/voice?connection=x','leak'),/\+14155550102/);
 assert.match(voiceResponse(config,'https://aval.test/voice?connection=x','','','no-answer','dial'),/\+14155550101/);
 assert.doesNotMatch(voiceResponse(config,'https://aval.test/voice?connection=x','','','no-answer','fallback'),/<Dial/);
 assert.match(voiceResponse(config,'https://aval.test/voice?connection=x'),/actionOnEmptyResult="true"/);
 assert.throws(()=>parseCommunicationsConfig({...config,fallbackNumber:config.fromNumber}),/own number/);
});
test('publication and money gates survive autonomous mode',()=>{
 assert.equal(autonomyApproval(getTool('send_external_message')!,'autonomous',false),null);
 assert.match(autonomyApproval(getTool('publish_listing')!,'autonomous',true)!,/always requires/);
 assert.match(autonomyApproval(getTool('issue_payment')!,'autonomous',true)!,/always requires/);
});
test('Twilio signature binds the exact public URL and body',async()=>{
 const url='https://aval.test/voice?connection=one',raw='AccountSid=ACtest&CallSid=CAtest',token='test-secret';
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(token),{name:'HMAC',hash:'SHA-1'},false,['sign']);
 const signed=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(url+'AccountSidACtestCallSidCAtest')))));
 const request=(address:string)=>new Request(address,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':signed},body:raw});
 assert.equal(await verifyTwilio(request(url),raw,token),true);
 assert.equal(await verifyTwilio(request(url.replace('one','two')),raw,token),false);
 assert.equal(await verifyTwilio(request(url),raw.replace('CAtest','CAother'),token),false);
});
