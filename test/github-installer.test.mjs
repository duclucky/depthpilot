import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile,access} from 'node:fs/promises';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),cache=join(root,'.cache');
test('PowerShell bootstrap rejects an altered archive before creating an install or download folder',{skip:process.platform!=='win32'},async()=>{
 await mkdir(cache,{recursive:true});const home=await mkdtemp(join(cache,'github-bad-')),archive=join(home,'changed.zip'),destination=join(home,'app'),downloads=join(home,'downloads');await writeFile(archive,'not the tested release');
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',join(root,'Install-DepthPilot.ps1'),'-ArchivePath',archive,'-Destination',destination,'-DownloadDirectory',downloads,'-NoLaunch','-NoShortcut'],{encoding:'utf8',windowsHide:true,timeout:20000});
 assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/SHA-256 check failed/);await assert.rejects(access(destination));await assert.rejects(access(downloads));
});
test('PowerShell bootstrap rejects a missing offline archive without touching destination',{skip:process.platform!=='win32'},async()=>{
 await mkdir(cache,{recursive:true});const home=await mkdtemp(join(cache,'github-missing-')),destination=join(home,'app');
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',join(root,'Install-DepthPilot.ps1'),'-ArchivePath',join(home,'missing.zip'),'-Destination',destination,'-NoLaunch','-NoShortcut'],{encoding:'utf8',windowsHide:true,timeout:20000});
 assert.notEqual(result.status,0);await assert.rejects(access(destination));
});
test('README and saved bootstrap pin the same immutable published archive independently of a local candidate version',async()=>{
 const bootstrap=await readFile(join(root,'Install-DepthPilot.ps1'),'utf8');
 const version=bootstrap.match(/\$DepthPilotVersion = '(\d+\.\d+\.\d+)'/)?.[1];assert.ok(version);
 const sums=await readFile(join(root,'SHA256SUMS.txt'),'utf8'),expected=sums.split(/\r?\n/).find(x=>x.endsWith(`  DepthPilot-${version}-windows-x64.zip`))?.split(/\s+/)[0];assert.match(expected,/^[a-f0-9]{64}$/);
 for(const file of ['README.md','Install-DepthPilot.ps1']){const body=await readFile(join(root,file),'utf8');assert.equal(body.match(/\$DepthPilotSHA256 = '([a-f0-9]{64})'/)?.[1],expected);assert.ok(body.includes(`https://github.com/duclucky/depthpilot/releases/download/v${version}/DepthPilot-${version}-windows-x64.zip`));assert.doesNotMatch(body,/ExecutionPolicy\s+Bypass|Invoke-Expression/);}
});
