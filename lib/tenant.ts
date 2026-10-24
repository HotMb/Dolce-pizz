export type TenantContext={organizationId:string;locationId:string;host:string};
type TenantBinding={organizationId:string;locationId:string};
const pilot={organizationId:'dolce-pizza',locationId:'ronchin'} as const;
const id=/^[a-z0-9][a-z0-9_-]{0,127}$/;
// Public tenant bindings must be real DNS names. Reject empty labels, localhost,
// and the shared demo host so an operator cannot accidentally expose a pilot
// binding through a malformed production configuration.
const publicHost=/^(?=.{1,253}$)(?!localhost$)(?!.*\.dolcepizza\.workers\.dev$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function configuredBindings(raw:string):Record<string,TenantBinding>{
 if(!raw)return {};
 try{
  const value=JSON.parse(raw) as unknown;
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  const result:Record<string,TenantBinding>={};
  for(const [host,binding] of Object.entries(value as Record<string,unknown>)){
   if(!publicHost.test(host.toLowerCase())||!binding||typeof binding!=='object')continue;
   const item=binding as Record<string,unknown>;
   if(typeof item.organizationId==='string'&&id.test(item.organizationId)&&typeof item.locationId==='string'&&id.test(item.locationId))result[host.toLowerCase()]= {organizationId:item.organizationId,locationId:item.locationId};
  }
  return result;
 }catch{return {};}
}

/** Resolve a public request from the trusted URL host. Query/body tenant ids are never used here. */
export function resolveTenant(request:Request,raw=process.env.TENANT_HOSTS_JSON||''):TenantContext|null{
 const host=new URL(request.url).hostname.toLowerCase();
 const binding=configuredBindings(raw)[host];
 if(binding)return {...binding,host};
 if(host==='localhost'||host==='127.0.0.1'||host==='[::1]'||host==='dolce-pizz-demo.dolcepizza.workers.dev')return {...pilot,host};
 return null;
}
