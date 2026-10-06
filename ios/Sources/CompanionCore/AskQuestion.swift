/// Structured questions raised by a provider's own "ask the human" tool —
/// Claude's built-in `AskUserQuestion`.
///
/// A port of `shared/ask-question.ts`. The desktop re-reads that tool's input
/// into these questions and puts them on the card; the phone renders them and
/// sends back the same answer text the desktop would, so a question answered
/// here is indistinguishable from one answered on the Mac.
///
/// Decoding is deliberately forgiving. These payloads are bot-authored and
/// arrive inside a transcript: a question whose shape surprises us must cost
/// one card, never the whole conversation.

public struct AskQuestionOption: Codable, Hashable, Sendable {
    public var label: String
    /// The model's one-line gloss under the label. Named `detail` because
    /// `description` is Swift's own printing hook.
    public var detail: String?

    private enum CodingKeys: String, CodingKey {
        case label
        case detail = "description"
    }

    public init(label: String, detail: String? = nil) {
        self.label = label
        self.detail = detail
    }
}

public struct AskQuestion: Codable, Hashable, Sendable {
    public var question: String
    /// The short tab label the model gave this question ("Schedule", "Model").
    public var header: String?
    public var multiSelect: Bool?
    public var options: [AskQuestionOption]

    public init(question: String, header: String? = nil, multiSelect: Bool? = nil, options: [AskQuestionOption]) {
        self.question = question
        self.header = header
        self.multiSelect = multiSelect
        self.options = options
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        question = try container.decode(String.self, forKey: .question)
        header = try container.decodeIfPresent(String.self, forKey: .header)
        multiSelect = try container.decodeIfPresent(Bool.self, forKey: .multiSelect)
        // A question with no options is still answerable — the card always
        // offers free text — so a missing list is empty, not a failure.
        options = try container.decodeIfPresent([AskQuestionOption].self, forKey: .options) ?? []
    }

    /// What the tab shows. The model names most questions; a numbered
    /// fallback keeps the tabs distinguishable when it does not.
    public func tabLabel(position: Int) -> String {
        if let header, !header.isEmpty { return header }
        return "Question \(position)"
    }

    public var allowsMultiple: Bool { multiSelect == true }

    /// A question with nothing to pick is answered in words: its card opens
    /// straight to the answer field instead of a lone "Other" row.
    public var answersInWords: Bool { options.isEmpty }
}

public struct QuestionRequestCardData: Codable, Hashable, Sendable {
    public var version: Int
    public var questions: [AskQuestion]
    /// Where the ask came from: a tool call (nil) or a block the harness
    /// parsed out of model-authored output ("output"). Badge data only —
    /// it never changes how a card is answered.
    public var origin: String?

    public init(version: Int = 1, questions: [AskQuestion], origin: String? = nil) {
        self.version = version
        self.questions = questions
        self.origin = origin
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decodeIfPresent(Int.self, forKey: .version) ?? 1
        questions = try container.decodeIfPresent([AskQuestion].self, forKey: .questions) ?? []
        origin = try container.decodeIfPresent(String.self, forKey: .origin)
    }
}

/// The answer text, byte-for-byte what `shared/ask-question.ts` produces.
///
/// It reaches the model as the tool's own result, so it has to stand on its
/// own: name each question, then what was picked for it.
public enum AskQuestionAnswer {
    /// The lead-in exists for the model — the answer is delivered on the
    /// permission contract's deny channel, so it has to say what it is. The
    /// card strips it back off when it shows a person what they sent.
    public static let preamble = "The user answered your questions."

    public static func format(questions: [AskQuestion], answers: [[String]]) -> String {
        var blocks: [String] = []
        for (index, question) in questions.enumerated() {
            let picked = (index < answers.count ? answers[index] : [])
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            guard !picked.isEmpty else { continue }
            blocks.append("Q: \(question.question)\nA: \(picked.joined(separator: ", "))")
        }
        guard !blocks.isEmpty else { return "" }
        return "\(preamble)\n\n\(blocks.joined(separator: "\n\n"))"
    }

    /// The same answer without the model-facing lead-in, for a settled card.
    public static func withoutPreamble(_ answer: String) -> String {
        let lead = "\(preamble)\n\n"
        guard answer.hasPrefix(lead) else { return answer }
        return String(answer.dropFirst(lead.count))
    }
}

extension OptionCard {
    /// A flat question card (the computer's own `ask_user`, which has no
    /// `questionRequest`) takes a typed answer under its options. Approvals,
    /// held sends and proposals never do: their buttons are the only answers.
    public var takesTypedAnswer: Bool {
        requestType == "question" && questions.isEmpty
    }
}

/// The open question a line typed in the composer answers.
///
/// A bot blocked on its question never reads words steered into its turn,
/// so while the chat waits on exactly one question the phone sends the
/// composer's line as that question's answer instead, through the same
/// respond route the card's own buttons use. Anything less clear-cut — two
/// open questions, one card asking several things, an attachment riding
/// along — is an ordinary message, as it always was.
public enum ComposerQuestion {
    /// The question the line would answer and the bot waiting on it.
    public struct Target: Equatable, Sendable {
        public var message: Message
        public var card: OptionCard
        /// Who the composer names: the asking member in a room, else the chat.
        public var asker: String

        /// What the computer receives for a typed line. A structured ask gets
        /// the same "Q: … A: …" text its own card would send, so the Mac and
        /// the model cannot tell where it was answered; a flat question takes
        /// the line as it is.
        public func answer(_ text: String) -> String {
            let typed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            let questions = card.questions
            guard !questions.isEmpty else { return typed }
            return AskQuestionAnswer.format(questions: questions, answers: [[typed]])
        }
    }

    /// The one pending question card in `messages`: a flat question card,
    /// or a structured card asking exactly one thing. Nil when there are
    /// none or several, when the only one asks several questions, or when
    /// the message carries attachments.
    public static func target(in messages: [Message], chatName: String, hasAttachments: Bool = false) -> Target? {
        guard !hasAttachments else { return nil }
        var found: Message?
        for message in messages {
            guard let card = message.card, card.isPending,
                  card.requestType == "question" || !card.questions.isEmpty
            else { continue }
            if found != nil { return nil }
            found = message
        }
        guard let found, let card = found.card, card.questions.count <= 1 else { return nil }
        return Target(message: found, card: card, asker: found.from?.name ?? chatName)
    }
}
