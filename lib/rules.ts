export type Settings={enabled:boolean;hoursConfirmed:boolean;leadMinutes:number;cutoffMinutes:number;capacity:number;hours:{open:string;close:string;closed:boolean}[];closures:string[];loyaltyEnabled:boolean;pointsPerEuro:number;rewardPoints:number;extraPrice:number;version:number};
export const defaultSettings:Settings={enabled:true,hoursConfirmed:false,leadMinutes:30,cutoffMinutes:15,capacity:4,hours:[{open:'11:30',close:'00:00',closed:false},{open:'18:00',close:'23:00',closed:false},...Array.from({length:4},()=>({open:'18:00',close:'00:00',closed:false})),{open:'11:30',close:'00:00',closed:false}],closures:[],loyaltyEnabled:false,pointsPerEuro:1,rewardPoints:100,extraPrice:150,version:1};
const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'});
export function parisParts(instant:number){const p=Object.fromEntries(fmt.formatToParts(new Date(instant)).map(v=>[v.type,v.value]));return {date:`${p.year}-${p.month}-${p.day}`,minute:Number(p.hour)*60+Number(p.minute),day:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday)};}
export const minutes=(s:string)=>Number(s.slice(0,2))*60+Number(s.slice(3));
export function allowedSlot(instant:number,settings:Settings,now=Date.now()):boolean{
 if(!settings.enabled||!settings.hoursConfirmed||!Number.isFinite(instant)||instant<now+settings.leadMinutes*60000||instant>now+7*86400000||instant%900000!==0)return false;
 const p=parisParts(instant);if(settings.closures.includes(p.date))return false;
 const h=settings.hours[p.day];const start=minutes(h.open);const end=minutes(h.close)||1440;
 return !h.closed&&p.minute>=start&&p.minute<=end-settings.cutoffMinutes;
}
export function slots(settings:Settings,counts:Record<string,number>={},now=Date.now()){
 const result:{iso:string;date:string;label:string;remaining:number}[]=[];
 const first=Math.ceil((now+settings.leadMinutes*60000)/900000)*900000;
 for(let t=first;t<=now+7*86400000;t+=900000){const iso=new Date(t).toISOString();if(allowedSlot(t,settings,now)&&(counts[iso]||0)<settings.capacity){const p=parisParts(t);result.push({iso,date:p.date,label:`${Math.floor(p.minute/60).toString().padStart(2,'0')}:${(p.minute%60).toString().padStart(2,'0')}`,remaining:settings.capacity-(counts[iso]||0)});}}
 return result;
}
export const transitions:Record<string,string[]>={pending:['confirmed','preparing','rejected','cancelled'],confirmed:['preparing','cancelled'],preparing:['ready','cancelled'],ready:['completed','cancelled'],completed:[],rejected:[],cancelled:[]};
export function nextStatus(current:string,next:string){return transitions[current]?.includes(next)||false;}
