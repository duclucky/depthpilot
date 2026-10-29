import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {randomBytes,createHash} from 'node:crypto';
import {Gateway} from './gateway.mjs';import {LocalService} from './service.mjs';import {APP_VERSION,runtimeHome,initializeHome,claimLock,writeJSON} from './runtime.mjs';
import {MarketLab} from './market-lab.mjs';
import {SessionLibrary} from './session-library.mjs';
import {planTemplate,readTemplate} from './plan-template.mjs';
export async function startServer({home=runtimeHome(),port=Number(process.env.PORT??4320),gateway=new Gateway(),recover=true,gasBridge}={}){
 await initializeHome(home);const release=await claimLock(join(home,'.data','server.lock'));
 const service=new LocalService(home,gateway,gasBridge);await service.initialize();
 const marketLab=new MarketLab(gateway),library=new SessionLibrary(home);
 const token=randomBytes(32).toString('hex'),instanceId=randomBytes(16).toString('hex'),homeId=createHash('sha256').update(home.toLowerCase()).digest('hex');
 const publicRoot=join(dirname(fileURLToPath(import.meta.url)),'..','public');let origin,queue=Promise.resolve();
 const staticFiles=new Map([['/',['index.html','text/html']],['/app.mjs',['app.mjs','text/javascript']],['/workbench.mjs',['workbench.mjs','text/javascript']],['/style.css',['style.css','text/css']]]);
 const server=createServer(async(req,res)=>{
  const respond=(status,data,type='application/json')=>{res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"});res.end(typeof data==='string'||Buffer.isBuffer(data)?data:JSON.stringify(data));};
  try{
   if(req.headers.host!==new URL(origin).host){respond(403,{error:'Open DepthPilot using its local shortcut.'});return;}
   const url=new URL(req.url,origin);
   if(req.method==='GET'){
    if(req.headers['sec-fetch-site']==='cross-site'&&url.pathname.startsWith('/api/')){respond(403,{error:'Open the local dashboard directly.'});return;}
    if(url.pathname==='/api/health'){respond(200,{app:'depthpilot',version:APP_VERSION,instanceId,homeId,pid:process.pid});return;}
    if(url.pathname==='/api/session'){respond(200,{token});return;}
    if(url.pathname==='/api/status'){respond(200,await service.snapshot());return;}
    if(url.pathname==='/api/market'){respond(200,await marketLab.inspect());return;}
    if(url.pathname==='/api/history'){respond(200,await library.list(Number(url.searchParams.get('offset')||0)));return;}
    if(url.pathname==='/api/report'){respond(200,await library.report(url.searchParams.get('id')));return;}
    if(url.pathname==='/api/history/template'){respond(200,await library.template(url.searchParams.get('id')));return;}
    if(url.pathname==='/api/history/activity'){respond(200,await library.activity(url.searchParams.get('id'),Number(url.searchParams.get('after')||0)));return;}
    if(url.pathname==='/api/gas'){const next=queue.catch(()=>{}).then(()=>service.gasBridge.status());queue=next;respond(200,await next);return;}
    if(url.pathname==='/api/activity'){const after=Number(url.searchParams.get('after')||0);if(!Number.isSafeInteger(after)||after<0)throw Error('Invalid activity page.');respond(200,await service.activity(after));return;}
    const file=staticFiles.get(url.pathname);if(file){respond(200,await readFile(join(publicRoot,file[0])),file[1]);return;}
    respond(404,{error:'Page not found.'});return;
   }
   if(req.method!=='POST'){respond(405,{error:'Method not allowed.'});return;}
   if(req.headers.origin!==origin||req.headers['x-depthpilot-token']!==token||req.headers['content-type']?.split(';')[0]!=='application/json'){respond(403,{error:'Refresh the local dashboard before continuing.'});return;}
   let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>16384)throw Error('This request is too large.');chunks.push(chunk);}
   const body=JSON.parse(Buffer.concat(chunks).toString()||'{}');
   // Read-only workbench calls never occupy the trading-control queue or write authority.
   if(url.pathname==='/api/preview'){respond(200,await marketLab.preview(body));return;}
   if(url.pathname==='/api/templates/export'){respond(200,planTemplate(body));return;}
   if(url.pathname==='/api/templates/import'){respond(200,{settings:readTemplate(body)});return;}
   const operation=async()=>{
    if(url.pathname==='/api/operator')return service.createOperator();
    if(url.pathname==='/api/gas/review')return service.reviewGas();
    if(url.pathname==='/api/gas/send')return service.sendGas(body.reviewId,body.confirmed);
    if(url.pathname==='/api/account')return service.saveOwner(body.owner);
    if(url.pathname==='/api/review')return service.review(body);
    if(url.pathname==='/api/start')return service.start(body.reviewId,body.confirmed,body.recover);
    if(url.pathname==='/api/stop')return service.stop();
    if(url.pathname==='/api/quit'){if(await service.isActive())throw Error('Stop your plan and check its final position before closing the local app.');return {closing:true};}
    throw Error('This action is unavailable.');
   };
   const next=queue.catch(()=>{}).then(operation);queue=next;respond(200,await next);if(url.pathname==='/api/quit')setTimeout(()=>close().catch(()=>{}),200);
  }catch(e){const message=e.name==='SyntaxError'?'Please refresh and try again.':e.shortMessage?'The network could not complete this check. Try again.':String(e.message).slice(0,400);respond(400,{error:message});}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);}).catch(async e=>{if(e.code!=='EADDRINUSE')throw e;await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});});
 origin=`http://127.0.0.1:${server.address().port}`;
 await writeJSON(join(home,'.data','instance.json'),{app:'depthpilot',version:APP_VERSION,url:origin,instanceId,homeId,pid:process.pid});
 if(recover)await service.recover();
 const close=async()=>{await new Promise(resolve=>server.close(resolve));await gateway.close();await release();};
 return {server,service,origin,close};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const app=await startServer();console.log(`DepthPilot is ready at ${app.origin}`);
 process.on('SIGINT',()=>app.close().then(()=>process.exit()));process.on('SIGTERM',()=>app.close().then(()=>process.exit()));
}
