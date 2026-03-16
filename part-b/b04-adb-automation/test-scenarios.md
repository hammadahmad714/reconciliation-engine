### Test scenarios for b04 ADB automation

1. **App already open on wrong screen**
   - Precondition: user profile screen is open.
   - Expected: state detector reports `account_profile`, `ensureHomeFeed` backs out to `home_feed` before liking posts.

2. **Popup appears on launch**
   - Precondition: rate-us dialog shown on first open.
   - Expected: `detectState` returns `popup`, `handlePopup` taps configured dismissal button, flow continues to `home_feed`.

3. **Feed loads slowly**
   - Precondition: network delay causes home feed content to appear near end of timeout.
   - Expected: `waitForState` polls until `home_feed` appears or times out; automation retries or fails with clear log.

4. **Like verification fails**
   - Precondition: like button disabled or overlapping element intercepts tap.
   - Expected: JSON logs show `like_tap` actions but no UI state change; operator investigates via UI dump and adjusts detection.

5. **Upload flow layout differs**
   - Precondition: new app version renames “Create” to “New post”.
   - Expected: detector still finds entry via alternate text hints; otherwise run fails at `upload_entry` with logs for missing button.

6. **Caption editor not reached**
   - Precondition: direct gallery selection jumps straight to `post_submit` without a caption screen.
   - Expected: `waitForState` accepts either `caption_editor` or `post_submit`; caption input is skipped safely when absent.

7. **Post submit takes longer than expected**
   - Precondition: upload takes near `postSubmitMs`.
   - Expected: `waitForState` polls for `posting_in_progress` then `post_success`; if timeout exceeded, run fails with `post_submit_timeout`.

8. **Unknown state recovery**
   - Precondition: experiment layout introduces an unrecognized intermediate state.
   - Expected: detector yields `unknown_state`; state machine logs error, triggers `recoverToKnownState`, and either returns to `home_feed` or aborts.

9. **Different screen resolution**
   - Precondition: run on 720p and 1440p devices.
   - Expected: `getWindowSize` adjusts swipe and normalized taps; likes and scrolls still operate using bounds + ratios.

10. **Device misses like button**
    - Precondition: OEM skin shifts like icon slightly.
    - Expected: repeated failures are visible in JSON logs; engineer tunes `extractPostNodes` or adds device-specific overrides without introducing hardcoded absolute coordinates as the primary path.

