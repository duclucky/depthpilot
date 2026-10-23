import { readFile, writeFile, rename, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
const safe=name=>/^[a-zA-Z0-9-]+\.(?:json|jsonl)$/.test(name);
export async function atomicJSON(path,data){await writeFile(path+'.tmp',JSON.stringify(data)+'\n',{flush:true});await rename(path+'.tmp',path);}
async function completeLines(path,repair=false){
 let text='';try{text=await readFile(path,'utf8');}catch(e){if(e.code==='ENOENT')return [];throw e;}
 if(text&&!text.endsWith('\n')){
  const end=text.lastIndexOf('\n')+1;
  if(repair){await writeFile(path+`.partial-${Date.now()}.txt`,text.slice(end),{flush:true});await writeFile(path+'.repair.tmp',text.slice(0,end),{flush:true});await rename(path+'.repair.tmp',path);}
  text=text.slice(0,end);
 }
 return text.split('\n').filter(Boolean);
}
export class SegmentedLog {
 constructor(directory,base,segmentSize=1000){this.directory=directory;this.base=base;this.segmentSize=segmentSize;this.indexName=base+'-index.json';}
 async open(){
  try{this.index=JSON.parse(await readFile(join(this.directory,this.indexName),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;this.index={segments:[],total:0};}
  if(!this.index.segments.length)this.index.segments.push({name:this.base+'-000000.jsonl',start:0,count:0});
  const last=this.index.segments.at(-1);if(!safe(last.name))throw Error('Unsafe log segment');
  last.count=(await completeLines(join(this.directory,last.name),true)).length;
  this.index.total=last.start+last.count;await this.flush();return this.index.total;
 }
 async flush(){await atomicJSON(join(this.directory,this.indexName),this.index);}
 async append(item){
  let segment=this.index.segments.at(-1);
  if(segment.count>=this.segmentSize){segment={name:this.base+'-'+String(this.index.segments.length).padStart(6,'0')+'.jsonl',start:this.index.total,count:0};this.index.segments.push(segment);await this.flush();}
  await appendFile(join(this.directory,segment.name),JSON.stringify(item)+'\n',{flush:true});segment.count++;this.index.total++;await this.flush();
 }
}
export async function readSegmentedLog(directory,indexName,after,limit){
 if(!safe(indexName))throw Error('Unsafe log index');
 const index=JSON.parse(await readFile(join(directory,indexName),'utf8')),entries=[];
 for(const segment of index.segments){
  if(!safe(segment.name))throw Error('Unsafe log segment');
  if(after>=segment.start+segment.count)continue;
  const lines=await completeLines(join(directory,segment.name));
  const start=Math.max(0,after-segment.start);
  for(const line of lines.slice(start,start+limit-entries.length))entries.push(JSON.parse(line));
  if(entries.length>=limit)break;
 }
 return {entries,nextCursor:after+entries.length,total:index.total};
}
