import Foundation
import XCTest
@testable import CompanionCore

private final class BrowserTransportStub: URLProtocol {
    static var status = 200
    static var body = ""
    static var finish = true
    static var timeout: TimeInterval = 0
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.timeout = request.timeoutInterval
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.status,
            httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/event-stream"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(Self.body.utf8))
        if Self.finish { client?.urlProtocolDidFinishLoading(self) }
    }
    override func stopLoading() {}
}

final class BrowserLiveTransportTests: XCTestCase {
    private var session: URLSession!
    override func setUp() {
        BrowserTransportStub.status = 200
        BrowserTransportStub.body = ""
        BrowserTransportStub.finish = true
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [BrowserTransportStub.self]
        session = URLSession(configuration: configuration)
    }
    override func tearDown() { session.invalidateAndCancel() }
    private func client() -> BrowserLiveClient {
        BrowserLiveClient(connection: Connection(name: "Synthetic computer", host: "127.0.0.1", port: 1), token: "fixture", session: session)
    }

    func testRealByteStreamUsesFiniteIdleTimeoutAndPreservesControlOwnership() async throws {
        BrowserTransportStub.body = "event: ready\ndata: {\"viewerId\":\"fixture\"}\n\n"
            + "event: control\ndata: {\"controlling\":true,\"owned\":false,\"held\":false}\n\n"
        var messages: [BrowserLiveMessage] = []
        for try await message in client().live(botId: "fixture") { messages.append(message) }
        XCTAssertEqual(BrowserTransportStub.timeout, 90)
        XCTAssertEqual(messages, [.ready(viewerId: "fixture"), .control(controlling: true, held: false, owned: false)])
    }

    func testRefusalBodyThatNeverClosesStillReportsTheStatus() async {
        BrowserTransportStub.status = 403
        BrowserTransportStub.body = "{"
        BrowserTransportStub.finish = false
        let started = Date()
        do {
            for try await _ in client().live(botId: "fixture") { XCTFail("refusal yielded a frame") }
            XCTFail("expected refusal")
        } catch let error as APIError {
            guard case let .status(code, _) = error else { return XCTFail("\(error)") }
            XCTAssertEqual(code, 403)
        } catch { XCTFail("\(error)") }
        XCTAssertLessThan(Date().timeIntervalSince(started), 5)
    }

    func testOversizeUnterminatedEventStopsTheTransport() async {
        BrowserTransportStub.body = "data: " + String(repeating: "a", count: 4 * 1024 * 1024)
        do {
            for try await _ in client().live(botId: "fixture") { XCTFail("oversize event yielded a frame") }
            XCTFail("expected size refusal")
        } catch let error as APIError {
            XCTAssertTrue(error.localizedDescription.contains("too large"))
        } catch { XCTFail("\(error)") }
    }

    func testFrameAcknowledgementsCoalesceAndStopOnTeardown() async {
        let began = expectation(description: "first acknowledgement began")
        let latest = expectation(description: "latest acknowledgement sent")
        let cancelled = expectation(description: "in-flight acknowledgement cancelled")
        let queue = BrowserFrameAcks { sequence in
            if sequence == 1 {
                began.fulfill()
                try await Task.sleep(nanoseconds: 100_000_000)
            } else {
                XCTAssertEqual(sequence, 100)
                latest.fulfill()
                do { try await Task.sleep(nanoseconds: 10_000_000_000) }
                catch { cancelled.fulfill(); throw error }
            }
        }
        await queue.enqueue(1)
        await fulfillment(of: [began], timeout: 1)
        for sequence in 2...100 { await queue.enqueue(sequence) }
        await fulfillment(of: [latest], timeout: 1)
        await queue.stop()
        await fulfillment(of: [cancelled], timeout: 1)
        await queue.enqueue(101)
    }
}
