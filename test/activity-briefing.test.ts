import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { expect, it } from 'vitest';
import ActivityBriefing from '../src/components/ActivityBriefing.astro';

it('renders source marks and counts with accessible names, compact on screen', async () => {
 const html = await (await AstroContainer.create()).renderToString(ActivityBriefing, { props: {activity:[{source:'anthropic',count:2},{source:'meta-ai',count:1}]} });
 expect(html).toContain('3 posts');
 expect(html).toContain('aria-label="Publications in the last 24 hours"');
 expect(html).toContain('class="sr-only">Anthropic:');
 expect(html).toContain('class="sr-only">Meta AI:');
 expect(html.match(/class="mark /g)).toHaveLength(2);
 expect(html).not.toContain('<a ');
});
it.each([0,1])('handles %i total without a delayed-updates notice', async count => {
 const html = await (await AstroContainer.create()).renderToString(ActivityBriefing, {props:{activity:count?[{source:'anthropic',count}]:[]}});
 expect(html).toContain(count === 1 ? '1 post' : '0 posts');
 expect(html).not.toContain('delayed');
});
