#if DEBUG
import Foundation
import os

/// Offline native regression. Every request is intercepted; no pairing,
/// credentials, real host or user's stored memory can be reached.
final class MemoryPreviewProtocol: URLProtocol {
    @MainActor static var onMutation: (() -> Void)?
    private static let state = OSAllocatedUnfairLock(initialState: (detail: "Original HQ", writes: 0))
    private var held: DispatchWorkItem?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let path = request.url?.path ?? ""
        let method = request.httpMethod ?? "GET"
        if path == "/api/events" {
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/event-stream"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data("data: {\"kind\":\"hello\",\"cursor\":\"memory-preview:1\",\"resumed\":true}\n\n".utf8))
            return
        }
        let newComputer = request.value(forHTTPHeaderField: "Authorization") == "Bearer memory-fixture-new"
        var status = 200
        var delay = 0.0
        let body: [String: Any]
        if path == "/api/team-memory", method == "GET" {
            body = ["section": "", "label": "General", "entries": [entry(newComputer: newComputer)]]
        } else if path == "/api/team-memory/memory_1", method == "PATCH" {
            let detail = requestObject()["detail"] as? String ?? ""
            Self.state.withLock { state in state.writes += 1; state.detail = "\(detail) | writes: \(state.writes)" }
            Task { @MainActor in Self.onMutation?() }
            if ProcessInfo.processInfo.arguments.contains("-memory-stale-preview") { status = 401 }
            body = status == 401 ? ["error": "old computer revoked"] : ["entries": [entry(newComputer: false)]]
            delay = status == 401 ? 2 : 5
        } else if path == "/api/tts/voices" {
            body = ["voices": []]
        } else if path == "/api/instances" {
            body = ["instances": []]
        } else if path == "/api/config" {
            body = [:]
        } else {
            status = 404
            body = ["error": "not in the offline fixture"]
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        let data = (try? JSONSerialization.data(withJSONObject: body)) ?? Data()
        let answer = { [self] in
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        }
        if delay > 0 {
            let work = DispatchWorkItem(block: answer)
            held = work
            DispatchQueue.global().asyncAfter(deadline: .now() + delay, execute: work)
        } else { answer() }
    }

    override func stopLoading() { held?.cancel(); held = nil }

    private func entry(newComputer: Bool) -> [String: Any] {
        ["id": "memory_1", "kind": "term", "name": newComputer ? "New computer" : "MCHQ",
         "detail": newComputer ? "Current host memory" : Self.state.withLock { $0.detail },
         "aliases": [], "status": "accepted", "source": ["botId": "", "botName": "you", "threadId": "", "at": 1], "updatedAt": 1]
    }

    private func requestObject() -> [String: Any] {
        var data = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var bytes = [UInt8](repeating: 0, count: 1_024)
            while stream.hasBytesAvailable {
                let count = stream.read(&bytes, maxLength: bytes.count)
                if count <= 0 { break }
                data.append(contentsOf: bytes.prefix(count))
            }
        }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }
}
#endif
