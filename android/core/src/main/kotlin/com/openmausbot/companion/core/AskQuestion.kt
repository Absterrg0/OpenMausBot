package com.openmausbot.companion.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Structured questions raised by a provider's own "ask the human" tool —
 * Claude's built-in `AskUserQuestion`.
 *
 * A port of `shared/ask-question.ts`, kept in step with
 * `ios/Sources/CompanionCore/AskQuestion.swift`. The desktop re-reads that
 * tool's input into these questions and puts them on the card; the phone
 * renders them and sends back the same answer text the desktop would, so a
 * question answered here is indistinguishable from one answered on the Mac.
 *
 * Every field but the question itself is optional. These payloads are
 * bot-authored and arrive inside a transcript: a question whose shape
 * surprises us must cost one card, never the whole conversation.
 */
@Serializable
data class AskQuestionOption(
    val label: String,
    /**
     * The model's one-line gloss under the label. Named `detail` because
     * `description` collides with nothing here but reads as a Kotlin
     * `toString` hook to anyone arriving from the Swift twin.
     */
    @SerialName("description") val detail: String? = null,
)

@Serializable
data class AskQuestion(
    val question: String,
    /** The short tab label the model gave this question ("Schedule", "Model"). */
    val header: String? = null,
    val multiSelect: Boolean? = null,
    /**
     * A question with no options is still answerable — the card always offers
     * free text — so a missing list is empty, not a failure.
     */
    val options: List<AskQuestionOption> = emptyList(),
) {
    val allowsMultiple: Boolean get() = multiSelect == true

    /**
     * What the tab shows. The model names most questions; a numbered fallback
     * keeps the tabs distinguishable when it does not.
     */
    fun tabLabel(position: Int): String = header?.takeIf { it.isNotEmpty() } ?: "Question $position"

    /**
     * A question with nothing to pick is answered in words: its card opens
     * straight to the answer field instead of a lone "Other" row.
     */
    val answersInWords: Boolean get() = options.isEmpty()
}

@Serializable
data class QuestionRequestCardData(
    val version: Int = 1,
    val questions: List<AskQuestion> = emptyList(),
    /**
     * Where the ask came from: a tool call (null) or a block the harness parsed
     * out of model-authored output ("output"). Badge data only — it never
     * changes how a card is answered.
     */
    val origin: String? = null,
)

/**
 * The answer text, byte-for-byte what `shared/ask-question.ts` produces.
 *
 * It reaches the model as the tool's own result, so it has to stand on its
 * own: name each question, then what was picked for it.
 */
object AskQuestionAnswer {
    /**
     * The lead-in exists for the model — the answer is delivered on the
     * permission contract's deny channel, so it has to say what it is. The
     * card strips it back off when it shows a person what they sent.
     */
    const val PREAMBLE = "The user answered your questions."

    fun format(questions: List<AskQuestion>, answers: List<List<String>>): String {
        val blocks = questions.mapIndexedNotNull { index, question ->
            val picked = answers.getOrElse(index) { emptyList() }
                .map { it.trim() }
                .filter { it.isNotEmpty() }
            if (picked.isEmpty()) null else "Q: ${question.question}\nA: ${picked.joinToString(", ")}"
        }
        if (blocks.isEmpty()) return ""
        return "$PREAMBLE\n\n${blocks.joinToString("\n\n")}"
    }

    /** The same answer without the model-facing lead-in, for a settled card. */
    fun withoutPreamble(answer: String): String {
        val lead = "$PREAMBLE\n\n"
        return if (answer.startsWith(lead)) answer.removePrefix(lead) else answer
    }
}

/**
 * A flat question card (the computer's own `ask_user`, which has no
 * `questionRequest`) takes a typed answer under its options. Approvals, held
 * sends and proposals never do: their buttons are the only answers.
 */
val OptionCard.takesTypedAnswer: Boolean
    get() = requestType == "question" && questions.isEmpty()

/**
 * The open question a line typed in the composer answers, kept in step with
 * `ComposerQuestion` in `ios/Sources/CompanionCore/AskQuestion.swift`.
 *
 * A bot blocked on its question never reads words steered into its turn, so
 * while the chat waits on exactly one question the phone sends the
 * composer's line as that question's answer instead, through the same
 * respond route the card's own buttons use. Anything less clear-cut — two
 * open questions, one card asking several things, an attachment riding
 * along — is an ordinary message, as it always was.
 */
object ComposerQuestion {
    /** The question the line would answer and the bot waiting on it. */
    data class Target(
        val message: Message,
        val card: OptionCard,
        /** Who the composer names: the asking member in a room, else the chat. */
        val asker: String,
    ) {
        /**
         * What the computer receives for a typed line. A structured ask gets
         * the same "Q: … A: …" text its own card would send, so the Mac and
         * the model cannot tell where it was answered; a flat question takes
         * the line as it is.
         */
        fun answer(text: String): String {
            val typed = text.trim()
            val questions = card.questions
            if (questions.isEmpty()) return typed
            return AskQuestionAnswer.format(questions, listOf(listOf(typed)))
        }
    }

    /**
     * The one pending question card in [messages]: a flat question card, or a
     * structured card asking exactly one thing. Null when there are none or
     * several, when the only one asks several questions, or when the message
     * carries attachments.
     */
    fun target(messages: List<Message>, chatName: String, hasAttachments: Boolean = false): Target? {
        if (hasAttachments) return null
        var found: Message? = null
        for (message in messages) {
            val card = message.card ?: continue
            if (!card.isPending || (card.requestType != "question" && card.questions.isEmpty())) continue
            if (found != null) return null
            found = message
        }
        val card = found?.card ?: return null
        if (card.questions.size > 1) return null
        return Target(found, card, found.from?.name ?: chatName)
    }
}
