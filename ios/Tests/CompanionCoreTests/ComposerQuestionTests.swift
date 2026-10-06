import XCTest

@testable import CompanionCore

/// Which open question a line typed in the composer answers, and what the
/// computer receives for it. A bot blocked on its question never reads a
/// steered line, so only an unambiguous single question takes the composer.
final class ComposerQuestionTests: XCTestCase {
    private func messages(_ json: String) throws -> [Message] {
        try JSONDecoder().decode([Message].self, from: Data(json.utf8))
    }

    /// A flat `ask_user` card as the computer builds it: no questionRequest.
    private func flat(_ id: String, options: String = "[]", extra: String = "") -> String {
        #"{"id": "m-\#(id)", "role": "bot", "kind": "options", "at": 1, "card": {"title": "Your bot has a question", "subtitle": "Which address?", "options": \#(options), "requestId": "\#(id)", "requestType": "question"\#(extra)}}"#
    }

    private func structured(_ id: String, questions: String) -> String {
        #"{"id": "m-\#(id)", "role": "bot", "kind": "options", "at": 1, "card": {"title": "t", "subtitle": "s", "options": [], "requestId": "\#(id)", "questionRequest": {"version": 1, "questions": \#(questions)}}}"#
    }

    private let approval = #"{"id": "p", "role": "bot", "kind": "options", "at": 1, "card": {"title": "t", "subtitle": "s", "options": ["Allow", "Deny"], "requestId": "p", "tool": "Bash", "requestType": "permission"}}"#

    func testOneFlatQuestionTakesTheComposerLine() throws {
        let target = try XCTUnwrap(ComposerQuestion.target(in: messages("[\(flat("q1"))]"), chatName: "Mochi"))
        XCTAssertEqual(target.message.id, "m-q1")
        XCTAssertEqual(target.asker, "Mochi")
        // A flat question takes the line as it is.
        XCTAssertEqual(target.answer("  billing@example.com \n"), "billing@example.com")
        // Options do not stop a typed answer.
        XCTAssertNotNil(ComposerQuestion.target(in: try messages("[\(flat("q2", options: #"["Monday", "Friday"]"#))]"), chatName: "Mochi"))
    }

    func testOneStructuredQuestionGetsTheCardsOwnAnswerFormat() throws {
        let one = structured("q1", questions: #"[{"question": "Which account?"}]"#)
        let target = try XCTUnwrap(ComposerQuestion.target(in: messages("[\(one)]"), chatName: "Mochi"))
        XCTAssertEqual(target.answer("The shared one"),
                       "The user answered your questions.\n\nQ: Which account?\nA: The shared one")
    }

    func testNoTargetWhenTheLineCouldAnswerMoreThanOneThing() throws {
        let two = structured("q1", questions: #"[{"question": "A?"}, {"question": "B?"}]"#)
        XCTAssertNil(ComposerQuestion.target(in: try messages("[\(two)]"), chatName: "Mochi"))
        XCTAssertNil(ComposerQuestion.target(in: try messages("[\(flat("q1")), \(flat("q2"))]"), chatName: "Mochi"))
        XCTAssertNil(ComposerQuestion.target(in: [], chatName: "Mochi"))
    }

    func testSettledQuestionsAndApprovalsDoNotCount() throws {
        let open = try messages(#"""
        [\#(flat("q0", extra: #", "answered": "answer", "answeredText": "Friday""#)),
         \#(flat("q-dismissed", extra: #", "dismissed": true"#)),
         \#(flat("q-expired", extra: #", "expired": true"#)),
         \#(approval),
         \#(flat("q1"))]
        """#)
        XCTAssertEqual(ComposerQuestion.target(in: open, chatName: "Mochi")?.message.id, "m-q1")
        XCTAssertNil(ComposerQuestion.target(in: try messages("[\(approval)]"), chatName: "Mochi"))
    }

    func testAttachmentsMakeItAnOrdinaryMessage() throws {
        XCTAssertNil(ComposerQuestion.target(in: try messages("[\(flat("q1"))]"), chatName: "Mochi", hasAttachments: true))
    }

    func testARoomNamesTheMemberThatAsked() throws {
        let asked = #"{"id": "m-q1", "role": "bot", "kind": "options", "at": 1, "from": {"botId": "b1", "name": "Pip", "color": "teal"}, "card": {"title": "t", "subtitle": "s", "options": [], "requestId": "q1", "requestType": "question"}}"#
        XCTAssertEqual(ComposerQuestion.target(in: try messages("[\(asked)]"), chatName: "Studio")?.asker, "Pip")
    }

    func testOnlyAFlatQuestionCardTakesATypedAnswer() throws {
        let cards = try messages("[\(flat("q1")), \(approval), \(structured("q2", questions: #"[{"question": "A?"}]"#))]")
            .compactMap(\.card)
        XCTAssertEqual(cards.map(\.takesTypedAnswer), [true, false, false])
    }

    func testAQuestionWithNoOptionsIsAnsweredInWords() throws {
        let card = try XCTUnwrap(messages("[\(structured("q1", questions: #"[{"question": "Which account?", "options": []}, {"question": "B?", "options": [{"label": "Yes"}]}]"#))]").first?.card)
        XCTAssertEqual(card.questions.map(\.answersInWords), [true, false])
    }
}
