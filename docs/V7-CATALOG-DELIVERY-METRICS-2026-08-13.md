# V7 catalog delivery metrics

Measured locally from exact v6 SHA 6ec5e5d7ad1d60bf434e2fef05735843be8e907c with the same Next.js production-build command before and after the change.

| Metric | v6 baseline | V7 candidate | Change |
|---|---:|---:|---:|
| Root first-load JS | 482 KB | 193 KB | -289 KB (-60.0%) |
| Discover first-load JS | 467 KB | 177 KB | -290 KB |
| Map first-load JS | 468 KB | 178 KB | -290 KB |
| Rankings first-load JS | 470 KB | 180 KB | -290 KB |
| All client JS bytes | 2,306,393 | 1,641,799 | -664,594 |
| Chunks containing any generated Places ID | 690,211-byte chunk | none | removed |

The generated source file remains 598,290 bytes and remains available to offline tooling. The production browser scan checks every generated Google Place ID from that source; the V7 build contains none of them.

## Initial catalog shape

UTF-8 JSON bytes were measured over the same 403 v6 rows, first with the former initial-query fields and then with the V7 discovery-only fields:

| Shape | Bytes |
|---|---:|
| Former initial catalog | 294,636 |
| V7 discovery-only catalog | 204,714 |
| Reduction | 89,922 (-30.5%) |

This is a deterministic same-row payload-shape comparison, not a claim about compressed live wire bytes. Actual transferred bytes must be recorded from the frozen V7 staging deployment during the attended release gate; this local goal does not deploy or read credentials.

## Verification checkpoint

- Focused catalog/detail tests: 64 passed.
- Full unit/component suite: 68 files, 942 tests passed.
- TypeScript and the production Next.js build passed.
- The production bundle guard found zero generated Places IDs in 46 client chunks.
- The test-only Supabase fixture now serves the same thin discovery and lazy-detail shapes without credentials or backend traffic. The three catalog/photo assertions that originally failed now pass on Chromium and WebKit.
- Matching Playwright WebKit 2287 is installed at `D:\PlaywrightBrowsers\webkit-2287`; its temporary directory was also kept on D:.
- The prior zero-retry browser gate stopped at 25 of 26 in each browser because map assertions could run before the 403-row fixture swap. Map tests now wait for catalog loading to finish; the final zero-retry results are recorded in harness evidence.
