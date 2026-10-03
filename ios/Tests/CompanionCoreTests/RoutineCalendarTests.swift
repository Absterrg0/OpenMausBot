// The phone's routine calendar (MOCA-191), against the desktop's rules in
// src/lib/routine-calendar.ts: the same runs land on the same days, a run's
// receipt replaces its projection, and paused or skipped work is never shown.
import XCTest
@testable import CompanionCore

final class RoutineCalendarTests: XCTestCase {
    private var calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Kolkata")!
        return calendar
    }()

    /// Wednesday 7 Oct 2026, 00:00 in Kolkata.
    private var wednesday: Date {
        calendar.date(from: DateComponents(year: 2026, month: 10, day: 7))!
    }

    private func at(_ day: Date, _ hour: Int, _ minute: Int = 0) -> Date {
        calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day)!
    }

    private func ms(_ date: Date) -> Double { date.timeIntervalSince1970 * 1_000 }

    private func routine(
        _ id: String, schedule: String, enabled: Bool = true, nextRunAt: Date? = nil, createdAt: Date? = nil
    ) throws -> Routine {
        let created = ms(createdAt ?? calendar.date(byAdding: .day, value: -30, to: wednesday)!)
        let next = nextRunAt.map { ms($0) }.map { "\($0)" } ?? "null"
        let json = """
        {"id":"\(id)","name":"\(id) name","prompt":"p","botId":"b1","runOn":"maus","enabled":\(enabled),
         "schedule":\(schedule),"durationMinutes":30,"nextRunAt":\(next),"createdAt":\(created),"updatedAt":\(created)}
        """
        return try JSONDecoder().decode(Routine.self, from: Data(json.utf8))
    }

    private func run(_ id: String, routine: String, at date: Date, status: String = "completed") throws -> RoutineRun {
        let json = """
        {"id":"\(id)","routineId":"\(routine)","routineName":"\(routine) name","botId":"b1","runOn":"maus",
         "scheduledFor":\(ms(date)),"status":"\(status)","manual":false,"createdAt":\(ms(date))}
        """
        return try JSONDecoder().decode(RoutineRun.self, from: Data(json.utf8))
    }

    func testTheWeekStartsOnMondayLikeTheDesktop() {
        let week = RoutineCalendar.week(containing: at(wednesday, 15), calendar: calendar)
        XCTAssertEqual(week.count, 7)
        XCTAssertEqual(calendar.component(.weekday, from: week[0]), 2, "Monday")
        XCTAssertEqual(calendar.component(.day, from: week[0]), 5)
        XCTAssertEqual(calendar.component(.day, from: week[6]), 11)
    }

    func testADailyRoutineLandsOnItsWeekdaysAtItsTime() throws {
        // weekdays use JavaScript's numbering: 0 = Sunday, 3 = Wednesday, 4 = Thursday.
        let brief = try routine("brief", schedule: #"{"type":"daily","time":"09:00","weekdays":[3,4]}"#)
        let items = RoutineCalendar.items(routines: [brief], runs: [], day: wednesday, calendar: calendar)
        XCTAssertEqual(items.map(\.at), [ms(at(wednesday, 9))])
        XCTAssertNil(items.first?.run)
        let tuesday = calendar.date(byAdding: .day, value: -1, to: wednesday)!
        XCTAssertTrue(RoutineCalendar.items(routines: [brief], runs: [], day: tuesday, calendar: calendar).isEmpty)
    }

    func testAReceiptReplacesItsProjectionAndKeepsItsOutcome() throws {
        let brief = try routine("brief", schedule: #"{"type":"daily","time":"09:00","weekdays":[3]}"#)
        let done = try run("run1", routine: "brief", at: at(wednesday, 9), status: "failed")
        let items = RoutineCalendar.items(routines: [brief], runs: [done], day: wednesday, calendar: calendar)
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items.first?.run?.status, "failed")
        XCTAssertEqual(items.first?.routine?.id, "brief")
    }

    func testOneTimeAndIntervalRoutinesShowOnlyWhatTheSchedulerWillRun() throws {
        let once = try routine("once", schedule: #"{"type":"once","at":\#(ms(at(wednesday, 14, 30)))}"#)
        // An interval shows its persisted next tick only: reconstructing other
        // ticks would resurrect work the scheduler deliberately skips.
        let interval = try routine(
            "every", schedule: #"{"type":"interval","everyMinutes":60,"anchorAt":0}"#, nextRunAt: at(wednesday, 11)
        )
        let items = RoutineCalendar.items(routines: [once, interval], runs: [], day: wednesday, calendar: calendar)
        XCTAssertEqual(items.map(\.routine?.id), ["every", "once"])
        XCTAssertEqual(items.map(\.at), [ms(at(wednesday, 11)), ms(at(wednesday, 14, 30))])
    }

    func testPausedNewerAndNotYetCreatedWorkIsNeverProjected() throws {
        let paused = try routine("paused", schedule: #"{"type":"daily","time":"09:00","weekdays":[3]}"#, enabled: false)
        let fresh = try routine(
            "fresh", schedule: #"{"type":"daily","time":"09:00","weekdays":[3]}"#, createdAt: at(wednesday, 10)
        )
        // A schedule from a newer desktop (cron, say) shows its next run only.
        let cron = try routine("cron", schedule: #"{"type":"cron","expression":"0 8 * * *","timeZone":"UTC"}"#, nextRunAt: at(wednesday, 13))
        let items = RoutineCalendar.items(routines: [paused, fresh, cron], runs: [], day: wednesday, calendar: calendar)
        XCTAssertEqual(items.map(\.routine?.id), ["cron"])
    }

    func testTerminalHistoryIsTrimmedButActiveRunsAlwaysShow() throws {
        let every = try routine("every", schedule: #"{"type":"interval","everyMinutes":5,"anchorAt":0}"#)
        var runs = try (0..<20).map { index in
            try run("r\(index)", routine: "every", at: at(wednesday, 1, index * 2))
        }
        runs.append(try run("live", routine: "every", at: at(wednesday, 2), status: "running"))
        let items = RoutineCalendar.items(routines: [every], runs: runs, day: wednesday, calendar: calendar)
        XCTAssertEqual(items.filter { $0.run?.status == "completed" }.count, 12)
        XCTAssertTrue(items.contains { $0.run?.id == "live" })
        XCTAssertEqual(items.map(\.at), items.map(\.at).sorted(), "in time order")
    }
}
