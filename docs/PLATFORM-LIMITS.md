# Platform limits

All limits live in `skills/social-content/platform-rules.json`. Each one is either:

- **hard**: the platform rejects or ignores content over the limit. It blocks *Copy full package*.
- **editorial**: our own preference. It only shows an amber counter.

Checked on **14 October 2026**. Re-check before relying on the unverified rows, and
update `platform-rules.json` and this file together.

| Platform / field | Limit | Kind | Source | Status |
|---|---|---|---|---|
| YouTube title | 100 characters | hard | https://support.google.com/youtube/answer/57404 ("Video titles have a character limit of 100 characters") | **Verified on official page** 2026-10-14 |
| YouTube description | 5,000 characters | hard | https://support.google.com/youtube/answer/57404 | **Verified on official page** 2026-10-14 |
| YouTube hashtags | more than 60 → all ignored | hard (60 items) | https://support.google.com/youtube/answer/6390658 ("If a video or playlist has more than 60 hashtags, we'll ignore each hashtag") | **Verified on official page** 2026-10-14 |
| YouTube tags (keywords) | 500 characters total | hard | YouTube Data API `snippet.tags` | Not re-checked; widely documented |
| Instagram caption | 2,200 characters | hard | Secondary sources agree; help.instagram.com could not be reached from the build environment | **Unverified on official page** |
| Instagram hashtags | 5 per post/reel (caption + recommended list) | hard | Reported change from Dec 2025, e.g. https://www.socialmediatoday.com/news/instagram-implements-new-limits-on-hashtag-use/808309/ (the old limit was 30) | **Unverified on official page.** If your account still allows 30, raise `max` for `ig_*` hashtags. |
| Facebook post text | 63,206 characters | hard | Secondary sources | **Unverified on official page** |
| Thumbnail text | 40 | editorial | Our preference | — |
| First-3-seconds hook | 120 | editorial | Our preference | — |
| Hooks / first line (FB, IG) | 125 | editorial | Our preference (about what shows before "more") | — |
| Overlay text | 60 (Story 80) | editorial | Our preference | — |
| Facebook Reel caption | 2,200 | editorial | Our preference | — |
| Facebook / YouTube community hashtags | 10 | editorial | Our preference | — |

Counting is by Unicode code point (see DECISIONS.md).
