import { env } from 'cloudflare:test';
import { beforeEach, expect, it } from 'vitest';
import { insertItems } from '../src/ingest/db';
import mappingJson from '../experiments/intel-verified-url-mapping.json?raw';
const mappings=JSON.parse(mappingJson) as {guid:string,url:string,new_url:string,title:string}[];
const db=env.NEWS_DB;
const migrate=async()=>{const migration=env.TEST_MIGRATIONS.find(m=>m.name==='0007_intel_canonical_urls.sql')!;await db.batch(migration.queries.map(query=>db.prepare(query)));};
const seed=async(source:string,guid:string,url:string)=>{await db.prepare('INSERT INTO items(source,guid,url,title,fetched_at) VALUES(?,?,?,?,?)').bind(source,guid,url,'Original title',123).run();};
beforeEach(async()=>{await db.batch([db.prepare('DELETE FROM item_reads'),db.prepare('DELETE FROM items')]);});
it('migrates all verified Intel canonical links without changing identity or read history',async()=>{
 for(const entry of mappings)await seed('intel',entry.guid,entry.url);
 const before=(await db.prepare('SELECT id,guid,title,fetched_at FROM items ORDER BY id').all()).results;
 const id=before[0].id;
 await db.prepare('INSERT INTO item_reads(user_id,item_id,read_at) VALUES(?,?,?)').bind(123,id,456).run();
 await migrate();await migrate();
 expect((await db.prepare('SELECT id,guid,title,fetched_at FROM items ORDER BY id').all()).results).toEqual(before);
 expect((await db.prepare('SELECT url FROM items ORDER BY id').all<{url:string}>()).results.map(r=>r.url)).toEqual(mappings.map(m=>m.new_url));
 expect((await db.prepare('SELECT user_id,item_id,read_at FROM item_reads').all()).results).toEqual([{user_id:123,item_id:id,read_at:456}]);
 const first=mappings[0];expect(await insertItems(db,'intel',[{guid:first.new_url,url:first.new_url,title:first.title,summary:null,contentHtml:null,publishedAt:999}],456)).toBe(0);
});
it('leaves unmapped history, other sources, unexpected guids and canonical collisions untouched',async()=>{
 const [first,second]=mappings;
 await seed('intel',first.guid,first.url);await seed('intel','canonical-existing',first.new_url);
 await seed('intel','unexpected-guid',second.url);await seed('other',second.guid,second.url);await seed('intel','unmapped','https://newsroom.intel.com/unmapped');
 const before=(await db.prepare('SELECT * FROM items ORDER BY id').all()).results;
 await migrate();expect((await db.prepare('SELECT * FROM items ORDER BY id').all()).results).toEqual(before);
});
