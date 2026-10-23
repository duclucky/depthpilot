import {readFile,writeFile,readdir,lstat} from 'node:fs/promises';import {join} from 'node:path';import {deflateRawSync,crc32} from 'node:zlib';
// A bounded ZIP32 writer avoids invoking an interactive archiver during packaging.
export async function zipDirectory(folder,rootName,destination){
 const locals=[],central=[];let offset=0,count=0;
 async function walk(directory,prefix=''){
  for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   const path=join(directory,entry.name),name=prefix+entry.name,stat=await lstat(path);if(stat.isSymbolicLink())throw Error('A release cannot contain links.');if(entry.isDirectory()){await walk(path,name+'/');continue;}
   const data=await readFile(path),compressed=deflateRawSync(data,{level:6}),filename=Buffer.from(rootName+'/'+name),checksum=crc32(data);
   if(data.length>=0xffffffff||offset+compressed.length>=0xffffffff||count>=65535)throw Error('Release exceeds ZIP32 limits.');
   const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt16LE(23585,12);local.writeUInt32LE(checksum,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(filename.length,26);
   locals.push(local,filename,compressed);
   const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt16LE(8,10);record.writeUInt16LE(23585,14);record.writeUInt32LE(checksum,16);record.writeUInt32LE(compressed.length,20);record.writeUInt32LE(data.length,24);record.writeUInt16LE(filename.length,28);record.writeUInt32LE(offset,42);central.push(record,filename);offset+=local.length+filename.length+compressed.length;count++;
  }
 }
 await walk(folder);const centralBytes=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(centralBytes.length,12);end.writeUInt32LE(offset,16);await writeFile(destination,Buffer.concat([...locals,centralBytes,end]));
}
