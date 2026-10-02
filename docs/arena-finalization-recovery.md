# Arena finalization recovery

The production Node web server starts recovery through Next.js `src/instrumentation.ts`.
No separate Railway service or cron is required. Build, Edge, frontend-only, development,
and test contexts do not start the worker. Importing recovery modules does not start it.

The worker immediately performs a bounded startup catch-up, then schedules its next
sweep 30 seconds after the preceding sweep finishes. Each sweep scans at most 100
PostgreSQL Arena settings and attempts at most 25 candidates. A keyset cursor wraps
through the settings so completed rows, corrupt snapshots, and failing Arenas cannot
permanently starve later candidates. The cursor is only a scanning optimization;
it never authorizes a mutation. A large backlog can require several passes.

Each candidate has its own `mutateArena` transaction and authoritative read after the
Arena quiz advisory lock. Finalization retains the existing lock order: Arena quiz,
sorted student progression locks, award markers, attempts. Multiple web replicas can
discover the same Arena safely. Failure rolls back that candidate and leaves it
retryable; other candidates continue. No sweep holds a transaction across Arenas.
The scan stops admitting further candidates after ten seconds; an in-flight mutation
is bounded by the existing 30-second transaction timeout. Staging backup write-gate
admission is respected. Cache invalidation and realtime delivery remain post-commit.

Timers are unref'ed, and the next timer is created only after the current run finishes.
Shutdown cancels the timer, signals the sweep to stop between candidates, and drains
the current transaction. The signal is connected to realtime only after its database
transaction commits; it never cancels database finalization. Process termination during a transaction rolls it back;
startup catch-up on the next server recovers it. There is no timer-only match state.

Arena delivery uses an HTTPS sender with the existing Pusher SDK's request signer
and event wire format. The unrelated shared Pusher client is unchanged. Each Arena
HTTP request has a 1.5-second wall-clock deadline covering connection and response
body consumption. All realtime effects from one commit share a five-second budget.
Timeout and shutdown destroy the actual request/response; completion waits for
request closure, clears the deadline timer and removes the abort listener. Redirects
are rejected, with no provider fallback. Failure skips the remaining realtime effects
for that commit and lets the sweep process later Arenas. Non-realtime post-commit
work is not skipped by a delivery abort.

Delivery is best effort: timeout/rejection is logged with a static reason, never
reported as successful provider delivery. PostgreSQL completion, reward markers,
notifications and results remain committed. A reload reads authoritative results;
recovery never re-awards or re-finalizes solely to resend a failed event. An aborted
request might already have reached Pusher, so timeout cannot guarantee the provider
did not receive it. Revision/session guards remain necessary for consumers.

Operational logs contain sweep counts (`scanned`, `attempted`, `finalized`, `failed`,
`paused`) and the numeric quiz ID of a failed candidate. They do not contain snapshots,
student identity, tokens, exception payloads, or provider credentials. Repeated failures
or absence of sweep-completion logs while the web service runs require investigation.
Recovery cannot run while every web instance is offline; catch-up resumes after startup.

Teacher and Student clients reconcile through `GET /api/arena/:id?view=snapshot`.
This mode retains ownership/enrollment/deleted-quiz checks and uses a repeatable,
PostgreSQL read-only transaction. It does not resolve attacks, finalize a match,
award EXP, create notifications/events, touch Redis or enter the staging write
gate. The existing mutating GET path remains gated. Completed results come from
the committed Arena snapshot and completed attempt/payout; recovery of missing
durable facts remains the server worker's responsibility.

Clients poll every three seconds while awaiting a committed terminal snapshot.
Failed reads retry after one, two, four, eight and then ten seconds, with a
five-second abortable request deadline and at most one read in flight. Cleanup
cancels requests/timers and removes listeners. Successful terminal application
stops polling; online, visibility and Pusher reconnect still trigger a read.
Revision guards reject stale responses. Teacher applies participants before
switching to podium; Student distinguishes completion from result reconciliation
and applies submission response points immediately. Reconnect of an already-ended
Student page skips join/submission and reads results without re-finalizing.

