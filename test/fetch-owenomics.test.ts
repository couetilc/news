import { describe, expect, it, vi } from 'vitest';
import { fetchOwenomics } from '../src/ingest/fetch/owenomics';
import { parseOwenomics } from '../src/ingest/parse/owenomics';
import { countOwenomics } from '../src/ingest/parse/count';
import search from './fixtures/owenomics-search.json?raw';
import urls from './fixtures/owenomics-urls.json?raw';

describe('Owenomics public search loader',()=>{
 it('joins public result IDs to verified canonical paths and preserves month precision',async()=>{
  const fetchFn=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(search)).mockResolvedValueOnce(new Response(urls));
  const signal=new AbortController().signal;
  const response=await fetchOwenomics(fetchFn,{headers:{'User-Agent':'test-aggregator'},signal});
  const body=await response.text();const items=parseOwenomics(body);
  expect(countOwenomics(body)).toBe(3);expect(items).toHaveLength(3);
  expect(items[0]).toEqual({guid:'https://www.acadian-asset.com/investment-insights/owenomics/crazy-days-in-the-stock-market',url:'https://www.acadian-asset.com/investment-insights/owenomics/crazy-days-in-the-stock-market',title:'Crazy days in the stock market',publishedAt:Date.UTC(2026,7,1)/1000,summary:null,contentHtml:null});
  expect(items[1].publishedAt).toBe(Date.UTC(2026,6,1)/1000);
  expect(fetchFn.mock.calls.map(c=>c[0])).toEqual(['https://edge-platform.sitecorecloud.io/v1/search','https://www.acadian-asset.com/api/search']);
  for(const [,init] of fetchFn.mock.calls){expect(init?.signal).toBe(signal);expect(init?.method).toBe('POST');expect(new Headers(init?.headers).get('User-Agent')).toBe('test-aggregator');}
  expect(new Headers(fetchFn.mock.calls[0][1]?.headers).has('x-sitecore-contextid')).toBe(true);
  expect(new Headers(fetchFn.mock.calls[1][1]?.headers).has('x-sitecore-contextid')).toBe(false);
  const query=JSON.parse(fetchFn.mock.calls[0][1]!.body as string);
  expect(query).toMatchObject({limit:20,offset:0,sort:{fields:[{name:'listingDate',order:'desc'}]}});
  expect(query.facet.fields).toContainEqual({name:'Search Topic',filters:[{operator:'eq',value:['Owenomics']}]});
  expect(JSON.parse(fetchFn.mock.calls[1][1]!.body as string)).toEqual({content:JSON.parse(search).content.map((r:{sc_item_id:string})=>({sc_item_id:r.sc_item_id}))});
 });
 it.each([404,503])('returns upstream status %s for either failed request',async(status)=>{
  const first=new Response('failed',{status});const fetchFn=vi.fn<typeof fetch>().mockResolvedValueOnce(first);
  expect(await fetchOwenomics(fetchFn,{})).toBe(first);expect(fetchFn).toHaveBeenCalledTimes(1);
  const second=new Response('failed',{status});fetchFn.mockReset().mockResolvedValueOnce(new Response(search)).mockResolvedValueOnce(second);
  expect(await fetchOwenomics(fetchFn,{})).toBe(second);
 });
 it.each([null,3,{}, {content:{}}])('rejects malformed containers from either API: %j',async(value)=>{
  const fetchFn=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(value));await expect(fetchOwenomics(fetchFn,{})).rejects.toThrow(/missing content array/);
  fetchFn.mockReset().mockResolvedValueOnce(new Response(search)).mockResolvedValueOnce(Response.json(value));await expect(fetchOwenomics(fetchFn,{})).rejects.toThrow(/missing content array/);
 });
 it('keeps missing fields observable and excludes unresolved/foreign/nonarticle paths',async()=>{
  const rows=[null,3,{sc_item_id:'a',navigationTitle:'No date'}, {sc_item_id:'b',listingDate:'invalid'},{sc_item_id:'c',listingDate:5},{sc_item_id:'d',listingDate:'2026-13-01'}, {sc_item_id:'e',listingDate:'2026-12-01',navigationTitle:'December'}];
  const refs=[null,{sc_item_id:'a',url:'/investment-insights/owenomics/a'},{sc_item_id:'b',url:'https://evil.test/b'},{sc_item_id:'c',url:'/news/c'},{sc_item_id:'d',url:42},{sc_item_id:'e',url:'/au/investment-insights/owenomics/e'}];
  const fetchFn=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({content:rows})).mockResolvedValueOnce(Response.json({content:refs}));
  const response=await fetchOwenomics(fetchFn,{});const body=await response.text();expect(countOwenomics(body)).toBe(7);
  expect(parseOwenomics(body).map(i=>[i.title,i.publishedAt])).toEqual([['No date',null],['December',Date.UTC(2026,11,1)/1000]]);
 });
 it('propagates cancellation/fetch errors instead of silently succeeding',async()=>{
  const error=new Error('aborted');const fetchFn=vi.fn<typeof fetch>().mockRejectedValueOnce(error);await expect(fetchOwenomics(fetchFn,{})).rejects.toBe(error);
 });
});
