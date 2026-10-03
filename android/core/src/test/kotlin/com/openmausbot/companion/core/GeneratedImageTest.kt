package com.openmausbot.companion.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals

class GeneratedImageTest {
    @Test
    fun generatedImagesSurviveMessageDecodeAndCacheRoundTrip() {
        val json = Json { ignoreUnknownKeys = true }
        val source = """{"id":"reply","role":"bot","kind":"text","at":1,"text":"Screenshot attached","attachments":[{"kind":"image","path":"/tmp/screenshot.png","mime":"image/png"}]}"""
        val message = json.decodeFromString<Message>(source)
        val stored = json.parseToJsonElement(json.encodeToString(message)).jsonObject
        assertEquals("/tmp/screenshot.png", stored["attachments"]?.jsonArray?.first()?.jsonObject?.get("path")?.jsonPrimitive?.content)
    }

    @Test
    fun imageOnlyReplyIgnoresFutureKindsAndDuplicatePaths() {
        val source = """{"id":"reply","role":"bot","kind":"text","at":1,"attachments":[{"kind":"video"},{"kind":"audio","path":"/tmp/note.mp3","mime":"audio/mpeg","durationMs":4200},{"kind":"image","path":"/tmp/screen 100%.png","mime":"image/png"},{"kind":"image","path":"/tmp/screen 100%.png"},{"kind":"image","path":" "}]}"""
        val message = CompanionJson.decodeFromString<Message>(source)
        assertEquals(listOf(DisplayedMessageAttachment(DisplayedMessageAttachment.Kind.IMAGE, "screen 100%.png", "/tmp/screen 100%.png")), message.generatedImages)
        val state = CompanionState().apply(Frame.Message("thread", message.copy(attachments = null)))
            .apply(Frame.MessagePatch("thread", message))
        assertEquals(message.generatedImages, state.transcript("thread").single().generatedImages)
        assertEquals(null, message.text)
    }

    @Test
    fun legacyTextHasNoGeneratedImages() {
        val message = Json.decodeFromString<Message>("""{"id":"old","role":"bot","kind":"text","at":1,"text":"Still visible"}""")
        assertEquals(emptyList(), message.generatedImages)
        assertEquals("Still visible", message.text)
    }

    /**
     * A bot's attach_file sends documents, audio and video as `kind:"file"`
     * with a name (server/bot-attachment.ts). The phone dropped them, and the
     * message read as an empty bubble (MOCA-155). Port of the iOS test.
     */
    @Test
    fun aBotsFileAttachmentsBecomeNamedFileCards() {
        val source = """{"id":"sent","role":"bot","kind":"text","at":1,"text":"","attachments":[{"kind":"file","path":"/data/attachments/9f.mp4","mime":"video/mp4","name":"demo clip.mp4"},{"kind":"image","path":"/data/attachments/a1.png","mime":"image/png"},{"kind":"file","path":"/data/attachments/77.pdf","mime":"application/pdf","name":"../../report.pdf"},{"kind":"file","path":"/data/attachments/9f.mp4","name":"again.mp4"},{"kind":"file","path":" "},{"kind":"hologram","path":"/data/attachments/x.bin"}]}"""
        val message = CompanionJson.decodeFromString<Message>(source)
        assertEquals(
            listOf(
                DisplayedMessageAttachment(DisplayedMessageAttachment.Kind.FILE, "demo clip.mp4", "/data/attachments/9f.mp4"),
                // A crafted name is presentation only and never a path.
                DisplayedMessageAttachment(DisplayedMessageAttachment.Kind.FILE, "report.pdf", "/data/attachments/77.pdf"),
            ),
            message.attachedFiles,
        )
        assertEquals(listOf("/data/attachments/a1.png"), message.generatedImages.map { it.path }, "images keep their own card")
        val cached = CompanionJson.decodeFromString<Message>(CompanionJson.encodeToString(message))
        assertEquals(message.attachedFiles, cached.attachedFiles)
    }

    @Test
    fun aFileOnlyBotMessagePreviewsAsItsFileName() {
        val message = CompanionJson.decodeFromString<Message>(
            """{"id":"sent","role":"bot","kind":"text","at":1,"text":"","attachments":[{"kind":"file","path":"/data/attachments/9f.mp4","mime":"video/mp4","name":"demo clip.mp4"}]}""",
        )
        assertEquals("demo clip.mp4", rosterPreview(listOf(message), ActivityDetail.FULL))
        assertEquals("Here is the clip", rosterPreview(listOf(message.copy(text = "Here is the clip")), ActivityDetail.FULL))
    }

    @Test
    fun aFileCardKnowsVideoAndAudioFromTheExtension() {
        fun family(name: String) = DisplayedMessageAttachment(DisplayedMessageAttachment.Kind.FILE, name, "/data/attachments/x").fileFamily
        assertEquals(DisplayedMessageAttachment.FileFamily.VIDEO, family("demo clip.MP4"))
        assertEquals(DisplayedMessageAttachment.FileFamily.VIDEO, family("screen.mov"))
        assertEquals(DisplayedMessageAttachment.FileFamily.VIDEO, family("talk.webm"))
        assertEquals(DisplayedMessageAttachment.FileFamily.AUDIO, family("memo.m4a"))
        assertEquals(DisplayedMessageAttachment.FileFamily.AUDIO, family("song.mp3"))
        assertEquals(DisplayedMessageAttachment.FileFamily.DOCUMENT, family("weekly-report.pdf"))
        assertEquals(DisplayedMessageAttachment.FileFamily.DOCUMENT, family("notes"))
    }
}
