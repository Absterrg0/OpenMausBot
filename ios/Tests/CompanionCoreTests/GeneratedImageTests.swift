import Foundation
import XCTest
@testable import CompanionCore

final class GeneratedImageTests: XCTestCase {
    func testGeneratedImagesSurviveMessageDecodeAndCacheRoundTrip() throws {
        let source = #"{"id":"reply","role":"bot","kind":"text","at":1,"text":"Screenshot attached","attachments":[{"kind":"image","path":"/tmp/screenshot.png","mime":"image/png"}]}"#
        let message = try JSONDecoder().decode(Message.self, from: Data(source.utf8))
        let stored = try JSONSerialization.jsonObject(with: JSONEncoder().encode(message)) as! [String: Any]
        let attachments = stored["attachments"] as? [[String: String]]
        XCTAssertEqual(attachments?.first?["path"], "/tmp/screenshot.png")
    }

    func testImageOnlyPatchPreservesImagesAndIgnoresFutureKinds() throws {
        let source = #"{"id":"reply","role":"bot","kind":"text","at":1,"attachments":[{"kind":"video"},{"kind":"image","path":"/tmp/screen 100%.png","mime":"image/png"},{"kind":"image","path":"/tmp/screen 100%.png"},{"kind":"image","path":" "}]}"#
        let message = try JSONDecoder().decode(Message.self, from: Data(source.utf8))
        var state = CompanionState()
        state.apply(.message(threadId: "thread", message: Message(id: "reply", role: .bot, kind: .text, at: 1)))
        state.apply(.messagePatch(threadId: "thread", message: message))
        let patched = try XCTUnwrap(state.transcript(forThread: "thread").first)
        XCTAssertEqual(patched.generatedImages, [DisplayedMessageAttachment(kind: .image, path: "/tmp/screen 100%.png", name: "screen 100%.png")])
        XCTAssertNil(patched.text)
    }

    func testLegacyTextHasNoGeneratedImages() throws {
        let message = try JSONDecoder().decode(Message.self, from: Data(#"{"id":"old","role":"bot","kind":"text","at":1,"text":"Still visible"}"#.utf8))
        XCTAssertTrue(message.generatedImages.isEmpty)
        XCTAssertEqual(message.text, "Still visible")
    }

    /// A bot's attach_file sends documents, audio and video as `kind:"file"`
    /// with a name (server/bot-attachment.ts). The phone dropped them, and the
    /// message read as an empty bubble (MOCA-155). They are file cards now,
    /// opened through the same message-scoped file route as images.
    func testABotsFileAttachmentsBecomeNamedFileCards() throws {
        let source = #"{"id":"sent","role":"bot","kind":"text","at":1,"text":"","attachments":[{"kind":"file","path":"/data/attachments/9f.mp4","mime":"video/mp4","name":"demo clip.mp4"},{"kind":"image","path":"/data/attachments/a1.png","mime":"image/png"},{"kind":"file","path":"/data/attachments/77.pdf","mime":"application/pdf","name":"../../report.pdf"},{"kind":"file","path":"/data/attachments/9f.mp4","name":"again.mp4"},{"kind":"file","path":" "},{"kind":"hologram","path":"/data/attachments/x.bin"}]}"#
        let message = try JSONDecoder().decode(Message.self, from: Data(source.utf8))
        XCTAssertEqual(message.attachedFiles, [
            DisplayedMessageAttachment(kind: .file, path: "/data/attachments/9f.mp4", name: "demo clip.mp4"),
            // A crafted name is presentation only and never a path.
            DisplayedMessageAttachment(kind: .file, path: "/data/attachments/77.pdf", name: "report.pdf"),
        ])
        XCTAssertEqual(message.generatedImages.map(\.path), ["/data/attachments/a1.png"], "images keep their own card")
        XCTAssertEqual(message.attachments?.first?.name, "demo clip.mp4")
        // The name survives the transcript cache.
        let cached = try JSONDecoder().decode(Message.self, from: JSONEncoder().encode(message))
        XCTAssertEqual(cached.attachedFiles, message.attachedFiles)
    }

    func testAFileOnlyBotMessagePreviewsAsItsFileName() throws {
        let source = #"{"id":"sent","role":"bot","kind":"text","at":1,"text":"","attachments":[{"kind":"file","path":"/data/attachments/9f.mp4","mime":"video/mp4","name":"demo clip.mp4"}]}"#
        let message = try JSONDecoder().decode(Message.self, from: Data(source.utf8))
        XCTAssertEqual(rosterPreview([message], detail: .full), "demo clip.mp4")
        var captioned = message
        captioned.text = "Here is the clip"
        XCTAssertEqual(rosterPreview([captioned], detail: .full), "Here is the clip", "words beat a file name")
    }

    func testAFileCardKnowsVideoAndAudioFromTheExtension() {
        func family(_ name: String) -> DisplayedMessageAttachment.FileFamily {
            DisplayedMessageAttachment(kind: .file, path: "/data/attachments/x", name: name).fileFamily
        }
        XCTAssertEqual(family("demo clip.MP4"), .video)
        XCTAssertEqual(family("screen.mov"), .video)
        XCTAssertEqual(family("talk.webm"), .video)
        XCTAssertEqual(family("memo.m4a"), .audio)
        XCTAssertEqual(family("song.mp3"), .audio)
        XCTAssertEqual(family("weekly-report.pdf"), .document)
        XCTAssertEqual(family("notes"), .document)
    }
}
