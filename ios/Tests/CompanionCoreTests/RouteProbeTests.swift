import Foundation
import XCTest
@testable import CompanionCore

/// Answers every request with whatever the test set: an HTTP status, or a
/// transport failure, and remembers the request it was asked.
private final class RouteProbeStub: URLProtocol {
    nonisolated(unsafe) static var status = 200
    nonisolated(unsafe) static var failure: URLError?
    nonisolated(unsafe) static var lastRequest: URLRequest?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lastRequest = request
        if let failure = Self.failure {
            client?.urlProtocol(self, didFailWithError: failure)
            return
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: "HTTP/1.1", headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"app":"openmausbot"}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class RouteProbeTests: XCTestCase {
    private var session: URLSession!
    private var client: CompanionClient!

    override func setUp() {
        super.setUp()
        RouteProbeStub.status = 200
        RouteProbeStub.failure = nil
        RouteProbeStub.lastRequest = nil
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RouteProbeStub.self]
        session = URLSession(configuration: configuration)
        client = CompanionClient(
            connection: Connection(name: "Test", host: "192.168.1.42", port: 8810),
            token: "paired-token"
        )
    }

    override func tearDown() {
        session.invalidateAndCancel()
        super.tearDown()
    }

    func testAnAnsweringRouteIsKept() async throws {
        try await client.probeRoute(session: session)
        XCTAssertEqual(RouteProbeStub.lastRequest?.url?.path, "/api/health")
        // Seconds, not the stream's ninety.
        XCTAssertEqual(RouteProbeStub.lastRequest?.timeoutInterval, 10)
    }

    func testAnyNonGatewayAnswerMeansTheRouteWorks() async throws {
        for status in [401, 404, 500] {
            RouteProbeStub.status = status
            try await client.probeRoute(session: session)
        }
    }

    func testNoAnswerThrowsSoTheRotationMovesOn() async {
        RouteProbeStub.failure = URLError(.timedOut)
        do {
            try await client.probeRoute(session: session)
            XCTFail("a route that never answered must throw")
        } catch {
            XCTAssertEqual((error as? URLError)?.code, .timedOut)
            XCTAssertTrue(ConnectionAdvice.shouldTryAnotherRoute(after: error))
        }
    }

    func testAGatewaySayingTheTunnelIsDownThrows() async {
        RouteProbeStub.status = 530
        do {
            try await client.probeRoute(session: session)
            XCTFail("a gateway failure must throw")
        } catch {
            XCTAssertTrue(ConnectionAdvice.shouldTryAnotherRoute(after: error))
        }
    }

    func testTheStreamFailsInsteadOfWaitingForConnectivity() {
        // A waiting task suspends its timeout and never throws: "Connecting…"
        // forever on 5G with cellular data off (MOCA-82).
        XCTAssertFalse(CompanionClient.streaming.configuration.waitsForConnectivity)
    }
}
