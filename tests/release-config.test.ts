import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parse } from 'yaml';
const workflow=()=>parse(readFileSync('.github/workflows/coupleogames.yml','utf8'));
function allows(condition:string,event:string,ref:string,enabled:string|undefined,publish=true,result='success'):boolean {
  const expression=condition.replace(/^\s*\$\{\{\s*|\s*\}\}\s*$/g,'');
  return Boolean(runInNewContext(expression,{github:{event_name:event,ref},vars:{COUPLEOGAMES_RELEASE_ENABLED:enabled},inputs:{publish},needs:{verify:{result}}},{timeout:100}));
}
describe('release remains held',()=>{
  it('main pushes and pull requests cannot publish even when release settings are enabled',()=>{const w=workflow();expect(w.on.push.branches).toContain('main');expect(w.on.pull_request.branches).toContain('main');for(const event of ['push','pull_request'])expect(allows(w.jobs.publish.if,event,'refs/heads/main','true')).toBe(false);});
  it('publication requires deliberate dispatch, enabled release, verified main commit and protected environment',()=>{
    const w=workflow();const job=w.jobs.publish;expect(allows(job.if,'workflow_dispatch','refs/heads/main',undefined)).toBe(false);expect(allows(job.if,'workflow_dispatch','refs/heads/main','false')).toBe(false);expect(allows(job.if,'workflow_dispatch','refs/heads/main','true',false)).toBe(false);expect(allows(job.if,'workflow_dispatch','refs/heads/feature','true')).toBe(false);expect(allows(job.if,'workflow_dispatch','refs/heads/main','true',true,'failure')).toBe(false);expect(allows(job.if,'workflow_dispatch','refs/heads/main','true')).toBe(true);
    expect(job.needs).toBe('verify');expect(job.environment).toBe('coupleogames-release');expect(w.on.workflow_dispatch.inputs.publish.default).toBe(false);expect(w.permissions.packages).toBeUndefined();expect(job.permissions.packages).toBe('write');
    const metadata=job.steps.find((s:any)=>s.uses?.startsWith('docker/metadata-action'));expect(metadata.with.flavor).toBe('latest=false');expect(metadata.with.tags.trim()).toBe('type=sha,format=long,prefix=sha-');
  });
  it.each(['compose.yaml','deploy/coupleogames-truenas.yaml'])('%s requires a pinned image and disables Watchtower updates',path=>{const service=parse(readFileSync(path,'utf8')).services.coupleogames;expect(service.image).toMatch(/^\$\{COUPLEOGAMES_IMAGE:\?/);expect(service.labels?.['com.centurylinklabs.watchtower.enable']).not.toBe('true');expect(service.ports.every((p:string)=>p.startsWith('127.0.0.1:'))).toBe(true);});
});
