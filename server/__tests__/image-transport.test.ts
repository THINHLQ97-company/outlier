import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { isPublicImageIp, requestPinnedImage } from "../services/image-transport";

test("transport rejects private/reserved IPv4, IPv6 link-local and mapped", () => {
  for (const ip of ["127.0.0.1","10.0.0.1","169.254.169.254","100.100.100.200","192.168.1.1","0.0.0.0","224.0.0.1","::1","fe80::1","fc00::1","::ffff:8.8.8.8","::ffff:127.0.0.1","2001:db8::1","2002:0808:0808::1"]) assert.equal(isPublicImageIp(ip),false,ip);
  for(const ip of ["8.8.8.8","1.1.1.1","2606:4700:4700::1111"]) assert.equal(isPublicImageIp(ip),true,ip);
});
test("all DNS answers checked: one private AAAA rejects otherwise public A",async()=>{
 let connected=false;
 await assert.rejects(requestPinnedImage("https://cdn.example/a",new AbortController().signal,{async resolve(){return [{address:"8.8.8.8",family:4},{address:"fe80::1",family:6}];},async connect(){connected=true;return {} as IncomingMessage;}}));
 assert.equal(connected,false);
});
test("DNS rebinding cannot alter pinned connect IP, Host and SNI preserved",async()=>{
 let resolves=0;
 await requestPinnedImage("https://cdn.example/a",new AbortController().signal,{
  async resolve(){resolves++;return [{address:resolves===1?"8.8.8.8":"127.0.0.1",family:4}];},
  async connect(url,opts){
   assert.equal(url.hostname,"cdn.example");assert.equal(opts.servername,"cdn.example");assert.equal((opts.headers as any).Host,"cdn.example");assert.equal(opts.agent,false);
   await new Promise<void>((resolve,reject)=>(opts.lookup as Function)("cdn.example",{},(err:any,ip:string,family:number)=>{try{assert.equal(err,null);assert.equal(ip,"8.8.8.8");assert.equal(family,4);resolve();}catch(e){reject(e);}}));
   return {} as IncomingMessage;
  }
 });
 assert.equal(resolves,1);
});
test("blocked literals and credentials never resolve/connect",async()=>{
 let calls=0;
 for(const url of ["http://[::ffff:7f00:1]/a","http://169.254.169.254/a","http://user:pass@example.com/a"]){
 await assert.rejects(requestPinnedImage(url,new AbortController().signal,{async resolve(){calls++;return [];},async connect(){calls++;return {} as IncomingMessage;}}));
 }assert.equal(calls,0);
});

