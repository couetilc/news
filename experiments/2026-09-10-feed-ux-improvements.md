# Feed UX improvements

Scope: #381, #382, and source-mark guidance #373. The September review's UI
recommendations were approved for implementation.

- Native Sources disclosure on phones; its summary names the active selection,
  Clear sources resets it, and each link still toggles a repeatable source URL.
  A small media-query initializer exposes the familiar desktop source grid and
  responds to navigation/resize. Without JavaScript the disclosure remains usable.
- Recently viewed starts collapsed with a count, independent of the active
  source filter. Its last item removes the complete section.
- Mark unread from history only changes filtered counts when the source matches.
  Matching items return to the loaded list in timestamp/id order. Inserting into
  that window advances its cursor; items older than the loaded window remain for
  subsequent pages. The restored row can immediately be marked read again.
- Actual read buttons are 44px square, containing the existing 16px drawing in a
  separate non-overlapping column. Hollow source identity marks remain 3px.
- A request completing after a tab/filter swap cannot mutate the replacement view.
  Failed writes keep the history/list/counts unchanged and the control retryable.
- Citadel's pinned label now says Visit site, describing the available action.

## Browser regression evidence

Against the prior built worker on the isolated worktree's port 4342:

- `recently-viewed-toggle.spec.ts` failed because the empty history section
  remained after toggling an unrelated source.
- `mobile-feed.spec.ts` failed because the first unread story began at y827.7,
  below the 390x844 phone viewport. Its new assertions also pin 44px hitboxes,
  their separation from headline links, keyboard disclosure operation, repeatable
  source selection, reset, and the 672px desktop reading column.

New tests additionally cover matching insertion among 55 stories with contiguous
pagination, restoring a previously empty feed, timestamp/id ties, fully loaded
append, older-than-window behavior, failed writes/retry, and a detached old form.

Screenshots use the running workerd preview with all 22 registered sources,
including long names, and three recent items. Dates and headlines are local
fixtures. No production user's reading state is changed.

## Results

- Unit suite: 785 tests, 58 files; all four Istanbul metrics at 100% with
  `TZ=UTC npm test` (the separately tracked TI date parser fix removes this
  workstation-timezone workaround).
- All 26 browser cases passed: 24 in the full run, followed by four targeted
  passes after adapting two existing assertions to the closed mobile disclosure
  and Visit site label. The targeted four overlap two already-green cases.
- Identical 22-source/three-recent screenshot data: first unread row y893.7 →
  y431.0 at 390px; desktop column remains 672px. Read button measured 44×44px.

| View | Before | After |
| --- | --- | --- |
| Phone | [Screenshot](https://news-cdn.cuteteal.com/pr-screenshots/382/before-phone-7782801f.png) | [Screenshot](https://news-cdn.cuteteal.com/pr-screenshots/382/after-phone-3c6fd930.png) |
| Desktop | [Screenshot](https://news-cdn.cuteteal.com/pr-screenshots/382/before-desktop-9cd9419d.png) | [Screenshot](https://news-cdn.cuteteal.com/pr-screenshots/382/after-desktop-d78a7e71.png) |

[Expanded source selection on a phone](https://news-cdn.cuteteal.com/pr-screenshots/382/after-filters-phone-136197ed.png)
