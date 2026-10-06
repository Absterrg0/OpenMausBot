package com.openmausbot.companion.ui

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.width
import com.openmausbot.companion.core.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * A question's answers were a row of wrap-content buttons, and a sentence-long
 * answer pushed the next one off the card. They now stack full width; an
 * approval's Allow and Deny keep their row. On a 393 dp phone, as iOS's
 * ApprovalCardUITests measures it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w393dp-h852dp-xxhdpi")
class CardOptionsLayoutTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private val bot = Bot(
        id = "mochi",
        threadId = "t1",
        name = "Mochi",
        title = "",
        description = "",
        notifications = true,
        color = "blue",
        unread = false,
        modelSelection = ModelSelection("instance-1", "model-1"),
        createdAt = 0.0,
    )

    private fun show(card: OptionCard) {
        val wiring = WiringScene(fleet = Fleet(listOf(bot), emptyList()))
        val message = Message("q", Message.Role.BOT, Message.Kind.OPTIONS, 1.0, card = card)
        compose.setContent {
            CompositionLocalProvider(LocalCompanion provides wiring.environment) {
                CompanionTheme(darkTheme = false) {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                        MessageRow(Chat.BotChat(bot), message)
                    }
                }
            }
        }
    }

    @Test fun aQuestionStacksItsLongOptionsFullWidth() {
        val long = "Yes, from your Gmail — I'll give subject and body"
        val short = "Use a different address"
        show(
            OptionCard(
                title = "Your bot has a question",
                subtitle = "Sending to Milind. What should the subject and body say?",
                options = listOf(long, short),
                requestId = "q",
                requestType = "question",
            ),
        )
        assertEquals(1, compose.onAllNodesWithTag(STACKED_OPTIONS_TAG, useUnmergedTree = true).fetchSemanticsNodes().size)
        val first = compose.onNodeWithText(long).getBoundsInRoot()
        val second = compose.onNodeWithText(short).getBoundsInRoot()
        assertTrue(second.top >= first.bottom, "one under the other: $first then $second")
        // The merged button nodes: both span the card, not their labels.
        assertEquals(first.width.value, second.width.value, 0.5f, "both buttons are as wide")
        assertTrue(first.width.value > 393f * 0.6f, "the buttons take the card's width: ${first.width}")
    }

    @Test fun anApprovalKeepsAllowAndDenyInARow() {
        show(
            OptionCard(
                title = "Approval needed",
                subtitle = "git push",
                options = listOf("Allow", "Deny"),
                requestId = "p",
                tool = "Bash",
                requestType = "permission",
            ),
        )
        assertEquals(0, compose.onAllNodesWithTag(STACKED_OPTIONS_TAG, useUnmergedTree = true).fetchSemanticsNodes().size)
        assertEquals(0, compose.onAllNodesWithTag(CARD_ANSWER_FIELD_TAG).fetchSemanticsNodes().size, "an approval takes no words")
        val allow = compose.onNodeWithText("Allow").getBoundsInRoot()
        val deny = compose.onNodeWithText("Deny").getBoundsInRoot()
        assertEquals(allow.top, deny.top, "side by side")
        assertTrue(deny.left >= allow.right)
    }

    /** The computer's `ask_user` with no choices used to leave nothing to tap. */
    @Test fun aQuestionWithNoOptionsOpensAnAnswerField() {
        show(
            OptionCard(
                title = "Your bot has a question",
                subtitle = "Which email address should the reminder come from?",
                options = emptyList(),
                requestId = "q",
                requestType = "question",
            ),
        )
        compose.onNodeWithTag(CARD_ANSWER_FIELD_TAG).assertExists()
        compose.onNodeWithText("Type your answer", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag(CARD_ANSWER_SEND_TAG).assertIsNotEnabled()
    }

    @Test fun aQuestionWithOptionsTakesWordsUnderThem() {
        show(
            OptionCard(
                title = "Your bot has a question",
                subtitle = "What should the subject say?",
                options = listOf("Use the invoice number", "Keep it short: Invoice due"),
                requestId = "q",
                requestType = "question",
            ),
        )
        compose.onNodeWithText("Type your own answer", useUnmergedTree = true).assertExists()
        val last = compose.onNodeWithText("Keep it short: Invoice due").getBoundsInRoot()
        val field = compose.onNodeWithTag(CARD_ANSWER_FIELD_TAG).getBoundsInRoot()
        assertTrue(field.top >= last.bottom, "under the options: $last then $field")
    }

    /** A structured question with no options opens straight to its field. */
    @Test fun aStructuredQuestionWithNoOptionsOpensItsField() {
        show(
            OptionCard(
                title = "Your bot has a question",
                subtitle = "Which folder should they go in?",
                options = emptyList(),
                requestId = "q",
                questionRequest = QuestionRequestCardData(questions = listOf(AskQuestion(question = "Which folder should they go in?"))),
            ),
        )
        compose.onNodeWithTag("question-answer-field").assertExists()
        assertEquals(0, compose.onAllNodesWithText("Other").fetchSemanticsNodes().size, "no lone Other row")
    }
}
