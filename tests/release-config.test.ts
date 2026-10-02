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
  it.each(['compose.yaml','deploy/compose.example.yaml'])('%s requires a pinned image and omits automatic-update labels',path=>{const service=parse(readFileSync(path,'utf8')).services.coupleogames;expect(service.image).toMatch(/^\$\{COUPLEOGAMES_IMAGE:\?/);expect(service.labels).toBeUndefined();expect(service.ports.every((p:string)=>p.startsWith('127.0.0.1:'))).toBe(true);});
});

// Public templates require local settings instead of carrying a deployment map.
describe('portable container configuration',()=>{
  it.each(['compose.yaml','deploy/compose.example.yaml'])('%s requires explicit ports and private environment configuration',path=>{
    const service=parse(readFileSync(path,'utf8')).services.coupleogames;
    expect(service.environment.PORT).toMatch(/^\$\{COUPLEOGAMES_CONTAINER_PORT:\?/);
    expect(service.ports).toEqual(['127.0.0.1:${COUPLEOGAMES_BIND_PORT:?Set a loopback port}:${COUPLEOGAMES_CONTAINER_PORT:?Set the app port}']);
    expect([service.env_file].flat()).toEqual(['${COUPLEOGAMES_ENV_FILE:?Set a private environment file}']);
    expect(service.labels).toBeUndefined();
  });
  it('the bind-mount example takes storage and runtime identity from private configuration',()=>{
    const service=parse(readFileSync('deploy/compose.example.yaml','utf8')).services.coupleogames;
    expect(service.user).toBe('${COUPLEOGAMES_UID:?Set a non-root user ID}:${COUPLEOGAMES_GID:?Set a group ID}');
    expect(service.volumes).toEqual(['${COUPLEOGAMES_DATA_DIR:?Set a local data directory}:/app/data']);
  });
  it('the image health check follows the configured application port',()=>{
    const dockerfile=readFileSync('Dockerfile','utf8');
    expect(dockerfile.split('\n').find(line=>line.startsWith('HEALTHCHECK'))).toContain('process.env.PORT');
  });
});