import { Readable } from "node:stream";
import { cacheRemoteImage } from "../services/thumb-cache";
import { storage } from "../storage";
import { createRepairScanner, createRepairUpdater, repairExpiringImagesWith } from "../services/image-repair-job";
function response(status: number, body: Buffer, type = "image/jpeg") {
 const stream = Readable.from([body]) as unknown as IncomingMessage;
 stream.statusCode = status; stream.headers = { "content-type":type };return stream;
}
test("downloader rejects redirects, fake MIME, cap overflow; stores only verified bytes", async t=>{
 let writes=0;t.mock.method(storage,"put",async()=>{writes++;});
 for(const res of [response(302,Buffer.from("redirect")),response(200,Buffer.from("<svg>")),response(200,Buffer.alloc(4*1024*1024+1))]) {
  assert.equal(await cacheRemoteImage("https://cdn.example/a","misc",undefined,async()=>res),null);
 }
 assert.equal(writes,0);
 const result=await cacheRemoteImage("https://cdn.example/a","misc",undefined,async()=>response(200,Buffer.from("ffd8ffe00000","hex")));
 assert.match(result!,/^\/api\/files\/misc\//);assert.equal(writes,1);
});
test("scanner uses native uuid keyset, skips fake-host page, rotates and pages", async()=>{
 const queries:{sql:string,args:unknown[]}[]=[];let firstSource=true;
 const scan=createRepairScanner(async(sql,args)=>{queries.push({sql,args});
  if(sql.includes("image_pending_updates")) return {rows:[]};
  assert.match(sql,/ORDER BY t\.id/);assert.doesNotMatch(sql,/ORDER BY t\.id::text/);assert.equal(args[2],100);
  if(firstSource){firstSource=false;return {rows:[{id:"00000000-0000-0000-0000-000000000001",ord:0,url:"https://fbcdn.net.attacker.test/a"}]};}
  return {rows:[]};});
 assert.equal((await scan(30)).length,0);
 await scan(30);
 assert.match(queries[1].sql,/FROM watched_channels/);
 const second=queries.slice(8).find(q=>q.sql.includes("FROM watched_channels"));
 assert.equal(second?.args[0],"00000000-0000-0000-0000-000000000001");
});
test("budget expiry commits processed images only; next run resumes the rest", async()=>{
 const ids=Array.from({length:30},(_,i)=>`00000000-0000-0000-0000-${String(i+1).padStart(12,"0")}`);
 const scan=createRepairScanner(async(sql,args)=>{
  if(sql.includes("image_pending_updates")) return {rows:[]};
  if(!sql.includes("FROM watched_channels")) return {rows:[]};
  return {rows:ids.filter(id=>id>String(args[0])).map(id=>({id,ord:0,url:`https://a.fbcdn.net/${id}`}))};
 });
 let clock=0;const seen:string[]=[];
 const deps={find:scan,commit:scan.commit,now:()=>clock,async keep(url:string){seen.push(url);clock+=5_000;return {url,outcome:"failed" as const};},async update(){return false;}};
 assert.equal((await repairExpiringImagesWith(deps,30)).checked,3);
 clock=0;
 const r=await repairExpiringImagesWith(deps,30);
 assert.equal(r.checked,3);
 assert.deepEqual(seen.map(x=>x.slice(-2)),["01","02","03","04","05","06"]);
});
test("pending durable replacement consumes exact source only after update and counts only affected rows", async()=>{
 let sql="";let args:unknown[]=[];
 const update=createRepairUpdater(async(q,a)=>{sql=q;args=a;return {rows:[],rowCount:0};});
 assert.equal(await update({table:"brand_fanpages",column:"meta_picture_url",id:"00000000-0000-0000-0000-000000000001",url:"https://a.fbcdn.net/new",pendingId:"00000000-0000-0000-0000-000000000009"},"/api/files/misc/new.jpg"),false);
 assert.match(sql,/WHERE p.id=\$1::uuid AND p.source_url=\$2/);
 assert.match(sql,/DELETE FROM image_pending_updates p USING pending,updated/);
 assert.ok(sql.indexOf("UPDATE brand_fanpages SET") < sql.indexOf("DELETE FROM image_pending_updates"));
 assert.match(sql,/EXISTS \(SELECT 1 FROM pending\)/);assert.deepEqual(args.slice(0,3),["00000000-0000-0000-0000-000000000009","https://a.fbcdn.net/new","/api/files/misc/new.jpg"]);
});
test("sync SQL keeps internal image if repair commits concurrently", async()=>{
 const {PgDialect}=await import("drizzle-orm/pg-core");const {sql}=await import("drizzle-orm");const {durableImageWrite,durableStatsWrite}=await import("../services/image-write");
 const q=new PgDialect().sqlToQuery(durableImageWrite(sql.raw("current_col"),"https://a.fbcdn.net/stale"));
 assert.match(q.sql,/WHEN current_col LIKE '\/api\/files\/%' THEN current_col/);
 const j=new PgDialect().sqlToQuery(durableStatsWrite(sql.raw("current_json"),{topPosts:[{id:"p",thumbnailUrl:"https://a.fbcdn.net/stale"}]}));
 assert.match(j.sql,/current_json\)->'topPosts'/);assert.match(j.sql,/value->>'id'=n\.value->>'id'/);
});

