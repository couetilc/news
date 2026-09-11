import { describe, expect, it } from 'vitest';
import { parseIntelNewsroom } from '../src/ingest/parse/intel-newsroom';
import { countIntelNewsroom } from '../src/ingest/parse/count';
import html from './fixtures/intel-newsroom.html?raw';

const wrap = (body: string) => `<div data-component="card-grid">${body}</div>`;
const card = (href = '/content/www/us/en/newsroom/news/client-computing/test.html', body = '<h2>A &amp; <em>B</em></h2><p>September 04,2026</p>') => `<a class="cmp-teaser__link" href="${href}">${body}</a>`;

describe('Intel AEM newsroom', () => {
 it('reads canonical article links, display headlines and UTC dates from real cards', () => {
  const items = parseIntelNewsroom(html);
  expect(items).toHaveLength(3);
  expect(countIntelNewsroom(html)).toBe(3);
  expect(items[0]).toEqual({ guid:'https://www.intel.com/content/www/us/en/newsroom/news/client-computing/intel-agentic-pcs-give-asu-football-on-field-edge.html',url:'https://www.intel.com/content/www/us/en/newsroom/news/client-computing/intel-agentic-pcs-give-asu-football-on-field-edge.html', title:'Intel Agentic PCs Give ASU Football an On-Field Edge', summary:null,contentHtml:null,publishedAt:Date.UTC(2026,8,4)/1000 });
  expect(items[1].publishedAt).toBe(Date.UTC(2026,8,1)/1000);
  expect(items[2].title).toBe('Intel at AI Infra Summit 2026');
 });
 it('decodes titles and removes tracking/fragment variants from identities', () => {
  const [item]=parseIntelNewsroom(wrap(card('/content/www/us/en/newsroom/opinion/test.html?utm_source=rss&amp;x=1#top')));
  expect(item.title).toBe('A & B');expect(item.url).toBe('https://www.intel.com/content/www/us/en/newsroom/opinion/test.html');expect(item.guid).toBe(item.url);
 });
 it('ignores navigation, foreign origins, nonweb schemes, missing and invalid URLs',()=>{
  const body = ['','/content/www/us/en/newsroom/home.html','https://evil.test/content/www/us/en/newsroom/news/test.html','javascript:alert(1)','https://[invalid'].map(h=>card(h)).join('')+'<a class="cmp-teaser__link"><h2>No URL</h2></a><a href="/ignored">Navigation</a></a>';
  expect(parseIntelNewsroom(wrap(body))).toEqual([]);expect(countIntelNewsroom(wrap(body))).toBe(6);
 });
 it('leaves missing titles and dates visible to field validation',()=>{
  expect(parseIntelNewsroom(wrap(card(undefined,'')))[0]).toMatchObject({title:'',publishedAt:null});
  expect(parseIntelNewsroom(wrap(card(undefined,'<h2>Title</h2><p>Smarch 04,2026</p>')))[0].publishedAt).toBeNull();
 });
 it('does not borrow the following card when a previous anchor is unclosed',()=>{
  const body='<a class="cmp-teaser__link" href="/content/www/us/en/newsroom/news/lost.html"><h2>Lost'+card();
  expect(parseIntelNewsroom(wrap(body)).map(i=>i.title)).toEqual(['A & B']);
 });
 it('rejects an old RSS feed or unrelated HTML and counts garbage safely',()=>{
  for(const input of ['<rss/>','<html>Maintenance</html>',''])expect(()=>parseIntelNewsroom(input)).toThrow(/not an Intel newsroom listing/);
  expect(countIntelNewsroom('junk')).toBe(0);expect(parseIntelNewsroom(wrap(''))).toEqual([]);
 });
});
