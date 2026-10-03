import XCTest
import Combine
@testable import CompanionCore

final class EventBatchTests: XCTestCase {
    private func delta(_ seq: Int, thread: String = "other-bot", text: String = "x") -> StreamFrame {
        StreamFrame(frame: .runtime(RuntimeEvent(type: "content.delta", threadId: thread,
                                                delta: text, streamKind: "assistant_text")), seq: seq)
    }

    private func source(_ frames: [StreamFrame]) -> AsyncThrowingStream<StreamFrame, Error> {
        AsyncThrowingStream { continuation in
            for frame in frames { continuation.yield(frame) }
            continuation.finish()
        }
    }

    func testBurstIsBoundedOrderedAndFoldsEveryTokenAndCursor() async throws {
        let input = (1...500).map { delta($0, thread: "bot-\($0 % 20)") }
        var batches: [[StreamFrame]] = []
        for try await batch in eventBatches(source(input), intervalNanoseconds: 60_000_000_000) {
            batches.append(batch)
        }
        XCTAssertEqual(batches.count, 5, "500 tokens should not publish 1,000 global state mutations")
        XCTAssertEqual(batches.flatMap { $0 }.compactMap(\.seq), Array(1...500))
        XCTAssertTrue(batches.allSatisfy { $0.count <= 100 })
        var state = CompanionState()
        state.resetCursor("fixture:0")
        for batch in batches { state.applyBatch(batch) }
        XCTAssertEqual(state.cursor, "fixture:500")
        XCTAssertEqual(state.streaming.count, 20)
        XCTAssertTrue(state.streaming.values.allSatisfy { $0 == String(repeating: "x", count: 25) })
    }

    func testHelloIsAloneAndControlsFlushPendingWithoutWaitingForTimer() async throws {
        let notification = NotificationFrame(kind: "approval", botId: "b", botName: "Bot",
                                             threadId: "t", title: "Approve", body: "Run?")
        let controls: [Frame] = [
            .hello(cursor: "fixture:0", resumed: true),
            .notify(notification),
            .runtime(RuntimeEvent(type: "turn.completed", threadId: "t")),
            .message(threadId: "t", message: Message(id: "done", role: .bot, kind: .text, at: 1)),
            .botDeleted(botId: "b"),
        ]
        let input = AsyncThrowingStream<StreamFrame, Error>.makeStream()
        let delivered = expectation(description: "controls flush while input remains open")
        delivered.expectedFulfillmentCount = controls.count
        let consumer = Task {
            var received: [[StreamFrame]] = []
            for try await batch in eventBatches(input.stream, intervalNanoseconds: 60_000_000_000) {
                received.append(batch)
                delivered.fulfill()
                if received.count == controls.count { break }
            }
            return received
        }
        for (index, frame) in controls.enumerated() {
            if index > 0 { input.continuation.yield(delta(index * 2 - 1)) }
            input.continuation.yield(StreamFrame(frame: frame, seq: index * 2))
        }
        await fulfillment(of: [delivered], timeout: 2)
        let received = try await consumer.value
        XCTAssertEqual(received.first?.count, 1)
        XCTAssertEqual(received.dropFirst().map(\.count), [2, 2, 2, 2])
        XCTAssertEqual(received.flatMap { $0 }.compactMap(\.seq), Array(0...8))
        input.continuation.finish()
    }

    func testLoneDeltaArrivesWithoutMoreInputAndErrorFlushesTail() async throws {
        let input = AsyncThrowingStream<StreamFrame, Error>.makeStream()
        let delivered = expectation(description: "timer delivers an unfinished reply")
        let consumer = Task {
            var received: [Int] = []
            do {
                for try await batch in eventBatches(input.stream, intervalNanoseconds: 10_000_000) {
                    received += batch.compactMap(\.seq)
                    if received == [1] {
                        delivered.fulfill()
                        input.continuation.yield(self.delta(2))
                        input.continuation.finish(throwing: URLError(.networkConnectionLost))
                    }
                }
                XCTFail("transport failure must survive batching")
            } catch let error as URLError {
                XCTAssertEqual(error.code, .networkConnectionLost)
            }
            return received
        }
        input.continuation.yield(delta(1))
        await fulfillment(of: [delivered], timeout: 2)
        let result = try await consumer.value
        XCTAssertEqual(result, [1, 2])
    }

    func testCancellationStopsInputAndDoesNotPublishThePendingTail() async throws {
        let input = AsyncThrowingStream<StreamFrame, Error>.makeStream()
        let stopped = expectation(description: "input cancelled")
        input.continuation.onTermination = { _ in stopped.fulfill() }
        let received = expectation(description: "hello received")
        let consumer = Task {
            var sequences: [Int] = []
            for try await batch in eventBatches(input.stream, intervalNanoseconds: 60_000_000_000) {
                sequences += batch.compactMap(\.seq)
                received.fulfill()
            }
            return sequences
        }
        input.continuation.yield(StreamFrame(frame: .hello(cursor: "fixture:0", resumed: true), seq: 0))
        input.continuation.yield(delta(1))
        await fulfillment(of: [received], timeout: 2)
        consumer.cancel()
        await fulfillment(of: [stopped], timeout: 2)
        let result = try await consumer.value
        XCTAssertEqual(result, [0], "the unpublished tail must be replayed, not advance state")
    }

    @MainActor
    func testBatchPublishesOnceIncludingCursorAndPreservesOtherLocalWork() {
        final class Model: ObservableObject { @Published var state = CompanionState() }
        let model = Model()
        model.state.resetCursor("fixture:0")
        model.state.pendingEdits["selected"] = PendingEdit(sourceId: "user", text: "my edit")
        var publications = 0
        let observation = model.objectWillChange.sink { publications += 1 }
        var next = model.state
        next.applyBatch((1...100).map { delta($0) })
        model.state = next
        XCTAssertEqual(publications, 1)
        XCTAssertEqual(model.state.cursor, "fixture:100")
        XCTAssertEqual(model.state.pendingEdits["selected"]?.text, "my edit")
        withExtendedLifetime(observation) {}
    }
}
