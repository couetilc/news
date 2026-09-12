import { test, expect, type Page } from './fixtures';
import { d1Query } from './d1';

async function signup(page: Page) {
 await page.goto('/signup');await page.getByLabel('Email').fill('connor@couetil.com');await page.getByLabel('Password').fill('local-fixture-password');
 await page.getByRole('button',{name:'Create account'}).click();await page.waitForURL('**/');
}
async function drag(page: Page, selector: string, dx: number, dy=0) {
 await page.locator(selector).click({trial:true});
 const box=await page.locator(selector).boundingBox(); if(!box)throw new Error('Missing gesture target');
 const x=box.x+box.width*0.65, y=box.y+box.height/2;
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(let step=1;step<=6;step++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*step/6,y:y+dy*step/6}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
}
function seed(baseURL: string) {
 const now=Math.floor(Date.now()/1000);
 d1Query(`INSERT INTO items (source,guid,url,title,published_at,fetched_at) VALUES
 ('anthropic','a','${baseURL}/status?article=a','First recent story',${now-60},${now}),
 ('meta-ai','b','${baseURL}/status?article=b','Second recent story',${now-120},${now}),
 ('meta-ai','c','${baseURL}/status?article=c','Third recent story',${now-180},${now}),
 ('meta-ai','old','${baseURL}/status?article=old','Older story',${now-86401},${now}),
 ('meta-ai','unknown','${baseURL}/status?article=unknown','Undated story',NULL,${now-200})`);
}
test.use({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true });

test('touch swipe and Undo preserve activity, filters and read history across router swaps', async ({page,baseURL}) => {
 seed(baseURL!);
 d1Query(`INSERT INTO items(source,guid,url,title,published_at,fetched_at) VALUES
 ('cloudflare-blog','old-cf','https://example.com/old-cf','Earlier Cloudflare update',1,1),
 ('apple','old-apple','https://example.com/old-apple','Earlier Apple update',1,1)`);
 await signup(page);
 const briefing=page.locator('[data-activity-briefing]');await expect(briefing).toContainText('3 posts');const activity=await briefing.textContent();
 const filters=page.locator('.source-filter nav a');
 const rankedSources=['All','Meta AI','Anthropic','Apple','Cloudflare Blog'];
 await expect(filters).toHaveText(rankedSources);
 await expect(briefing.locator('[title]')).toHaveText(['Meta AI: 2','Anthropic: 1']);
 await page.locator('.source-filter > summary').click();await page.getByRole('link',{name:'Meta AI',exact:true}).click();
 await expect(page).toHaveURL(/source=meta-ai/);await expect(briefing).toHaveText(activity!);
 await expect(filters).toHaveText(rankedSources);
 const row='[data-feed-list] [data-feed-row]:has-text("Second recent story")';
 await drag(page,row,-110);await expect(page.locator(row)).toHaveCount(0);
 await expect(page.locator('[data-tab-count="unread"]')).toHaveText('3');await expect(briefing).toHaveText(activity!);
 await expect(page.getByRole('button',{name:'Undo marking Second recent story as read'})).toBeVisible();
 await page.getByRole('button',{name:'Undo marking Second recent story as read'}).click();await expect(page.locator(row)).toBeVisible();
 await expect(page.locator('[data-tab-count="unread"]')).toHaveText('4');await expect(briefing).toHaveText(activity!);
 await expect(filters).toHaveText(rankedSources);
 await drag(page,row,-110);await expect(page.locator(row)).toHaveCount(0);await page.reload();
 await expect(page.locator('[data-recently-viewed]')).toHaveCount(0);await expect(briefing).toHaveText(activity!);
 await expect(filters).toHaveText(rankedSources);
 await page.getByRole('link',{name:'Third recent story',exact:true}).click();await page.waitForURL('**/status?article=c');
 await page.goto('/?source=meta-ai');await expect(page.locator('[data-recently-viewed]')).toContainText('Third recent story');
 await expect(page.locator('[data-recently-viewed]')).not.toContainText('Second recent story');
 expect(d1Query<{n:number}>('SELECT COUNT(*) AS n FROM item_reads')[0].n).toBe(2);
});

