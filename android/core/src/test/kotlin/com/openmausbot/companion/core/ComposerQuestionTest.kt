package com.openmausbot.companion.core

import kotlinx.serialization.builtins.ListSerializer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/**
 * Which open question a line typed in the composer answers, and what the
 * computer receives for it — the twin of `ComposerQuestionTests.swift`. A
 * bot blocked on its question never reads a steered line, so only an
 * unambiguous single question takes the composer.
 */
class ComposerQuestionTest {
    private fun messages(json: String): List<Message> =
        CompanionJson.decodeFromString(ListSerializer(Message.serializer()), json)

    /** A flat `ask_user` card as the computer builds it: no questionRequest. */
    private fun flat(id: String, options: String = "[]", extra: String = ""): String =
        """{"id":"m-$id","role":"bot","kind":"options","at":1,"card":{"title":"Your bot has a question","subtitle":"Which address?","options":$options,"requestId":"$id","requestType":"question"$extra}}"""

    private fun structured(id: String, questions: String): String =
        """{"id":"m-$id","role":"bot","kind":"options","at":1,"card":{"title":"t","subtitle":"s","options":[],"requestId":"$id","questionRequest":{"version":1,"questions":$questions}}}"""

    private val approval =
        """{"id":"p","role":"bot","kind":"options","at":1,"card":{"title":"t","subtitle":"s","options":["Allow","Deny"],"requestId":"p","tool":"Bash","requestType":"permission"}}"""

    @Test
    fun `one flat question takes the composer line`() {
        val target = assertNotNull(ComposerQuestion.target(messages("[${flat("q1")}]"), "Mochi"))
        assertEquals("m-q1", target.message.id)
        assertEquals("Mochi", target.asker)
        // A flat question takes the line as it is.
        assertEquals("billing@example.com", target.answer("  billing@example.com \n"))
        // Options do not stop a typed answer.
        assertNotNull(ComposerQuestion.target(messages("[${flat("q2", options = """["Monday","Friday"]""")}]"), "Mochi"))
    }

    @Test
    fun `one structured question gets the card's own answer format`() {
        val one = structured("q1", """[{"question":"Which account?"}]""")
        val target = assertNotNull(ComposerQuestion.target(messages("[$one]"), "Mochi"))
        assertEquals(
            "The user answered your questions.\n\nQ: Which account?\nA: The shared one",
            target.answer("The shared one"),
        )
    }

    @Test
    fun `no target when the line could answer more than one thing`() {
        val two = structured("q1", """[{"question":"A?"},{"question":"B?"}]""")
        assertNull(ComposerQuestion.target(messages("[$two]"), "Mochi"))
        assertNull(ComposerQuestion.target(messages("[${flat("q1")},${flat("q2")}]"), "Mochi"))
        assertNull(ComposerQuestion.target(emptyList(), "Mochi"))
    }

    @Test
    fun `settled questions and approvals do not count`() {
        val open = messages(
            """[${flat("q0", extra = ""","answered":"answer","answeredText":"Friday"""")},
                ${flat("q-dismissed", extra = ""","dismissed":true""")},
                ${flat("q-expired", extra = ""","expired":true""")},
                $approval,
                ${flat("q1")}]""",
        )
        assertEquals("m-q1", ComposerQuestion.target(open, "Mochi")?.message?.id)
        assertNull(ComposerQuestion.target(messages("[$approval]"), "Mochi"))
    }

    @Test
    fun `attachments make it an ordinary message`() {
        assertNull(ComposerQuestion.target(messages("[${flat("q1")}]"), "Mochi", hasAttachments = true))
    }

    @Test
    fun `a room names the member that asked`() {
        val asked =
            """{"id":"m-q1","role":"bot","kind":"options","at":1,"from":{"botId":"b1","name":"Pip","color":"teal"},"card":{"title":"t","subtitle":"s","options":[],"requestId":"q1","requestType":"question"}}"""
        assertEquals("Pip", ComposerQuestion.target(messages("[$asked]"), "Studio")?.asker)
    }

    @Test
    fun `only a flat question card takes a typed answer`() {
        val cards = messages("[${flat("q1")},$approval,${structured("q2", """[{"question":"A?"}]""")}]")
            .mapNotNull { it.card }
        assertEquals(listOf(true, false, false), cards.map { it.takesTypedAnswer })
    }

    @Test
    fun `a question with no options is answered in words`() {
        val card = messages(
            "[${structured("q1", """[{"question":"Which account?","options":[]},{"question":"B?","options":[{"label":"Yes"}]}]""")}]",
        ).single().card!!
        assertEquals(listOf(true, false), card.questions.map { it.answersInWords })
    }
}