import { writeThenQueue } from "../services/durable-images";
import { cleanupPendingImages } from "../services/image-repair-job";
test("business write completes before pending SQL, atomically in same transaction", async()=>{
 const events:string[]=[];
 const tx:any={async execute(){events.push("queue");},async transaction(fn:Function){events.push("savepoint");return fn(tx);}};
 const db:any={async transaction(fn:Function){events.push("begin");const r=await fn(tx);events.push("commit");return r;}};
 const pending=[{target:{table:"brand_fanpages" as const,column:"meta_stats_json" as const,id:"00000000-0000-0000-0000-000000000001",postId:"post1"},url:"https://a.fbcdn.net/new"}];
 assert.equal(await writeThenQueue(db,async(current)=>{assert.equal(current,tx);events.push("write");return true;},pending),true);
 assert.deepEqual(events,["begin","write","savepoint","queue","commit"]);
 events.length=0;
 assert.equal(await writeThenQueue(db,async()=>{events.push("write0");return false;},pending),false);
 assert.deepEqual(events,["begin","write0","commit"]);
 events.length=0;
 await assert.rejects(writeThenQueue(db,async()=>{events.push("writeFail");throw Error("write fail");},pending));
 assert.deepEqual(events,["begin","writeFail"]);
});
test("JSON pending update requires exact brand_fanpages target and an existing post", async()=>{
 let queries=0;let statement="";
 const update=createRepairUpdater(async(q)=>{queries++;statement=q;return {rows:[],rowCount:0};});
 const c={table:"fanpage_posts",column:"meta_stats_json",id:"00000000-0000-0000-0000-000000000001",postId:"post1",pendingId:"00000000-0000-0000-0000-000000000009",url:"https://a.fbcdn.net/new"};
 assert.equal(await update(c,"/api/files/misc/new.jpg"),false);assert.equal(queries,0);
 assert.equal(await update({...c,table:"brand_fanpages"},"/api/files/misc/new.jpg"),false);
 assert.match(statement,/x->>'id'=\$3/);
 assert.match(statement,/RETURNING t.id/);
 assert.match(statement,/DELETE FROM image_pending_updates p USING pending, updated/);
 assert.match(statement,/p.source_url=pending.source_url AND p.target_id=updated.id/);
 assert.ok(statement.indexOf("UPDATE brand_fanpages")<statement.indexOf("DELETE FROM image_pending_updates"));
});
test("stats SQL guards missing, null, object and scalar topPosts on both sides", async()=>{
 const {PgDialect}=await import("drizzle-orm/pg-core");const {sql}=await import("drizzle-orm");const {durableStatsWrite}=await import("../services/image-write");
 for(const incoming of [{}, {topPosts:null},{topPosts:{}},{topPosts:"scalar"},{topPosts:42},{topPosts:[]}]) {
  const q=new PgDialect().sqlToQuery(durableStatsWrite(sql.raw("current_json"),incoming));
  assert.match(q.sql,/CASE WHEN jsonb_typeof\(\(current_json\)->'topPosts'\)='array' THEN \(current_json\)->'topPosts' ELSE '\[\]'::jsonb END/);
  assert.match(q.sql,/jsonb_array_elements\(CASE WHEN jsonb_typeof\(\(\$\d+::jsonb\)->'topPosts'\)='array'/);
  assert.doesNotMatch(q.sql,/jsonb_array_elements\(COALESCE/);
 }
});
test("pending cleanup handles TTL and orphan separately, bounded, no repair count", async()=>{
 let statement="";
 assert.equal(await cleanupPendingImages(async(q)=>{statement=q;return {rows:[],rowCount:3};}),3);
 assert.match(statement,/interval '7 days'/);assert.match(statement,/LIMIT 100/);
 assert.match(statement,/NOT EXISTS/);assert.match(statement,/jsonb_typeof\(t.meta_stats_json->'topPosts'\)='array'/);
});
