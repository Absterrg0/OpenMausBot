package com.openmausbot.companion.core

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.consumeAsFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class FrameBatchesTest {
    private fun token(seq: Int) =
        StreamFrame(Frame.Runtime(RuntimeEvent("content.delta", "t1", "w$seq", "assistant_text")), seq)

    private fun hello(seq: Int) = StreamFrame(Frame.Hello("c:$seq", resumed = false), seq)

    private fun notify(seq: Int) =
        StreamFrame(Frame.Notify(NotificationFrame("reply", "b1", "Scout", "t1", "Scout", "Done")), seq)

    private fun ask(seq: Int) = StreamFrame(
        Frame.Message(
            "t1",
            Message(
                id = "m$seq", role = Message.Role.BOT, kind = Message.Kind.OPTIONS, at = 1.0,
                card = OptionCard("Run it?", "", listOf("Allow", "Deny"), requestId = "r$seq"),
            ),
        ),
        seq,
    )

    private fun failed(seq: Int) = StreamFrame(Frame.Runtime(RuntimeEvent("turn.failed", "t1")), seq)

    private fun List<List<StreamFrame>>.seqs() = map { batch -> batch.map { it.seq } }

    @Test
    fun framesInsideOneWindowArriveAsOneBatch() = runTest {
        val source = Channel<StreamFrame>(Channel.UNLIMITED)
        val batches = mutableListOf<Pair<Long, List<StreamFrame>>>()
        val job = launch { source.consumeAsFlow().inBatches(windowMillis = 50).collect { batches += currentTime to it } }
        source.send(token(1))
        advanceTimeBy(20)
        source.send(token(2))
        source.send(token(3))
        runCurrent()
        assertTrue(batches.isEmpty(), "a token waits out its window")
        advanceTimeBy(31)
        assertEquals(listOf(listOf(1, 2, 3)), batches.map { it.second }.seqs())
        assertEquals(50L, batches.single().first)
        source.close()
        job.join()
    }

    @Test
    fun whatSomeoneIsWaitingOnClosesTheWindowAtOnce() = runTest {
        for (urgent in listOf(notify(2), ask(2), failed(2))) {
            val source = Channel<StreamFrame>(Channel.UNLIMITED)
            val batches = mutableListOf<List<StreamFrame>>()
            val job = launch { source.consumeAsFlow().inBatches(windowMillis = 50).collect { batches += it } }
            source.send(token(1))
            runCurrent()
            source.send(urgent)
            runCurrent()
            assertEquals(listOf(listOf(1, 2)), batches.seqs(), "${urgent.frame} closes the window without waiting")
            source.close()
            job.join()
        }
    }

    @Test
    fun aSettledReplyOrToolStepRidesTheWindow() {
        val reply = Message(id = "m1", role = Message.Role.BOT, kind = Message.Kind.TEXT, at = 1.0, text = "hi")
        val answered = OptionCard("Run it?", "", listOf("Allow"), requestId = "r1", answered = "Allow")
        assertEquals(false, Frame.Message("t1", reply).closesBatchWindow)
        assertEquals(false, Frame.MessagePatch("t1", reply.copy(card = answered)).closesBatchWindow)
        assertEquals(false, Frame.Runtime(RuntimeEvent("item.completed", "t1")).closesBatchWindow)
        assertEquals(true, Frame.LiveCall("b1", "t1", null).closesBatchWindow)
    }

    @Test
    fun helloIsABatchOfItsOwnAfterEverythingBeforeIt() = runTest {
        val frames = listOf(token(1), token(2), hello(3), token(4))
        val batches = flow { frames.forEach { emit(it) } }.inBatches(windowMillis = 50).toList()
        assertEquals(listOf(listOf(1, 2), listOf(3), listOf(4)), batches.seqs())
    }

    @Test
    fun aCollectorThatFellBehindTakesTheBacklogInOneBatch() = runTest {
        val source = Channel<StreamFrame>(Channel.UNLIMITED)
        val batches = mutableListOf<List<StreamFrame>>()
        val job = launch {
            source.consumeAsFlow().inBatches(windowMillis = 50).collect {
                batches += it
                delay(1_000) // a slow fold: frames keep coming meanwhile
            }
        }
        source.send(token(1))
        advanceTimeBy(60)
        for (seq in 2..40) source.send(token(seq))
        advanceTimeBy(1_100)
        assertEquals(listOf(listOf(1), (2..40).toList()), batches.seqs())
        source.close()
        job.join()
    }

    @Test
    fun aFullWindowClosesWithoutWaiting() = runTest {
        val source = Channel<StreamFrame>(Channel.UNLIMITED)
        val batches = mutableListOf<List<StreamFrame>>()
        val job = launch { source.consumeAsFlow().inBatches(windowMillis = 50, maximumCount = 3).collect { batches += it } }
        source.send(token(1))
        runCurrent()
        source.send(token(2))
        source.send(token(3))
        runCurrent()
        assertEquals(listOf(listOf(1, 2, 3)), batches.seqs())
        source.close()
        job.join()
    }

    @Test
    fun aSourceFailureReachesTheCollectorAfterWhatCameBeforeIt() = runTest {
        // A hello read just before the cut still has to commit its cursor.
        val batches = mutableListOf<List<StreamFrame>>()
        val error = assertFailsWith<APIError.Transport> {
            flow {
                emit(token(1))
                emit(hello(2))
                throw APIError.Transport("gone")
            }.inBatches(windowMillis = 50).collect { batches += it }
        }
        assertEquals("gone", error.message)
        assertEquals(listOf(listOf(1), listOf(2)), batches.seqs())
    }

    @Test
    fun anEndedSourceHandsOverWhatItSent() = runTest {
        val batches = flow { emit(token(1)); emit(token(2)) }.inBatches(windowMillis = 50).toList()
        assertEquals(listOf(listOf(1, 2)), batches.seqs())
    }
}
