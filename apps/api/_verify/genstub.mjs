import fs from 'fs';
const sch = fs.readFileSync(process.argv[2],'utf8');
const text = sch.split('\n').map(l=>l.replace(/\/\/.*$/,'')).join('\n');
const enums={};
for(const m of text.matchAll(/enum\s+(\w+)\s*\{([^}]*)\}/g)){
  enums[m[1]]=m[2].split('\n').map(s=>s.trim()).filter(s=>s&&/^\w+$/.test(s));
}
const models={};
for(const m of text.matchAll(/model\s+(\w+)\s*\{([^}]*)\}/g)){
  const fields=[];
  for(const ln of m[2].split('\n')){const t=ln.trim();if(!t||t.startsWith('@@'))continue;
    const fm=t.match(/^(\w+)\s+([\w\[\]\?\.]+)/);if(!fm)continue;fields.push({name:fm[1],type:fm[2]});}
  models[m[1]]=fields;
}
const scalarMap={String:'string',Int:'number',BigInt:'bigint',Float:'number',Decimal:'number',Boolean:'boolean',DateTime:'Date',Json:'any',Bytes:'any'};
function tsType(t){const opt=t.endsWith('?');const arr=t.endsWith('[]');const base=t.replace(/[\?\[\]]/g,'');
  let ts=scalarMap[base]||(enums[base]?base:(models[base]?base:'any'));if(arr)ts+='[]';
  return {ts,opt,arr,base,isRel:!!models[base]};}
const o=[];
o.push('// AUTO-GENERATED field-accurate Prisma stub (typecheck only). Regen: node _verify/genstub.mjs prisma/schema.prisma _verify/stubs/@prisma/client/index.d.ts');
o.push('export namespace Prisma {');
o.push('  export class PrismaClientKnownRequestError extends Error { code: string; meta?: any; constructor(m?:string){super(m);} }');
o.push('  export class PrismaClientValidationError extends Error {}');
o.push('  export type JsonValue=any; export type InputJsonValue=any; export type JsonObject=any;');
o.push('  export type SortOrder=any; export type QueryMode=any;');
o.push('  export type TransactionClient = Omit<PrismaClient,"$transaction"|"$connect"|"$disconnect">;');
for(const n of Object.keys(models)){
  for(const suf of ['WhereInput','WhereUniqueInput','CreateInput','UncheckedCreateInput','UpdateInput','UncheckedUpdateInput','OrderByWithRelationInput','Include','Select','ScalarWhereInput','CreateManyInput','UpdateManyMutationInput']){
    o.push(`  export type ${n}${suf} = any;`);
  }
}
o.push('}');
for(const [n,vals] of Object.entries(enums)){
  o.push(`export type ${n} = ${vals.map(v=>`'${v}'`).join(' | ')};`);
  o.push(`export const ${n} = { ${vals.map(v=>`${v}: '${v}'`).join(', ')} } as const;`);
}
for(const [n,fields] of Object.entries(models)){
  o.push(`export interface ${n} {`);
  for(const f of fields){const i=tsType(f.type);
    if(i.isRel) o.push(`  ${f.name}?: ${i.ts}${i.opt?' | null':''};`);
    else o.push(`  ${f.name}: ${i.ts}${i.opt?' | null':''};`);}
  o.push('}');
  o.push(`export type ${n}Keys = ${fields.map(f=>`'${f.name}'`).join(' | ')};`);
}
o.push('type DataInput<K extends string> = { [P in K]?: any };');
o.push('type SelInc<K extends string> = { [P in K]?: any } & { _count?: any };');
o.push('type OrderInput<K extends string> = ( ({ [P in K]?: any } & {_count?:any}) | Array<{ [P in K]?: any } & {_count?:any}> );');
o.push('type IncKeys<A> = A extends { include: infer I } ? (keyof I) : (A extends { select: infer S } ? (keyof S) : never);');
o.push('type Payload<Row, A> = Row & { [K in (IncKeys<A> & keyof Row)]-?: NonNullable<Row[K]> };');
o.push('interface Delegate<Row, K extends string> {');
o.push('  findUnique<A extends {where:any;select?:SelInc<K>;include?:SelInc<K>}>(a:A):Promise<Payload<Row,A>|null>;');
o.push('  findUniqueOrThrow<A extends {where:any;select?:SelInc<K>;include?:SelInc<K>}>(a:A):Promise<Payload<Row,A>>;');
o.push('  findFirst<A extends {where?:any;select?:SelInc<K>;include?:SelInc<K>;orderBy?:OrderInput<K>;skip?:number;take?:number}>(a?:A):Promise<Payload<Row,A>|null>;');
o.push('  findMany<A extends {where?:any;select?:SelInc<K>;include?:SelInc<K>;orderBy?:OrderInput<K>;skip?:number;take?:number;distinct?:any;cursor?:any}>(a?:A):Promise<Payload<Row,A>[]>;');
o.push('  create<A extends {data:DataInput<K>;select?:SelInc<K>;include?:SelInc<K>}>(a:A):Promise<Payload<Row,A>>;');
o.push('  createMany(a:{data:DataInput<K>[]|DataInput<K>;skipDuplicates?:boolean}):Promise<{count:number}>;');
o.push('  update<A extends {where:any;data:DataInput<K>;select?:SelInc<K>;include?:SelInc<K>}>(a:A):Promise<Payload<Row,A>>;');
o.push('  updateMany(a:{where?:any;data:DataInput<K>}):Promise<{count:number}>;');
o.push('  upsert<A extends {where:any;create:DataInput<K>;update:DataInput<K>;select?:SelInc<K>;include?:SelInc<K>}>(a:A):Promise<Payload<Row,A>>;');
o.push('  delete<A extends {where:any;select?:SelInc<K>;include?:SelInc<K>}>(a:A):Promise<Payload<Row,A>>;');
o.push('  deleteMany(a?:{where?:any}):Promise<{count:number}>;');
o.push('  count(a?:{where?:any}):Promise<number>;');
o.push('  aggregate(a?:any):Promise<any>; groupBy(a?:any):Promise<any>;');
o.push('}');
o.push('export class PrismaClient {');
o.push('  constructor(...a:any[]){}');
o.push('  $connect():Promise<void>{return Promise.resolve();}');
o.push('  $disconnect():Promise<void>{return Promise.resolve();}');
o.push('  $on(...a:any[]):void{}');
o.push('  $transaction<R>(fn:(tx:Prisma.TransactionClient)=>Promise<R>, opts?:any):Promise<R>;');
o.push('  $transaction(arg:any[]):Promise<any[]>;');
o.push('  $transaction(arg:any):Promise<any>{return Promise.resolve() as any;}');
o.push('  $queryRaw(...a:any[]):Promise<any>{return Promise.resolve();}');
o.push('  $executeRaw(...a:any[]):Promise<any>{return Promise.resolve();}');
o.push('  $queryRawUnsafe(...a:any[]):Promise<any>{return Promise.resolve();}');
o.push('  $executeRawUnsafe(...a:any[]):Promise<any>{return Promise.resolve();}');
for(const n of Object.keys(models)){const prop=n.charAt(0).toLowerCase()+n.slice(1);
  o.push(`  ${prop}: Delegate<${n}, ${n}Keys> = {} as any;`);}
o.push('}');
o.push('export default PrismaClient;');
fs.writeFileSync(process.argv[3], o.join('\n'));
console.log('regen models',Object.keys(models).length);
