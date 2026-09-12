// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import '../../src/scripts/swipe-read';

function pointer(target: EventTarget, type: string, x = 200, y = 50, over: PointerEventInit = {}) {
 target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 1, clientX: x, clientY: y, ...over }));
}
function fixture() {
 document.body.innerHTML = '<ol data-feed-list><li data-swipe-read><a href="/status"><h2>Headline</h2></a><form data-read-form><button>Read</button></form></li></ol>';
 const row = document.querySelector<HTMLElement>('li')!;
 const target = row.querySelector('h2')!;
 const submit = vi.spyOn(row.querySelector('form')!, 'requestSubmit').mockImplementation(() => {});
 return {row,target,submit};
}
beforeEach(() => { document.dispatchEvent(new Event('astro:before-swap')); document.body.innerHTML = ''; vi.restoreAllMocks(); });

it('commits a left touch swipe once at the threshold and suppresses headline navigation', () => {
 const {row,target,submit}=fixture();
 pointer(target,'pointerdown'); pointer(target,'pointermove',128);
 expect(row.dataset.swiping).toBe('ready'); expect(row.style.getPropertyValue('--swipe-x')).toBe('-72px');
 pointer(target,'pointerup',128); pointer(target,'pointerup',128);
 expect(submit).toHaveBeenCalledTimes(1); expect(row.hasAttribute('data-swiping')).toBe(false);
 const click=new MouseEvent('click',{bubbles:true,cancelable:true}); target.dispatchEvent(click);
 expect(click.defaultPrevented).toBe(true);
 const next=new MouseEvent('click',{bubbles:true,cancelable:true}); target.dispatchEvent(next);
 expect(next.defaultPrevented).toBe(false);
});
it.each([[190,50],[250,50],[185,100],[175,80]])('does not turn tap/right/vertical/diagonal movements into a read (%i, %i)', (x,y) => {
 const {target,submit}=fixture(); pointer(target,'pointerdown'); pointer(target,'pointermove',x,y); pointer(target,'pointerup',x,y);
 expect(submit).not.toHaveBeenCalled();
});
it('short horizontal drags and reversals reset without opening the link', () => {
 const {target,row,submit}=fixture();pointer(target,'pointerdown');pointer(target,'pointermove',160);
 expect(row.dataset.swiping).toBe('moving'); pointer(target,'pointermove',40); expect(row.style.getPropertyValue('--swipe-x')).toBe('-112px');
 pointer(target,'pointermove',220); expect(row.style.getPropertyValue('--swipe-x')).toBe('0px'); pointer(target,'pointerup',220);
 expect(submit).not.toHaveBeenCalled();
 const click=new MouseEvent('click',{bubbles:true,cancelable:true}); target.dispatchEvent(click);expect(click.defaultPrevented).toBe(true);
});
it('ignores unrelated pointers, cancellation, removed rows and route swaps', () => {
 const {target,row,submit}=fixture(); pointer(target,'pointermove',100); pointer(target,'pointerup',100);
 pointer(target,'pointerdown'); pointer(target,'pointermove',100,50,{pointerId:2});pointer(target,'pointerup',100,50,{pointerId:2});expect(row.hasAttribute('data-swiping')).toBe(false);
 pointer(target,'pointermove',100);document.dispatchEvent(new Event('pointercancel'));expect(row.style.getPropertyValue('--swipe-x')).toBe('');pointer(target,'pointerup',100);
 pointer(target,'pointerdown');pointer(target,'pointermove',100);row.remove();pointer(document,'pointerup',100);expect(submit).not.toHaveBeenCalled();
});
it('only accepts primary touch/pen on eligible rows outside controls', () => {
 const {target,row,submit}=fixture();
 for(const over of [{isPrimary:false},{pointerType:'mouse'}]){pointer(target,'pointerdown',200,50,over);pointer(target,'pointermove',100);pointer(target,'pointerup',100);}
 pointer(document,'pointerdown');pointer(row.querySelector('button')!,'pointerdown');pointer(document.body,'pointerdown');
 row.querySelector('button')!.disabled=true;pointer(target,'pointerdown');pointer(target,'pointermove',100);pointer(target,'pointerup',100);expect(submit).not.toHaveBeenCalled();
 row.querySelector('button')!.disabled=false;pointer(target,'pointerdown',200,50,{pointerType:'pen'});pointer(target,'pointermove',100);pointer(target,'pointerup',100);expect(submit).toHaveBeenCalledOnce();
});
it('does not suppress another row or a non-node click; the next pointer starts fresh', () => {
 const {target,submit}=fixture();pointer(target,'pointerdown');pointer(target,'pointermove',160);pointer(target,'pointerup',160);
 document.dispatchEvent(new Event('click'));pointer(target,'pointerdown');pointer(target,'pointermove',160);pointer(target,'pointerup',160);
 const other=new MouseEvent('click',{bubbles:true,cancelable:true});document.body.dispatchEvent(other);expect(other.defaultPrevented).toBe(false);
 pointer(target,'pointerdown');pointer(target,'pointermove',100);document.dispatchEvent(new Event('astro:before-swap'));pointer(target,'pointerup',100);expect(submit).not.toHaveBeenCalled();
});
