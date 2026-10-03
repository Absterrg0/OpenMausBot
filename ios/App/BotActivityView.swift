import CompanionCore
import Combine
import SwiftUI

/// What one bot did, newest first, grouped by day: every tool it used and
/// every approval it asked for, each with the outcome. The phone twin of the
/// desktop's Activity panel; read-only, like the overview beside it.
struct BotActivityView: View {
    let bot: Bot
    @EnvironmentObject private var session: Session
    @Environment(\.scenePhase) private var scenePhase
    @State private var rows: [ActivityRow]?
    @State private var days: [Day] = []
    @State private var presentationDay: Date?
    @State private var loading = false
    @State private var failed = false
    @State private var loadGeneration = 0

    private static let isoParser: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let basicISOParser = ISO8601DateFormatter()

    private struct PresentedRow: Identifiable {
        let id: Int
        let row: ActivityRow
        let time: String
    }

    private struct Day: Identifiable {
        let id: String
        let label: String
        var rows: [PresentedRow]
    }

    // Derive once per changed receipt page/day, not on Session's ordinary
    // chat invalidations. Both ISO parsing and time formatting stay here.
    private static func present(_ rows: [ActivityRow], now: Date) -> [Day] {
        let calendar = Calendar.current
        var result: [Day] = []
        for (index, row) in rows.enumerated() {
            let parsed = isoParser.date(from: row.at) ?? basicISOParser.date(from: row.at)
            let date = parsed ?? now
            let presented = PresentedRow(id: index, row: row, time: parsed.map { $0.formatted(date: .omitted, time: .shortened) } ?? "")
            let key = calendar.startOfDay(for: date)
            let id = "\(key.timeIntervalSince1970)"
            if let last = result.last, last.id == id {
                result[result.count - 1].rows.append(presented)
            } else {
                let label = calendar.isDateInToday(date) ? String(localized: "Today")
                    : calendar.isDateInYesterday(date) ? String(localized: "Yesterday")
                    : date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
                result.append(Day(id: id, label: label, rows: [presented]))
            }
        }
        return result
    }

    var body: some View {
        List {
            if let rows, rows.isEmpty {
                Section {
                    Text("Nothing yet. Once \(bot.name) runs a tool or asks for an approval, it shows up here.")
                        .foregroundStyle(.secondary)
                }
            }
            ForEach(days) { day in
                Section(day.label) {
                    ForEach(day.rows) { presented in
                        ActivityRowView(row: presented.row, time: presented.time)
                    }
                }
            }
            if failed {
                Section {
                    EmptyStateView(String(localized: "Couldn't load"), systemImage: "wifi.exclamationmark")
                }
            }
        }
        .navigationTitle("\(bot.name) activity")
        .overlay { if loading && rows == nil { ProgressView() } }
        .task(id: session.connection?.id) {
            rows = nil
            days = []
            presentationDay = nil
            failed = false
            await load()
        }
        .refreshable { await load() }
        .onValueChange(of: scenePhase) { phase in
            if phase == .active { Task { await load() } }
        }
        .onReceive(session.activityUpdates.filter { threadID in
            let current = session.state.bots.first(where: { $0.id == bot.id }) ?? bot
            return threadID == current.threadId || current.tasks?.contains(where: { $0.threadId == threadID }) == true
        }.debounce(for: .milliseconds(400), scheduler: RunLoop.main)) { _ in
            Task { await load() }
        }
    }

    private func load() async {
        loadGeneration += 1
        let generation = loadGeneration
        let connectionID = session.connection?.id
        loading = true
        defer {
            if !Task.isCancelled, session.connection?.id == connectionID, loadGeneration == generation { loading = false }
        }
        let loaded = await session.botActivity(for: bot)
        guard !Task.isCancelled, session.connection?.id == connectionID, loadGeneration == generation else { return }
        if let loaded {
            let now = Date()
            let day = Calendar.current.startOfDay(for: now)
            if rows != loaded || presentationDay != day {
                days = Self.present(loaded, now: now)
                presentationDay = day
            }
            rows = loaded
            failed = false
        } else {
            failed = true
        }
    }
}

private struct ActivityRowView: View {
    let row: ActivityRow
    let time: String

    private var chip: (text: LocalizedStringKey, color: Color) {
        switch row.outcome {
        case "ran", "allowed": return ("\(row.outcome == "ran" ? "Ran" : "Allowed")", .green)
        case "failed", "denied": return ("\(row.outcome == "failed" ? "Failed" : "Denied")", .red)
        case "running": return ("Running", .accentColor)
        case "waiting": return ("Needs you", .orange)
        default: return ("\(row.outcome)", .secondary)
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text(time)
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: 44, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    if let app = row.app {
                        Text(app).fontWeight(.medium)
                        Text("·").foregroundStyle(.secondary)
                    }
                    Text(row.label).lineLimit(1)
                }
                if let summary = row.summary, !summary.isEmpty {
                    Text(summary)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 6)
            Text(chip.text)
                .font(.caption2.weight(.medium))
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(chip.color.opacity(0.15), in: Capsule())
                .foregroundStyle(chip.color)
        }
        .padding(.vertical, 2)
    }
}
