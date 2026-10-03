package com.openmausbot.companion.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield

/**
 * The lifecycle of a one-time pairing invite while an attempt is in flight —
 * the port of `OnboardingTests.swift:164-237`, played through the real
 * [Session] so a deep link arriving mid-redemption is an actual concurrent
 * call rather than a policy table.
 *
 * §6 is what makes this a correctness question and not a nicety. A pairing
 * credential is redeemable once. If a link that arrives during a commit takes
 * the credential slot, the attempt that finishes erases a QR that was never
 * used, and the user has to walk back to the computer for a third one.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SessionInviteLifecycleTest {
    private val first = "omb_pair_" + "1".repeat(43)
    private val second = "omb_pair_" + "2".repeat(43)

    private fun link(credential: String, host: String) =
        "openmausbot://pair?address=$host:8810&token=$credential"

    /** A six-digit invite: retryable, and never burned by a redemption. */
    private fun codeLink(code: String, host: String) =
        "openmausbot://pair?address=$host:8810&code=$code"

    private fun paired(connection: Connection) = PairingOutcome(
        PairResponse(
            token = "device-token",
            device = PairedDevice("d1", "Pixel", 1.0, 1.0),
            serverName = "Mac",
        ),
        connection,
    )

    @Test
    fun aLinkArrivingDuringAnAttemptWaitsInsteadOfTakingTheCredentialSlot() = runTest {
        val redeeming = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val session = session(
            pairOutcomeFn = { _, _, _, _ ->
                redeeming.complete(Unit)
                release.await()
                throw APIError.Transport("the network went away")
            },
        )
        session.awaitRestored()

        session.receivePairingURL(link(first, "192.168.1.2"))
        val invite = assertNotNull(session.pairingInvite.value)
        assertEquals(first, invite.credential)
        // What the pairing screen does with a published invite: it takes it and
        // opens a credential slot for it.
        session.consumePairingInvite()

        val attempt = backgroundScope.async { runCatching { session.pair(invite, "request-1") } }
        redeeming.await()

        session.receivePairingURL(link(second, "192.168.1.9"))
        assertNull(
            session.pairingInvite.value,
            "the second link was published onto the screen while the first credential " +
                "was still being redeemed",
        )

        release.complete(Unit)
        attempt.await()

        // The first attempt is over and this phone is still unconnected, so the
        // link that waited is presented now — with its own computer, not the one
        // that just failed.
        val released = assertNotNull(session.pairingInvite.value)
        assertEquals(second, released.credential)
        assertEquals("192.168.1.9", released.connection.host)
    }

    @Test
    fun aWaitingLinkIsConsumedByASuccessfulPairingAndNeverReturnsAfterUnpair() = runTest {
        val redeeming = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val session = session(
            connectionStore = RecordingConnectionStore(),
            tokenStore = RecordingTokenStore(),
            pairOutcomeFn = { connection, _, _, _ ->
                redeeming.complete(Unit)
                release.await()
                paired(connection)
            },
        )
        session.awaitRestored()

        session.receivePairingURL(link(first, "192.168.1.2"))
        val invite = assertNotNull(session.pairingInvite.value)
        session.consumePairingInvite()

        val attempt = backgroundScope.async { session.pair(invite, "request-1") }
        redeeming.await()
        session.receivePairingURL(link(second, "192.168.1.9"))
        release.complete(Unit)
        attempt.await()

        assertNotNull(session.connection.value)
        assertNull(
            session.pairingInvite.value,
            "a successful pairing left the waiting one-time invite on the screen",
        )

        session.signOutAndAwait()
        assertNull(
            session.pairingInvite.value,
            "the invite that waited during the commit reopened pairing after unpairing",
        )
        advanceUntilIdle()
        assertNull(session.pairingInvite.value)
    }

    @Test
    fun aSuccessfulPairingEmptiesTheQueueBeforeStatusEverCatchesUp() = runTest {
        val session = session(pairOutcomeFn = { connection, _, _, _ -> paired(connection) })
        session.awaitRestored()
        // A six-digit invite: nothing burns it, so only the end of the attempt
        // can take it out of the queue.
        session.receivePairingURL(codeLink("123456", "192.168.1.2"))
        val invite = assertNotNull(session.pairingInvite.value)

        session.pair(invite, "request-1")

        assertNull(
            session.pairingInvite.value,
            "a successful pairing left its one-time invite in the queue",
        )
        // The stream has not started yet, so `status` still says unpaired. The
        // binding is already published, and that alone has to close the race.
        assertIs<Session.Status.Unpaired>(session.status.value)
        assertNotNull(session.connection.value)

        session.receivePairingURL(link(second, "192.168.1.9"))

        assertNotNull(
            session.pairingInvite.value,
            "a paired phone may add another computer without replacing the live one yet",
        )
    }

    @Test
    fun aWaitingLinkWhoseCredentialWasBurnedIsNotPresentedWhenTheAttemptEnds() = runTest {
        val redeeming = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val session = session(
            pairOutcomeFn = { _, _, _, _ ->
                redeeming.complete(Unit)
                release.await()
                throw APIError.Status(401, "pairing expired")
            },
        )
        session.awaitRestored()

        session.receivePairingURL(link(first, "192.168.1.2"))
        val invite = assertNotNull(session.pairingInvite.value)
        session.consumePairingInvite()

        val attempt = backgroundScope.async { runCatching { session.pair(invite, "request-1") } }
        redeeming.await()
        // The same QR scanned twice: the copy that waits is the credential the
        // attempt is about to have refused and burned.
        session.receivePairingURL(link(first, "10.0.0.5"))
        release.complete(Unit)
        attempt.await()

        assertNull(
            session.pairingInvite.value,
            "a credential the computer had already refused came back as a fresh invite",
        )
    }

    @Test
    fun unpairingEmptiesTheInviteQueue() = runTest {
        val session = session()
        session.awaitRestored()
        session.receivePairingURL(link(first, "192.168.1.2"))
        assertNotNull(session.pairingInvite.value)

        session.signOutAndAwait()

        assertNull(session.pairingInvite.value, "unpairing left a one-time invite in the queue")
    }

    @Test
    fun theFireAndForgetUnpairEmptiesTheInviteQueueToo() = runTest {
        val session = session()
        session.awaitRestored()
        session.receivePairingURL(link(first, "192.168.1.2"))
        assertNotNull(session.pairingInvite.value)

        session.signOut()
        // `signOut` unpairs from a launched coroutine, and `backgroundScope` work
        // only runs while the test body is suspended.
        yield()
        advanceUntilIdle()

        assertNull(session.pairingInvite.value, "unpairing left a one-time invite in the queue")
    }

    /**
     * The sequence that makes the *ordering* of sign-out load-bearing.
     *
     * A link arrives while an attempt is redeeming, so it waits in memory. The
     * unpair is started while that attempt still holds `gate`, so its critical
     * section queues behind it. The attempt then fails — the one moment a
     * waiting invite is published — and only after that does the unpair get the
     * lock. Emptying the queue anywhere earlier than inside that lock would
     * leave the released invite on a phone with no pairing at all: the user
     * would be shown a one-time QR belonging to the binding they just gave up,
     * and be sent back to the computer when it fails.
     */
    private suspend fun TestScope.aDeferredInviteBehindAFailingAttempt(): DeferredInviteScene {
        val redeeming = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val session = session(
            pairOutcomeFn = { _, _, _, _ ->
                redeeming.complete(Unit)
                release.await()
                throw APIError.Transport("the network went away")
            },
        )
        session.awaitRestored()
        session.receivePairingURL(link(first, "192.168.1.2"))
        val invite = assertNotNull(session.pairingInvite.value)
        session.consumePairingInvite()

        val attempt = backgroundScope.async { runCatching { session.pair(invite, "request-1") } }
        redeeming.await()
        // Waits in memory; `aLinkArrivingDuringAnAttemptWaits…` is what proves
        // this one really is released when the attempt ends.
        session.receivePairingURL(link(second, "192.168.1.9"))
        return DeferredInviteScene(session, attempt, release)
    }

    @Test
    fun anUnpairWaitingOnTheGateTakesTheInviteThatAttemptReleases() = runTest {
        val scene = aDeferredInviteBehindAFailingAttempt()

        val unpaired = backgroundScope.async { scene.session.signOutAndAwait() }
        // Let the unpair reach `gate` and queue behind the attempt.
        yield()
        assertFalse(unpaired.isCompleted, "the unpair did not queue behind the running attempt")

        scene.release.complete(Unit)
        scene.attempt.await()
        unpaired.await()

        assertNull(
            scene.session.pairingInvite.value,
            "the invite released by the failing attempt outlived the unpair queued behind it",
        )
    }

    @Test
    fun theFireAndForgetUnpairAlsoTakesTheInviteReleasedBehindIt() = runTest {
        val scene = aDeferredInviteBehindAFailingAttempt()

        scene.session.signOut()
        // `signOut` unpairs from a launched coroutine, and `backgroundScope` work
        // only runs while the test body is suspended.
        yield()

        scene.release.complete(Unit)
        scene.attempt.await()
        yield()
        advanceUntilIdle()

        assertNull(
            scene.session.pairingInvite.value,
            "the invite released by the failing attempt outlived the unpair queued behind it",
        )
    }

    // MOCA-248: "stuck in this alert". Three ways a pairing link used to end in
    // a modal over the wrong screen, or in an empty pairing form.

    /** What the root would put on screen for this session right now. */
    private fun Session.route(): OnboardingRoute = OnboardingRouter.route(
        OnboardingContext(
            pairingState = when {
                status.value is Session.Status.Unauthorized -> OnboardingPairingState.REVOKED
                connection.value != null -> OnboardingPairingState.PAIRED
                else -> OnboardingPairingState.UNPAIRED
            },
            hasSeenWelcome = true,
            pairingRequested = pairingRequested.value,
            hasPendingPairingInvite = pairingInvite.value != null,
        ),
    )

    @Test
    fun aSpentQrLinkReopenedOpensThePairingFormInsteadOfADialogElsewhere() = runTest {
        val session = session(
            pairOutcomeFn = { _, _, _, _ -> throw APIError.Status(410, "pairing expired") },
        )
        session.awaitRestored()
        session.receivePairingURL(link(first, "192.168.1.2"))
        val invite = assertNotNull(session.pairingInvite.value)
        session.consumePairingInvite()

        // An authoritative refusal, not a route failure: the QR is spent.
        assertTrue(runCatching { session.pair(invite, "request-1") }.isFailure)
        // The form showed that failure, and the person left it.
        session.actionError = null
        session.endPairing()
        assertEquals(OnboardingRoute.UNPAIRED_HOME, session.route())

        session.receivePairingURL(link(first, "192.168.1.2"))

        assertTrue(
            session.pairingRequested.value,
            "the spent link raised its error away from the pairing form",
        )
        assertEquals(OnboardingRoute.PAIRING, session.route())
        assertNull(session.pairingInvite.value, "a spent credential was offered again")
        assertEquals(Session.SPENT_QR_MESSAGE, session.actionError)
    }

    @Test
    fun aPairLinkThatDoesNotReadOpensThePairingFormAndSaysSoThere() = runTest {
        val broken = listOf(
            "openmausbot://pair",
            "openmausbot://pair?address=192.168.1.2:8810", // no credential
            "openmausbot://pair?address=192.168.1.2:8810&token=omb_pair_short", // truncated
            "openmausbot://pair?address=192.168.1.2:8810&token=omb pair", // not even a URI
            "OPENMAUSBOT://PAIR?code=12",
        )
        for (url in broken) {
            val session = session()
            session.awaitRestored()

            session.receivePairingURL(url)

            assertTrue(session.pairingRequested.value, "$url did not open the pairing form")
            assertEquals(Session.INVALID_PAIRING_LINK_MESSAGE, session.actionError, url)
            assertNull(session.pairingInvite.value, url)
        }
    }

    @Test
    fun aLinkThisAppDoesNotKnowChangesNothing() = runTest {
        // The desktop's own links among them: a thread reference out of chat
        // markdown, Cloud's "Open in the app".
        val unknown = listOf(
            "openmausbot://thread/t-9f2c?bot=b-1",
            "openmausbot://cloud",
            "openmausbot://pairing",
            "https://example.com/about",
        )
        for (url in unknown) {
            val session = session()
            session.awaitRestored()

            session.receivePairingURL(url)

            assertFalse(session.pairingRequested.value, url)
            assertNull(session.actionError, "$url raised an error")
            assertNull(session.pairingInvite.value, url)
        }
    }

    /** A phone whose only computer revoked it, with a pairing link opened since. */
    private suspend fun TestScope.anInviteHeldBehindTheRevokedScreen(): Pair<Session, PairingInvite> {
        val mac = Connection(id = "c1", name = "Mac", host = "127.0.0.1", port = 8810)
        val tokens = RecordingTokenStore().apply { save(mac.id, "revoked-token") }
        val session = session(
            connectionStore = RecordingConnectionStore().apply { saved = mac },
            tokenStore = tokens,
            events = { flow { throw APIError.Status(401, "revoked") } },
        )
        session.awaitRestored()
        session.connect()
        // The stream lives in `backgroundScope`, which `advanceUntilIdle` does
        // not wait for; `runCurrent` runs it to its refusal.
        runCurrent()
        assertEquals(Session.Status.Unauthorized, session.status.value)

        session.receivePairingURL(link(first, "192.168.1.2"))
        val invite = assertNotNull(session.pairingInvite.value)
        // The router rule stands: recovery first, the invite waits behind it.
        assertEquals(OnboardingRoute.REVOKED, session.route())
        return session to invite
    }

    @Test
    fun anInviteReceivedWhileRevokedSurvivesPairAgain() = runTest {
        val (session, invite) = anInviteHeldBehindTheRevokedScreen()

        session.pairAgainAndAwait()
        session.beginPairing()

        assertNull(session.connection.value)
        assertEquals(
            invite,
            session.pairingInvite.value,
            "Pair again dropped the link the person came back with",
        )
        assertTrue(session.pairingRequested.value)
        assertEquals(OnboardingRoute.PAIRING, session.route())
    }

    @Test
    fun theFireAndForgetPairAgainKeepsTheHeldInviteToo() = runTest {
        val (session, invite) = anInviteHeldBehindTheRevokedScreen()

        // What the revoked screen's button does.
        session.pairAgain()
        session.beginPairing()
        runCurrent()

        assertNull(session.connection.value)
        assertEquals(invite, session.pairingInvite.value)
        assertTrue(session.pairingRequested.value)
    }

    private fun TestScope.session(
        connectionStore: ConnectionStore = RecordingConnectionStore(),
        tokenStore: TokenStore = RecordingTokenStore(),
        pairOutcomeFn: suspend (Connection, String, String, String) -> PairingOutcome =
            { _, _, _, _ -> error("pair not expected") },
        events: () -> Flow<StreamFrame> = { emptyFlow() },
    ): Session = Session(
        scope = backgroundScope,
        connectionStore = connectionStore,
        tokenStore = tokenStore,
        onboardingStore = InMemoryOnboardingStore(),
        deviceNameProvider = { "Pixel" },
        clientFactory = { connection, token -> CompanionClient(connection, token) },
        pairFn = pairOutcomeFn,
        eventsFn = { _, _, _ -> events() },
        hydrateFn = { _, _ -> Fleet(emptyList(), emptyList()) },
        metadataFn = { throw APIError.Status(404) },
    )
}

/** An attempt still redeeming, with a link already waiting behind it. */
private class DeferredInviteScene(
    val session: Session,
    val attempt: Deferred<Result<Unit>>,
    val release: CompletableDeferred<Unit>,
)

private class RecordingConnectionStore : ConnectionStore {
    var saved: Connection? = null
    override suspend fun load(): Connection? = saved
    override suspend fun save(connection: Connection) {
        saved = connection
    }
    override suspend fun clear() {
        saved = null
    }
}

private class RecordingTokenStore : TokenStore {
    private val saved = linkedMapOf<String, String>()
    override suspend fun save(connectionId: String, token: String) {
        saved[connectionId] = token
    }
    override suspend fun read(connectionId: String): TokenStore.ReadResult =
        saved[connectionId]?.let(TokenStore.ReadResult::Found) ?: TokenStore.ReadResult.Missing
    override suspend fun remove(connectionId: String) {
        saved.remove(connectionId)
    }
}