test('vertical scroll and a cancelled short swipe do not dismiss or open articles; failures remain retryable', async ({page,baseURL}) => {
 seed(baseURL!);await signup(page);
 const row='[data-feed-list] [data-feed-row]:has-text("First recent story")';
 await drag(page,row,0,-90);await expect(page.locator(row)).toBeVisible();
 await page.locator(row).scrollIntoViewIfNeeded();await drag(page,row,-35);await expect(page.locator(row)).toBeVisible();await expect(page).toHaveURL(/\/$/);
 expect(d1Query<{n:number}>('SELECT COUNT(*) AS n FROM item_reads')[0].n).toBe(0);
 await page.route('**/api/read',route=>route.fulfill({status:500,body:'Try again'}));
 await drag(page,row,-110);await expect(page.locator(row).getByRole('alert')).toContainText('Couldn’t save');
 await expect(page.locator(row).getByRole('button',{name:'Mark as read'})).toBeEnabled();
 await page.unroute('**/api/read');await page.locator(row).getByRole('button',{name:'Mark as read'}).click();
 await expect(page.locator('[data-read-undo]')).toBeVisible();
 await page.route('**/api/read',route=>route.fulfill({status:500,body:'Try again'}));await page.locator('[data-read-undo] button').click();
 await expect(page.locator('[data-read-undo]').getByRole('alert')).toContainText('Couldn’t save');
 await page.unroute('**/api/read');await page.locator('[data-read-undo] button').click();await expect(page.locator(row)).toBeVisible();
});

test('a swipe works on appended pages and reduced motion does not change the saved result', async ({page,baseURL}) => {
 const now=Math.floor(Date.now()/1000);const vals=Array.from({length:52},(_,i)=>`('anthropic','${i}','${baseURL}/status?article=${i}','Paged story ${i}',${now-i},${now-i})`);
 d1Query(`INSERT INTO items (source,guid,url,title,published_at,fetched_at) VALUES ${vals.join(',')}`);
 await page.emulateMedia({reducedMotion:'reduce'});await signup(page);
 await page.locator('[data-feed-sentinel]').scrollIntoViewIfNeeded();await expect(page.locator('[data-feed-row]')).toHaveCount(52);
 const row='[data-feed-row]:has-text("Paged story 51")';await page.locator(row).scrollIntoViewIfNeeded();await drag(page,row,-100);
 await expect(page.locator(row)).toHaveCount(0);await expect(page.locator('[data-tab-count="unread"]')).toHaveText('51');
 await page.locator('[data-read-undo] button').click();await expect(page.locator(row)).toBeVisible();await expect(page.locator('[data-feed-row]')).toHaveCount(52);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


test('keyboard read and Undo keep focus on the available action', async ({page,baseURL}) => {
 seed(baseURL!);await signup(page);
 const row=page.locator('[data-feed-row]').filter({hasText:'First recent story'});
 await row.getByRole('button',{name:'Mark as read'}).focus();await page.keyboard.press('Enter');
 const undo=page.getByRole('button',{name:'Undo marking First recent story as read'});
 await expect(undo).toBeFocused();await page.keyboard.press('Enter');await expect(row.getByRole('button',{name:'Mark as read'})).toBeFocused();
});

test.describe('without JavaScript', () => {
 test.use({javaScriptEnabled:false});
 test('read buttons and the publication briefing survive full document form navigation', async ({page,baseURL}) => {
  seed(baseURL!);await signup(page);
  const row=page.locator('[data-feed-list] [data-feed-row]').filter({hasText:'First recent story'});
  await row.getByRole('button',{name:'Mark as read',exact:true}).click();await expect(row).toHaveCount(0);
  await expect(page.locator('[data-activity-briefing]')).toContainText('3 posts');
  await expect(page.locator('[data-recently-viewed]')).toHaveCount(0);
  await page.getByRole('link',{name:'Read 1',exact:true}).click();
  await page.getByRole('button',{name:'Mark as unread',exact:true}).click();
  await page.getByRole('link',{name:'Unread 5',exact:true}).click();await expect(row).toBeVisible();
 });
});
