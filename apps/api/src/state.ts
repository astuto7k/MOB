export const terminal=['ENDED','REJECTED','EXPIRED','FAILED'] as const;
export type State='REQUESTED'|'WAITING_DEVICE'|'WAITING_APPROVAL'|'APPROVED'|'CONNECTING'|'ACTIVE'|'ENDING'|typeof terminal[number];
const transitions:Record<State,State[]>={
 REQUESTED:['WAITING_DEVICE','WAITING_APPROVAL','REJECTED','EXPIRED','FAILED','ENDING'],
 WAITING_DEVICE:['WAITING_APPROVAL','REJECTED','EXPIRED','FAILED','ENDING'],
 WAITING_APPROVAL:['APPROVED','REJECTED','EXPIRED','FAILED','ENDING'],
 APPROVED:['CONNECTING','ACTIVE','ENDING','EXPIRED','FAILED'],
 CONNECTING:['ACTIVE','ENDING','EXPIRED','FAILED'],
 ACTIVE:['ENDING','EXPIRED','FAILED'], ENDING:['ENDED'], ENDED:[], REJECTED:[], EXPIRED:[], FAILED:[]
};
export const isTerminal=(state:string)=>terminal.includes(state as typeof terminal[number]);
export function assertTransition(from:State,to:State){if(!transitions[from].includes(to))throw new Error(`Invalid session transition ${from} -> ${to}`);}
export function maySignal(state:string,expiresAt:Date,revoked:boolean,now=Date.now()){return !revoked&&expiresAt.getTime()>now&&['APPROVED','CONNECTING','ACTIVE'].includes(state);}
export function mayControl(state:string,approved:boolean,expiresAt:Date,revoked:boolean,now=Date.now()){return state==='ACTIVE'&&approved&&!revoked&&expiresAt.getTime()>now;}
