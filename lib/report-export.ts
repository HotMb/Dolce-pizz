type ReportLocation={locationId:string;name:string;locality:string;orders:number;completedRevenue:number;completed:number;cancelled:number};
type ReportChannel={channel:string;orders:number;completedRevenue:number};
type ReportPayment={method:string;payments:number;amount:number};
export type ReportExport={period:{from:string;to:string};totals:{orders:number;completedRevenue:number;completed:number;cancelled:number};locations:ReportLocation[];channels:ReportChannel[];payments:ReportPayment[]};
const cell=(value:unknown)=>`"${String(value??'').replaceAll('"','""')}"`;
const row=(values:unknown[])=>values.map(cell).join(';');
/** Excel-compatible French CSV containing aggregates only. */
export function reportCsv(report:ReportExport){
 const lines=[row(['Rapport Dolce Pizz’',`${report.period.from} → ${report.period.to}`]),row(['Type','Identifiant','Nom','Localité','Commandes','Terminées','CA encaissé (centimes)','Annulées/refusées']),row(['TOTAL','','','',report.totals.orders,report.totals.completed,report.totals.completedRevenue,report.totals.cancelled]),...report.locations.map(item=>row(['Établissement',item.locationId,item.name,item.locality,item.orders,item.completed,item.completedRevenue,item.cancelled])),row([]),row(['Type','Valeur','Commandes','CA encaissé (centimes)']),...report.channels.map(item=>row(['Canal',item.channel,item.orders,item.completedRevenue])),...report.payments.map(item=>row(['Paiement',item.method,item.payments,item.amount]))];
 return `\ufeff${lines.join('\r\n')}\r\n`;
}