Legacy completed results are adopted without rewriting valid scores, timestamps,
remarks, AI metadata, or reward markers and without reissuing completion notifications
or realtime events. Missing scores/rewards are repaired within the same transaction.
Completion reason uses existing completion reason/timestamps or recorded expiry remarks,
never the later recovery time. Unknown historical reasons remain `recovered`.

Deploy the existing score precision migration before this application code. It preserves
historical numeric values and their two-decimal scale. This recovery change introduces
no additional schema migration and does not change spectator mode or gameplay scoring.

Overdue combat is also recovered by this same worker. An active Arena with a
persisted pending attack past its reaction window is a candidate, even while its
match deadline is still in the future. Discovery does not authorize a hit: each
candidate is re-read after the Arena lock and its quiz mode, owner and lifecycle
are checked. Active transactions inspect at most 100 overdue attacks; later cursor
passes drain the rest. Invalid old-session/participant attacks are cancelled so
they cannot hold up valid attacks. Multiple workers and the fast scheduled callback
use the same pending-status check and score mutation, so only one can commit a hit.

The finalizer settles outcome-relevant combat BEFORE calculating rankings, attempts
and EXP, within the same transaction. It uses the existing resolver and penalty,
score-floor and explicit shield rules. `hasShield` alone never auto-deflects.
A shield is timely at `expiresAt`; a hit requires `now > expiresAt`, and match
activity requires `now < matchEndsAt`. Recovery evaluates at the recorded manual
end time, capped at the last millisecond before the match deadline. Thus a window
ending exactly at the deadline (or its last millisecond, with no legal later active
millisecond) does not hit. A due window with a legal pre-deadline hit does, even if
recovery happens after the deadline. Historical valid completed scores are preserved;
incomplete rows use their persisted completion cutoff rather than recovery time.

Resolved/deflected attacks and cancelled unfinished windows are retained in
`attackResults` when `pendingAttacks` is cleared. This records terminal combat facts
without reviving attacks or changing spectator behavior. Hit events are registered
inside the transaction and delivered only after commit using the cancellable Arena
transport. Batched events carry the final batch rankings/scores, avoiding intermediate
same-revision snapshots. Failure rolls back score, combat, completion and rewards
and leaves the candidate retryable. Delivery failure never repeats a deduction.

Each sweep remains limited to 25 single-Arena transactions, a 100-row scan and the
ten-second admission window. Active attack batches have the 100-attack cap; terminal
finalization settles all relevant attacks for that Arena under its existing 30-second
transaction deadline, so it cannot commit a partially settled podium. A failed or
timed-out Arena advances the cursor, remains retryable and cannot permanently starve
other Arenas. No separate worker/service/cron or client mutation was introduced.

Arena realtime authority is scoped to the persisted quiz ID and session ID before
any revision comparison. The common post-commit producer stamps all three fields,
including events delivered on the shared Teacher channel. Foreign/conflicting IDs
are rejected without advancing the current view's cursor. Matching gameplay events
cannot change a reconciled terminal result. Disposed subscriptions reject callbacks.

| Events in the Arena view | Authority |
| --- | --- |
| `arena-answer`, score/leaderboard, start/end, airdrop, shield-equipped | State only with matching quiz/session, valid revision, and a non-terminal view. Unbound events are discovered through snapshots. |
| Incoming attack aliases | Matching-session reaction/feed information; never advance the cursor. |
| Hit/block/deflect aliases | Matching-session feedback; score/protection updates additionally require a current revision and non-terminal view. Unversioned outcomes remain feedback only. |
| Student-joined/enrollment | Read-only hint; never append participants or advance revision. |
| Reset/session-created | Matching-quiz read-only session-change hint; never directly adopt a session or revision. |
| Legacy events without sufficient identity/revision | Coalesced snapshot hint or ignored; no gameplay authority. |

Read hints share the reconciler's scheduling timer and five-second abort deadline.
Normal hints do not restart terminal polling. A verified same-quiz reset hint may
request one coalesced terminal read; only the authorized snapshot adopts the new
persisted session and resets Student gameplay UI. Reconnect/visibility refresh
also reads committed state, without finalization, rewards, or notifications.
