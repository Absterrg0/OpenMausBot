import Foundation

/// Coalesce token bursts before they cross onto the UI actor. Everything else
/// (especially approvals, settled messages and hello) is an immediate barrier.
/// No frame is discarded: the last folded sequence remains the replay cursor.
public func eventBatches(
    _ events: AsyncThrowingStream<StreamFrame, Error>,
    intervalNanoseconds: UInt64 = 50_000_000,
    maximumCount: Int = 100
) -> AsyncThrowingStream<[StreamFrame], Error> {
    precondition(maximumCount > 0)
    return AsyncThrowingStream { continuation in
        let buffer = EventBatchBuffer(continuation: continuation,
                                      interval: intervalNanoseconds, maximumCount: maximumCount)
        let task = Task {
            do {
                for try await frame in events {
                    try Task.checkCancellation()
                    await buffer.append(frame)
                }
                await buffer.finish()
            } catch {
                await buffer.finish(throwing: error)
            }
        }
        continuation.onTermination = { _ in
            task.cancel()
            Task { await buffer.cancel() }
        }
    }
}

private actor EventBatchBuffer {
    let continuation: AsyncThrowingStream<[StreamFrame], Error>.Continuation
    let interval: UInt64
    let maximumCount: Int
    var pending: [StreamFrame] = []
    var timer: Task<Void, Never>?
    var generation = 0
    var ended = false

    init(continuation: AsyncThrowingStream<[StreamFrame], Error>.Continuation,
         interval: UInt64, maximumCount: Int) {
        self.continuation = continuation
        self.interval = interval
        self.maximumCount = maximumCount
    }

    func append(_ frame: StreamFrame) {
        guard !ended else { return }
        if case .hello = frame.frame {
            flush()
            continuation.yield([frame])
            return
        }
        pending.append(frame)
        guard case let .runtime(event) = frame.frame, event.type == "content.delta",
              pending.count < maximumCount else { flush(); return }
        guard timer == nil else { return }
        let expected = generation
        timer = Task { [weak self, interval] in
            do { try await Task.sleep(nanoseconds: interval) } catch { return }
            await self?.flush(ifGeneration: expected)
        }
    }

    func flush(ifGeneration expected: Int? = nil) {
        guard expected == nil || expected == generation else { return }
        timer?.cancel()
        timer = nil
        generation &+= 1
        guard !pending.isEmpty else { return }
        continuation.yield(pending)
        pending.removeAll(keepingCapacity: true)
    }

    func finish(throwing error: Error? = nil) {
        guard !ended else { return }
        flush()
        ended = true
        continuation.finish(throwing: error)
    }

    func cancel() {
        ended = true
        timer?.cancel()
        timer = nil
        pending.removeAll()
    }
}
