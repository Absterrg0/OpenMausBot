// When resuming the event stream from its cursor keeps getting nowhere.
//
// Resuming replays whatever followed the cursor. When that is a frame the
// route cannot carry — one past the phone sidecar's 4 MiB event ceiling ends
// the stream cleanly — every resume is hello and then nothing, and the phone
// shows "Lost the connection." until the app is killed (MOCA-179). Two of
// those in a row and the next stream starts over without a cursor: the
// server answers resumed=false, the app reloads and takes a new cursor.
// Android's Session.runStream keeps the same count.
import Foundation

public struct StreamResume: Equatable, Sendable {
    /// Empty resumes in a row before the stream starts over without a cursor.
    public static let emptyResumesBeforeFreshStart = 2

    public private(set) var emptyResumes = 0

    public init() {}

    /// The cursor to open the next stream with: the saved one, or nil once
    /// resuming has come back empty twice in a row.
    public mutating func cursor(resuming saved: String?) -> String? {
        guard emptyResumes >= Self.emptyResumesBeforeFreshStart else { return saved }
        emptyResumes = 0
        return nil
    }

    /// A stream that said hello has ended cleanly, having delivered
    /// `framesAfterHello` frames after it.
    public mutating func ended(framesAfterHello: Int) {
        emptyResumes = framesAfterHello == 0 ? emptyResumes + 1 : 0
    }
}
