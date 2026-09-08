import { providerJson, record, requiredString, safeSegment } from '@/lib/integrations/http';
export async function publishMetaPost(pageId:string,body:string,token:string,version:string) {
  if (!/^v\d+\.\d+$/.test(version) || !body.trim() || body.length>4000) throw new Error('A configured Meta API version and a post of at most 4,000 characters are required.');
  const result = record(await providerJson(`https://graph.facebook.com/${version}/${safeSegment(pageId)}/feed`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({message:body})}));
  return {id:requiredString(result.id),status:'accepted' as const};
}
export async function metaLeadPage(pageId:string,token:string,version:string,formId?:string,after?:string) {
  if (!/^v\d+\.\d+$/.test(version)) throw new Error('Configure the Meta Graph API version.');
  const headers={authorization:`Bearer ${token}`};
  const query=new URLSearchParams({fields:formId?'id,created_time,field_data':'id,name',limit:'25'});
  if(after) query.set('after',after);
  const resource=formId?`${safeSegment(formId)}/leads`:`${safeSegment(pageId)}/leadgen_forms`;
  const data=record(await providerJson(`https://graph.facebook.com/${version}/${resource}?${query}`,{headers}));
  if (!Array.isArray(data.data)) throw new Error('Meta returned an invalid lead page.');
  const paging=data.paging as {next?:unknown;cursors?:{after?:unknown}}|undefined;
  return {items:data.data,next:paging?.next && typeof paging.cursors?.after==='string'?paging.cursors.after:null};
}
