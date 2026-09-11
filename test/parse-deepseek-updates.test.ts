import { describe, expect, it } from 'vitest';
import { parseDeepseekUpdates } from '../src/ingest/parse/deepseek-updates';
import { countDeepseekUpdates } from '../src/ingest/parse/count';
import html from './fixtures/deepseek-updates.html?raw';
const wrap=(s:string)=>`<html class="docs-doc-id-updates">${s}</html>`;
const section=(date:string,body='<h3>Model &amp; API <em>update</em><a href="#anchor">link</a></h3>')=>`<h2 id="date-${date}">Date</h2>${body}`;
describe('DeepSeek first-party changelog',()=>{
 it('reads releases, documented article links and dated-only API updates',()=>{
  const items=parseDeepseekUpdates(html);expect(items).toHaveLength(3);expect(countDeepseekUpdates(html)).toBe(3);
  expect(items[0]).toEqual({guid:'https://api-docs.deepseek.com/updates/#date-2026-09-10',url:'https://api-docs.deepseek.com/news/news260910',title:'DeepSeek-V4.1-Flash Release',summary:null,contentHtml:null,publishedAt:Date.UTC(2026,8,10)/1000});
  expect(parseDeepseekUpdates(html.replace('<a href="/news/news260910">this documentation</a>',''))[0].guid).toBe(items[0].guid);
  expect(items[1].url).toBe('https://api-docs.deepseek.com/updates/#date-2026-08-21');
  expect(items[2].title).toBe('DeepSeek-V4-Pro Update');
 });
 it('decodes headlines and excludes hash-link labels',()=>{
  expect(parseDeepseekUpdates(wrap(section('2026-01-02')))[0].title).toBe('Model & API update');
 });
 it('ignores invalid/missing dates while retaining the raw drift denominator',()=>{
  const body=section('2026-02-30')+section('2026-13-01')+section('date-drift')+'<h2>Navigation</h2>'+section('2024-02-29','');
  const items=parseDeepseekUpdates(wrap(body));expect(items).toHaveLength(1);expect(items[0]).toMatchObject({title:'',publishedAt:Date.UTC(2024,1,29)/1000});expect(countDeepseekUpdates(body)).toBe(4);
 });
 it('does not borrow a next section title and accepts only first-party release paths',()=>{
  const body=section('2026-01-01','<a href="https://evil.test/news/news260101">foreign</a>')+section('2026-01-02');
  const items=parseDeepseekUpdates(wrap(body));expect(items[0]).toMatchObject({title:'',url:'https://api-docs.deepseek.com/updates/#date-2026-01-01'});expect(items[1].title).toBe('Model & API update');
 });
 it('rejects generic docs/OpenRSS error pages and safely counts garbage',()=>{
  for(const input of ['<title>Feed temporarily unavailable</title>','<html>API docs</html>',''])expect(()=>parseDeepseekUpdates(input)).toThrow(/not a DeepSeek changelog/);
  expect(countDeepseekUpdates('garbage')).toBe(0);expect(parseDeepseekUpdates(wrap(''))).toEqual([]);
 });
});
