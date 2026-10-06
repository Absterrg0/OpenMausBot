package com.openmausbot.companion.core

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.ReceiveChannel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.buffer
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.produceIn
import kotlinx.coroutines.selects.select

/**
 * Stream frames in ordered batches, at most one per [windowMillis], so a busy
 * fleet costs the phone a few state publishes a second rather than one per
 * frame. The iPhone's `eventBatches`, the Flow way.
 *
 * With five bots working the stream carries about seventy frames a second,
 * and each one used to publish its own [CompanionState]: every publish that
 * reached a drawn frame re-derived the whole home list. Every frame rides the
 * window, not only tokens. Only what someone is waiting on closes it early
 * ([closesBatchWindow]): an ask, a notification, an error, a stopped turn, the
 * Live call's line. Hello is always a batch of its own, after everything
 * before it.
 *
 * Batches are pulled, not pushed: the source is read into an unbounded buffer
 * while the collector works, and the next batch takes everything that arrived
 * meanwhile. A phone that fell behind folds its backlog in one publish
 * instead of replaying it window by window. No frame is dropped or reordered,
 * so the last folded sequence stays the replay cursor; a source failure is
 * thrown after every frame read before it. A collector that is cancelled
 * leaves what it had not taken to be replayed on reconnect.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun Flow<StreamFrame>.inBatches(
    windowMillis: Long = FRAME_BATCH_WINDOW_MILLIS,
    maximumCount: Int = FRAME_BATCH_MAXIMUM,
): Flow<List<StreamFrame>> = flow {
    require(windowMillis >= 0 && maximumCount > 0)
    coroutineScope {
        // A transport failure is handed over after the frames read before it,
        // as the end of the stream, rather than cancelling them with this scope:
        // a hello that arrived just before a cut still commits its cursor.
        var failure: Throwable? = null
        val source = this@inBatches
            .catch { failure = it }
            .buffer(Channel.UNLIMITED)
            .produceIn(this)
        // A hello read while a batch was filling: it starts the next one.
        var carried: StreamFrame? = null
        while (true) {
            val first = carried ?: (source.receiveOrEnd() ?: break)
            carried = null
            if (first.frame is Frame.Hello) {
                emit(listOf(first))
                continue
            }
            val batch = mutableListOf(first)
            var open = !first.frame.closesBatchWindow
            // Whatever is already waiting joins without a wait of its own.
            while (open) {
                val next = source.tryReceive().getOrNull() ?: break
                if (next.frame is Frame.Hello) {
                    carried = next
                    open = false
                } else {
                    batch += next
                    if (next.frame.closesBatchWindow) open = false
                }
            }
            // Then the rest of the window, unless it is already full.
            val window = if (open && batch.size < maximumCount) async { delay(windowMillis) } else null
            while (open && batch.size < maximumCount) {
                val next = select<WindowRead> {
                    source.onReceiveCatching { result -> result.getOrNull()?.let(WindowRead::Frame) ?: WindowRead.Ended }
                    window!!.onAwait { WindowRead.TimedOut }
                }
                when (next) {
                    is WindowRead.Frame -> if (next.frame.frame is Frame.Hello) {
                        carried = next.frame
                        open = false
                    } else {
                        batch += next.frame
                        if (next.frame.frame.closesBatchWindow) open = false
                    }
                    // What was read before the end is still handed over; the
                    // end itself surfaces on the next receive.
                    WindowRead.Ended, WindowRead.TimedOut -> open = false
                }
            }
            window?.cancel()
            emit(batch)
        }
        failure?.let { throw it }
    }
}

/** The next frame, null once the source has ended. */
private suspend fun ReceiveChannel<StreamFrame>.receiveOrEnd(): StreamFrame? = receiveCatching().getOrNull()

private sealed interface WindowRead {
    data class Frame(val frame: StreamFrame) : WindowRead
    data object Ended : WindowRead
    data object TimedOut : WindowRead
}

/**
 * A frame someone is waiting on. It closes the current window instead of
 * riding it; everything else (tokens, tool steps, settled replies, bot and
 * room updates) waits at most one window. The iPhone's list.
 */
internal val Frame.closesBatchWindow: Boolean
    get() = when (this) {
        is Frame.Notify, is Frame.LiveCall -> true
        // a new approval or question card
        is Frame.Message -> message.opensAsk
        is Frame.MessagePatch -> message.opensAsk
        is Frame.Runtime -> event.type in WINDOW_CLOSING_RUNTIME_TYPES
        else -> false
    }

private val Message.opensAsk: Boolean
    get() = card?.isPending == true

private val WINDOW_CLOSING_RUNTIME_TYPES =
    setOf("request.opened", "request.resolved", "runtime.error", "turn.failed", "turn.aborted")

/** The iPhone's window: about twenty publishes a second at most. */
const val FRAME_BATCH_WINDOW_MILLIS = 50L

/** A window this full closes without waiting out its time. */
internal const val FRAME_BATCH_MAXIMUM = 100
