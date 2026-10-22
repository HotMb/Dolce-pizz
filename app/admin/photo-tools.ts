// Same treatment as scripts/optimize-photos.mjs, done on the tablet: find the pizza on its dark background,
// centre it in a square, cut it out as a soft-edged disc and export 320/640/1024 px WebP files.
export type Crop={cx:number;cy:number;r:number};
export type Detection={crop:Crop;warnings:string[]};
export const PHOTO_WIDTHS=[320,640,1024] as const;
const THRESHOLD=48,MAX_BYTES=1900000;

export async function loadImage(file:File){
 if(!file.type.startsWith('image/'))throw new Error('Choisissez une photo (JPG, PNG, WebP ou HEIC).');
 const url=URL.createObjectURL(file);const img=new Image();img.decoding='async';img.src=url;
 try{await img.decode();}catch{URL.revokeObjectURL(url);throw new Error('Cette photo ne peut pas être lue sur cet appareil. Essayez un JPG ou un PNG.');}
 return img;
}
export function detect(img:HTMLImageElement):Detection{
 const scale=Math.min(1,800/Math.max(img.naturalWidth,img.naturalHeight));const w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale));
 const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d',{willReadFrequently:true})!;g.drawImage(img,0,0,w,h);
 const d=g.getImageData(0,0,w,h).data;const lum=(x:number,y:number)=>{const i=(y*w+x)*4;return .299*d[i]+.587*d[i+1]+.114*d[i+2];};
 let x0=w,y0=h,x1=0,y1=0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(lum(x,y)>THRESHOLD){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
 const warnings:string[]=[];const corner=(cx:number,cy:number)=>{let s=0;for(let y=0;y<8;y++)for(let x=0;x<8;x++)s+=lum(Math.min(w-1,cx+x),Math.min(h-1,cy+y));return s/64;};
 const bright=[corner(0,0),corner(w-8,0),corner(0,h-8),corner(w-8,h-8)].filter(v=>v>THRESHOLD).length;
 if(x1<=x0||y1<=y0)return {crop:{cx:img.naturalWidth/2,cy:img.naturalHeight/2,r:Math.min(img.naturalWidth,img.naturalHeight)/2.1},warnings:['Aucune pizza détectée : la photo est trop sombre. Ajustez le cadrage à la main.']};
 if(bright>=2)warnings.push('Le fond n’est pas noir : le détourage automatique sera imprécis. Ajustez le cercle, ou reprenez la photo sur un fond noir mat.');
 const ratio=(x1-x0)/(y1-y0);if(!bright&&(ratio<.9||ratio>1.1))warnings.push('La pizza ne paraît pas ronde : vérifiez qu’elle est photographiée bien à la verticale.');
 if(!bright&&(x0<=1||y0<=1||x1>=w-2||y1>=h-2))warnings.push('La pizza touche le bord de la photo : la partie coupée apparaîtra noire.');
 const r=((x1-x0)+(y1-y0))/4/scale;if(r*2<700)warnings.push('Photo de petite taille : elle sera un peu floue sur grand écran.');
 return {crop:bright>=2?{cx:img.naturalWidth/2,cy:img.naturalHeight/2,r:Math.min(img.naturalWidth,img.naturalHeight)/2.1}:{cx:(x0+x1)/2/scale,cy:(y0+y1)/2/scale,r},warnings};
}
/** The cut-out pizza on a transparent square of `size` px. */
export function render(img:HTMLImageElement,crop:Crop,size:number){
 const c=document.createElement('canvas');c.width=c.height=size;const g=c.getContext('2d')!;
 const half=crop.r*1.02,s=size/(half*2);
 g.fillStyle='#000';g.fillRect(0,0,size,size);g.imageSmoothingQuality='high';
 g.setTransform(s,0,0,s,size/2-crop.cx*s,size/2-crop.cy*s);g.drawImage(img,0,0);g.setTransform(1,0,0,1,0,0);
 // Feathered disc: opaque inside the crust, fading over the last 4.5 %, like the photo script.
 const mask=g.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);mask.addColorStop(.955,'#fff');mask.addColorStop(1,'rgba(255,255,255,0)');
 g.globalCompositeOperation='destination-in';g.fillStyle=mask;g.fillRect(0,0,size,size);g.globalCompositeOperation='source-over';
 return c;
}
const blob=(c:HTMLCanvasElement,type:string,quality?:number)=>new Promise<Blob|null>(res=>c.toBlob(res,type,quality));
/** WebP when the browser can encode it, PNG otherwise (older Safari); a file too heavy for storage is left out. */
export async function exportPhoto(img:HTMLImageElement,crop:Crop){
 const master=render(img,crop,1024);const files:{width:number;blob:Blob}[]=[];
 for(const width of PHOTO_WIDTHS){
  let c=master;if(width<1024){c=document.createElement('canvas');c.width=c.height=width;const g=c.getContext('2d')!;g.imageSmoothingQuality='high';g.drawImage(master,0,0,width,width);}
  let b=await blob(c,'image/webp',width>640?.84:.8);if(!b||b.type!=='image/webp')b=await blob(c,'image/png');
  if(b&&b.size<=MAX_BYTES)files.push({width,blob:b});
 }
 if(!files.some(f=>f.width===320)||!files.some(f=>f.width===640))throw new Error('La photo n’a pas pu être préparée sur cet appareil. Essayez depuis un autre navigateur.');
 return files;
}
export async function uploadPhoto(productId:string,files:{width:number;blob:Blob}[]){
 const form=new FormData();for(const f of files)form.append(`w${f.width}`,f.blob,`${productId}-${f.width}.${f.blob.type==='image/png'?'png':'webp'}`);
 const r=await fetch(`/api/admin/products/${encodeURIComponent(productId)}/photo`,{method:'POST',body:form,signal:AbortSignal.timeout(60000)}).catch(()=>null);
 const data=await r?.json().catch(()=>null) as {error?:string;product?:unknown}|null;
 if(!r?.ok)throw new Error(data?.error||'La photo n’a pas pu être envoyée. Vérifiez la connexion puis réessayez.');
 return data?.product;
}
