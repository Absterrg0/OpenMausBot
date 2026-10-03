#if DEBUG
import CompanionCore
import Foundation
import SwiftUI

/// Offline native UI acceptance. Every request is intercepted; no host, token
/// store, user browser, model, microphone or phone pairing is used.
enum BrowserPreview {
    static let client: BrowserLiveClient = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [BrowserPreviewProtocol.self]
        return BrowserLiveClient(connection: Connection(name: "Synthetic computer", host: "127.0.0.1", port: 1),
            token: "browser-fixture", session: URLSession(configuration: configuration))
    }()
}

struct BrowserPreviewNavigation: View {
    let bot: Bot
    var body: some View {
        NavigationStack {
            List {
                NavigationLink("Open browser") { BrowserControlView(bot: bot, client: BrowserPreview.client) }
            }
            .navigationTitle("Browser fixture")
        }
    }
}

private final class BrowserPreviewProtocol: URLProtocol {
    private static let queue = DispatchQueue(label: "browser-fixture")
    private static var streams: [String: BrowserPreviewProtocol] = [:]
    private static var owner: String?
    private static var releases = 0
    private static var typed = ""
    private let viewer = UUID().uuidString
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.queue.async { [self] in
            guard request.value(forHTTPHeaderField: "Authorization") == "Bearer browser-fixture" else {
                client?.urlProtocol(self, didFailWithError: URLError(.userAuthenticationRequired))
                return
            }
            if request.httpMethod == "GET", request.url?.path.hasSuffix("/browser/live") == true {
                Self.streams[viewer] = self
                answerHeaders("text/event-stream")
                event("ready", ["viewerId": viewer])
                event("status", ["connected": true, "screencasting": true, "viewportWidth": 1280, "viewportHeight": 720])
                event("url", ["url": "https://fixture.test/?releases=\(Self.releases)"])
                event("frame", ["seq": 1, "format": "png",
                    "data": "iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAAEUlEQVR4nGMIIBEwjGoYFBoAUAWHAeeubRIAAAAASUVORK5CYII=",
                    "metadata": ["deviceWidth": 1280, "deviceHeight": 720]])
                control()
                return
            }
            let body = object()
            let id = body["viewerId"] as? String ?? ""
            switch body["type"] as? String {
            case "take": Self.owner = id; Self.typed = ""
            case "release":
                if Self.owner == id { Self.owner = nil; Self.releases += 1 }
            case "navigate": Self.streams[id]?.event("url", ["url": body["url"] ?? ""])
            case "input_mouse":
                if body["eventType"] as? String == "mouseReleased" {
                    Self.streams[id]?.event("url", ["url": "https://fixture.test/tap?x=\(body["x"] ?? 0)&y=\(body["y"] ?? 0)"])
                }
            case "input_keyboard":
                Self.typed += body["text"] as? String ?? ""
                Self.streams[id]?.event("url", ["url": "https://fixture.test/typed?value=\(Self.typed)"])
            default: break
            }
            Self.streams.values.forEach { $0.control() }
            answerHeaders("application/json")
            client?.urlProtocol(self, didLoad: Data("{}".utf8))
            client?.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() {
        Self.queue.async { [self] in Self.streams.removeValue(forKey: viewer) }
    }

    private func answerHeaders(_ type: String) {
        let response = HTTPURLResponse(url: request.url!, statusCode: 200,
            httpVersion: "HTTP/1.1", headerFields: ["Content-Type": type])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    }

    private func control() {
        event("control", ["controlling": Self.owner == nil || Self.owner == viewer,
                          "held": Self.owner != nil, "owned": Self.owner == viewer])
    }

    private func event(_ name: String, _ body: [String: Any]) {
        let json = String(decoding: try! JSONSerialization.data(withJSONObject: body), as: UTF8.self)
        client?.urlProtocol(self, didLoad: Data("event: \(name)\ndata: \(json)\n\n".utf8))
    }

    private func object() -> [String: Any] {
        var data = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
        }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }
}
#endif
