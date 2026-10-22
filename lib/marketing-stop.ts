const base64url=(bytes:Uint8Array)=>btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

export async function createMarketingStopProof(phone:string,key:string){
 const cryptoKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=new Uint8Array(await crypto.subtle.sign('HMAC',cryptoKey,new TextEncoder().encode(`dolce:marketing:stop:v1:${phone}`)));
 return base64url(signature.slice(0,16));
}

export async function matchesMarketingStopProof(phone:string,key:string,supplied:string){
 if(!/^[A-Za-z0-9_-]{22}$/.test(supplied)||!key)return false;
 const expected=await createMarketingStopProof(phone,key);
 let difference=0;
 for(let i=0;i<expected.length;i++)difference|=expected.charCodeAt(i)^supplied.charCodeAt(i);
 return difference===0;
}
